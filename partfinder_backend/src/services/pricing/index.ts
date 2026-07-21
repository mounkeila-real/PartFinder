import { PrismaClient } from '@prisma/client';
import { classifyPart, cacheKey as aiCacheKey } from '../aiClassifier';
import {
    computeTotalPrice, computeShipping, findProcessingFee, computeInsurance,
    computePriceWithoutShipping, getPriceRegime, computeWeightDeviation, selectTranche,
    DEFAULT_SETTINGS, PricingError,
    type PricingSettings, type RateTranche, type FeeTier, type Zone,
    type AssuranceOption, type WeightSource, type ParcelDims,
} from './compute';

/**
 * Couche d'accès aux données du module de tarification.
 * Les calculs eux-mêmes restent dans `compute.ts` (fonctions pures et testées) :
 * ici on ne fait que charger les grilles/paramètres et orchestrer.
 */

const prisma = new PrismaClient();

export * from './compute';

// ── Paramètres (cache court : évite une requête par calcul) ──────────
let settingsCache: { value: PricingSettings; at: number } | null = null;
const SETTINGS_TTL_MS = 60_000;

const KEY_MAP: Record<string, keyof PricingSettings> = {
    marge_pourcent: 'margePourcent',
    marge_minimum_eur: 'margeMinimumEur',
    marge_securite_port_pourcent: 'margeSecuritePortPourcent',
    consolidation_forfait_eur: 'consolidationForfaitEur',
    supplement_colis_non_annonce_eur: 'supplementColisNonAnnonceEur',
    stockage_jours_gratuits: 'stockageJoursGratuits',
    stockage_prix_jour_eur: 'stockagePrixJourEur',
    assurance_marge_eur: 'assuranceMargeEur',
    seuil_ecart_tranches: 'seuilEcartTranches',
    supplement_gabarit_eur: 'supplementGabaritEur',
    indemnisation_standard_eur_kg: 'indemnisationStandardEurKg',
    assurance_ad_valorem_pourcent: 'assuranceAdValoremPourcent',
    assurance_ad_valorem_min_eur: 'assuranceAdValoremMinEur',
};

export async function getSettings(force = false): Promise<PricingSettings> {
    if (!force && settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) {
        return settingsCache.value;
    }
    const rows = await prisma.pricingSetting.findMany();
    const value: PricingSettings = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
        const field = KEY_MAP[r.key];
        if (!field) continue;
        const n = Number(r.value);
        if (Number.isFinite(n)) (value as any)[field] = n;
    }
    settingsCache = { value, at: Date.now() };
    return value;
}

/** À appeler après toute modification de paramètre en admin. */
export function invalidateSettingsCache(): void {
    settingsCache = null;
}

// ── Grilles ──────────────────────────────────────────────────────────
export async function getTranches(zone: Zone, at: Date = new Date()): Promise<RateTranche[]> {
    const rows = await prisma.colissimoRate.findMany({
        where: {
            zone,
            valideDu: { lte: at },
            OR: [{ valideAu: null }, { valideAu: { gte: at } }],
        },
        orderBy: { poidsMaxKg: 'asc' },
    });
    return rows.map((r) => ({ poidsMaxKg: Number(r.poidsMaxKg), prixEur: Number(r.prixEur) }));
}

export async function getFeeTiers(): Promise<FeeTier[]> {
    const rows = await prisma.processingFeeTier.findMany({ orderBy: { valeurMinEur: 'asc' } });
    return rows.map((r) => ({
        valeurMinEur: Number(r.valeurMinEur),
        valeurMaxEur: r.valeurMaxEur === null ? null : Number(r.valeurMaxEur),
        fraisEur: Number(r.fraisEur),
    }));
}

/** Frais de traitement applicables à une valeur déclarée. */
export async function getProcessingFee(valeurEur: number): Promise<number> {
    return findProcessingFee(valeurEur, await getFeeTiers());
}

/** Port Colissimo estimé pour un poids et une zone. */
export async function getColissimoRate(poidsKg: number, zone: Zone, dims: ParcelDims = {}) {
    const [tranches, settings] = await Promise.all([getTranches(zone), getSettings()]);
    return computeShipping(poidsKg, tranches, settings, dims);
}

// ── Estimation du poids ──────────────────────────────────────────────
export interface WeightEstimate {
    poidsKg: number;
    dims: ParcelDims;
    source: WeightSource;
    confiance: number;
    categoryCode?: string;
    valideParOperateur?: boolean;
    horsGabarit?: boolean;
    /** Nombre d'unités de la catégorie (le poids en tient déjà compte). */
    quantite?: number;
    /** true = classification incertaine, à faire valider par un opérateur. */
    besoinRevue?: boolean;
}

/** Normalisation d'un titre d'annonce pour le cache de classification. */
export function normalizeTitle(titre: string): string {
    return titre
        .toLowerCase()
        .replace(/[0-9]{5,}/g, ' ')      // références numériques longues
        .replace(/[^a-z0-9àâäéèêëîïôöùûüç\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Chaîne de résolution du poids :
 *   a) poids fourni par le vendeur       -> SELLER  (FERME)
 *   b) catégorie connue du parcours      -> CATALOG (FERME)
 *   c) classification IA (cache, puis appel) -> AI_CACHED / AI
 * Ne lève jamais : renvoie UNKNOWN plutôt que de bloquer le parcours client.
 *
 * ⚠️ Le poids retenu = poids de la catégorie × QUANTITÉ. Un lot de 2 disques
 * pèse le double d'un seul : ignorer la quantité sous-estimerait le port.
 */
export async function estimateWeight(input: {
    poidsVendeurKg?: number | null;
    categoryCode?: string | null;
    titre?: string | null;
    description?: string | null;
    /**
     * ⚠️ COÛT : n'activer l'IA que sur un article précis (ajout au panier,
     * validation opérateur). JAMAIS sur une liste de résultats de recherche :
     * 50 résultats = 50 appels facturés par recherche.
     * Le cache, lui, est toujours consulté (lecture base, gratuite).
     */
    allowAi?: boolean;
}): Promise<WeightEstimate> {
    // (a) Poids annoncé par le vendeur
    if (input.poidsVendeurKg && input.poidsVendeurKg > 0) {
        return { poidsKg: input.poidsVendeurKg, dims: {}, source: 'SELLER', confiance: 1, quantite: 1 };
    }

    // (b) Catégorie déjà connue du parcours
    if (input.categoryCode) {
        const cat = await prisma.partCategory.findUnique({ where: { code: input.categoryCode } });
        if (cat) {
            return {
                poidsKg: Number(cat.poidsKg),
                dims: { longueurCm: cat.longueurCm, largeurCm: cat.largeurCm, hauteurCm: cat.hauteurCm },
                source: 'CATALOG',
                confiance: cat.poidsVerifie ? 1 : 0.8,
                categoryCode: cat.code,
                horsGabarit: cat.horsGabarit,
                quantite: 1,
            };
        }
    }

    // (c) Cache de classification (lecture base, gratuite) — toujours consulté.
    if (input.titre) {
        const cached = await lookupClassificationCache(input.titre, input.description ?? null);
        if (cached?.category) {
            const quantite = cached.quantite || 1;
            return {
                poidsKg: Number(cached.category.poidsKg) * quantite,
                dims: {
                    longueurCm: cached.category.longueurCm,
                    largeurCm: cached.category.largeurCm,
                    hauteurCm: cached.category.hauteurCm,
                },
                source: 'AI_CACHED',
                confiance: Number(cached.confiance),
                categoryCode: cached.category.code,
                valideParOperateur: cached.valideParOperateur,
                horsGabarit: cached.category.horsGabarit,
                quantite,
                besoinRevue: !cached.valideParOperateur && Number(cached.confiance) < 0.6,
            };
        }
    }

    // (d) Appel IA — UNIQUEMENT sur demande explicite (article isolé), jamais en liste.
    if (input.allowAi && input.titre) {
        const cls = await classifyPart(input.titre, input.description ?? null);
        if (cls.categoryCode) {
            const cat = await prisma.partCategory.findUnique({ where: { code: cls.categoryCode } });
            if (cat) {
                const quantite = cls.quantite || 1;
                return {
                    poidsKg: Number(cat.poidsKg) * quantite,
                    dims: { longueurCm: cat.longueurCm, largeurCm: cat.largeurCm, hauteurCm: cat.hauteurCm },
                    source: cls.source === 'CACHE' ? 'AI_CACHED' : 'AI',
                    confiance: cls.confiance,
                    categoryCode: cat.code,
                    valideParOperateur: cls.valideParOperateur,
                    horsGabarit: cat.horsGabarit,
                    quantite,
                    besoinRevue: cls.besoinRevue,
                };
            }
        }
    }

    // (e) Aucune information fiable -> régime ESTIMÉ, jamais de blocage.
    return { poidsKg: 0, dims: {}, source: 'UNKNOWN', confiance: 0, quantite: 1, besoinRevue: true };
}

/** Consultation du cache de classification (aucun appel IA). */
async function lookupClassificationCache(titre: string, description: string | null) {
    try {
        return await prisma.aiClassification.findUnique({
            where: { titreNormalise: aiCacheKey(titre, description) },
            include: { category: true },
        });
    } catch {
        return null;
    }
}

// ── Devis complet ────────────────────────────────────────────────────
export interface QuoteInput {
    prixPieceEur: number;
    portVendeurEur?: number | null;
    valeurDeclareeEur?: number;
    zone: Zone;
    poidsVendeurKg?: number | null;
    categoryCode?: string | null;
    titre?: string | null;
    description?: string | null;
    assurance?: AssuranceOption;
    colisNonAnnonce?: boolean;
    consolidation?: boolean;
    /** N'activer que sur un article isolé (panier, validation) — jamais en liste. */
    allowAi?: boolean;
}

export interface QuoteResult {
    /** Prix tout compris — LE seul montant présenté au client. null si le poids est inconnu. */
    prixClientEur: number | null;
    /**
     * Prix calculable sans le poids (pièce + acheminement vendeur + traitement
     * + marge). Sert à afficher « XX € + frais de port » sans appel IA.
     */
    prixHorsPortEur: number | null;
    /** true = le port outre-mer n'a pas pu être chiffré (poids inconnu). */
    portInconnu: boolean;
    regime: 'FERME' | 'ESTIME';
    /** Détail interne : ne jamais transmettre au client. */
    detail: any;
    estimation: WeightEstimate;
    /** Motif quand aucun prix tout compris n'est calculable. */
    indisponible?: string;
}

/**
 * Devis complet. Si le poids ou le port vendeur manquent, le prix n'est pas
 * arrêté : la commande partira en validation opérateur (régime ESTIMÉ).
 */
export async function quote(input: QuoteInput): Promise<QuoteResult> {
    const settings = await getSettings();
    const estimation = await estimateWeight({
        poidsVendeurKg: input.poidsVendeurKg,
        categoryCode: input.categoryCode,
        titre: input.titre,
        description: input.description,
        allowAi: input.allowAi === true,
    });

    const regime = getPriceRegime(estimation.source, estimation.confiance, estimation.valideParOperateur);

    // Port vendeur inconnu (fréquent : frais calculés à l'adresse) : rien n'est
    // chiffrable de façon fiable -> validation opérateur.
    if (input.portVendeurEur == null) {
        return {
            prixClientEur: null, prixHorsPortEur: null, portInconnu: true,
            regime: 'ESTIME', detail: null, estimation, indisponible: 'PORT_VENDEUR_INCONNU',
        };
    }

    // Prix hors port : toujours calculable dès que le port vendeur est connu.
    const feeTiersForPartial = await getFeeTiers();
    const partial = computePriceWithoutShipping(
        {
            prixPieceEur: input.prixPieceEur,
            portVendeurEur: input.portVendeurEur,
            valeurDeclareeEur: input.valeurDeclareeEur,
            colisNonAnnonce: input.colisNonAnnonce,
            consolidation: input.consolidation,
            settings,
        },
        feeTiersForPartial,
    );

    // Poids inconnu ou pièce hors gabarit : on affiche « prix + frais de port ».
    if (estimation.source === 'UNKNOWN' || estimation.poidsKg <= 0) {
        return {
            prixClientEur: null, prixHorsPortEur: partial.prixHorsPortEur, portInconnu: true,
            regime: 'ESTIME', detail: partial.detail, estimation, indisponible: 'POIDS_INCONNU',
        };
    }
    if (estimation.horsGabarit) {
        return {
            prixClientEur: null, prixHorsPortEur: partial.prixHorsPortEur, portInconnu: true,
            regime: 'ESTIME', detail: partial.detail, estimation, indisponible: 'HORS_GABARIT',
        };
    }

    try {
        const [tranches, feeTiers] = await Promise.all([getTranches(input.zone), getFeeTiers()]);
        const result = computeTotalPrice(
            {
                prixPieceEur: input.prixPieceEur,
                portVendeurEur: input.portVendeurEur,
                valeurDeclareeEur: input.valeurDeclareeEur,
                poidsKg: estimation.poidsKg,
                tranches,
                assurance: input.assurance,
                dims: estimation.dims,
                colisNonAnnonce: input.colisNonAnnonce,
                consolidation: input.consolidation,
                settings,
            },
            feeTiers,
        );
        return {
            prixClientEur: result.prixClientEur,
            prixHorsPortEur: partial.prixHorsPortEur,
            portInconnu: false,
            regime, detail: result.detail, estimation,
        };
    } catch (e: any) {
        if (e instanceof PricingError) {
            // Hors gabarit / poids trop élevé : on garde le prix hors port.
            return {
                prixClientEur: null, prixHorsPortEur: partial.prixHorsPortEur, portInconnu: true,
                regime: 'ESTIME', detail: partial.detail, estimation, indisponible: e.code,
            };
        }
        throw e;
    }
}

/** Écart entre estimation et pesée réelle (déclenchement d'un appel de fonds). */
export async function weightDeviation(poidsEstimeKg: number, poidsReelKg: number, zone: Zone) {
    const [tranches, settings] = await Promise.all([getTranches(zone), getSettings()]);
    return computeWeightDeviation(poidsEstimeKg, poidsReelKg, tranches, settings);
}

export { selectTranche, computeInsurance };
