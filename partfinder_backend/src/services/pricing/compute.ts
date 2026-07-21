/**
 * Calcul du prix tout compris — FONCTIONS PURES (aucune dépendance base ou réseau).
 *
 * Prix client = prix pièce + port vendeur→Sarralbe + frais de traitement
 *             + port Colissimo estimé + assurance (option) + marge PartFinder
 *
 * Le client ne voit QUE le total. La décomposition reste interne.
 * Tous les calculs monétaires se font en CENTIMES entiers pour éviter les
 * erreurs de virgule flottante, puis sont reconvertis en euros.
 */

export type Zone = 'OM1' | 'OM2';
export type AssuranceOption = 'STANDARD' | 'AD_VALOREM';
export type WeightSource = 'SELLER' | 'CATALOG' | 'AI_CACHED' | 'AI' | 'UNKNOWN';
export type PriceRegime = 'FERME' | 'ESTIME';

export interface PricingSettings {
    margePourcent: number;
    margeMinimumEur: number;
    margeSecuritePortPourcent: number;
    consolidationForfaitEur: number;
    supplementColisNonAnnonceEur: number;
    stockageJoursGratuits: number;
    stockagePrixJourEur: number;
    assuranceMargeEur: number;
    seuilEcartTranches: number;
    supplementGabaritEur: number;
    indemnisationStandardEurKg: number;
    /** ⚠️ À vérifier sur la grille officielle La Poste (option ad valorem). */
    assuranceAdValoremPourcent: number;
    assuranceAdValoremMinEur: number;
}

export const DEFAULT_SETTINGS: PricingSettings = {
    margePourcent: 15,
    margeMinimumEur: 10,
    margeSecuritePortPourcent: 12,
    consolidationForfaitEur: 15,
    supplementColisNonAnnonceEur: 5,
    stockageJoursGratuits: 15,
    stockagePrixJourEur: 1,
    assuranceMargeEur: 2,
    seuilEcartTranches: 2,
    supplementGabaritEur: 6,
    indemnisationStandardEurKg: 23,
    assuranceAdValoremPourcent: 1,
    assuranceAdValoremMinEur: 1.5,
};

// ── Contraintes Colissimo ────────────────────────────────────────────
export const MAX_WEIGHT_KG = 30;
export const MAX_LENGTH_CM = 100;
export const DIMS_SUM_STANDARD_CM = 150;   // au-delà : supplément
export const DIMS_SUM_MAX_CM = 200;        // au-delà : refus

export class PricingError extends Error {
    constructor(message: string, readonly code: string) {
        super(message);
        this.name = 'PricingError';
    }
}

// ── Utilitaires monétaires (centimes) ────────────────────────────────
const toCents = (eur: number) => Math.round(eur * 100);
const toEur = (cents: number) => cents / 100;

/** Arrondi au dixième d'euro SUPÉRIEUR (0,10 €). */
export function roundUpTo10Cents(eur: number): number {
    return Math.ceil(toCents(eur) / 10) * 10 / 100;
}

// ── Grille Colissimo ─────────────────────────────────────────────────
export interface RateTranche {
    poidsMaxKg: number;
    prixEur: number;
}

/**
 * Sélectionne la tranche dont le poids maximum couvre le poids donné.
 * Les tranches n'ont pas besoin d'être triées.
 */
export function selectTranche(poidsKg: number, tranches: RateTranche[]): RateTranche {
    if (!tranches.length) {
        throw new PricingError('Aucune grille tarifaire disponible pour cette zone.', 'NO_GRID');
    }
    const sorted = [...tranches].sort((a, b) => a.poidsMaxKg - b.poidsMaxKg);
    const found = sorted.find((t) => poidsKg <= t.poidsMaxKg);
    if (!found) {
        throw new PricingError(
            `Poids ${poidsKg} kg au-delà de la tranche maximale (${sorted[sorted.length - 1].poidsMaxKg} kg).`,
            'WEIGHT_TOO_HIGH',
        );
    }
    return found;
}

export interface ParcelDims {
    longueurCm?: number | null;
    largeurCm?: number | null;
    hauteurCm?: number | null;
}

export interface LimitsResult {
    accepte: boolean;
    supplementGabaritEur: number;
    raison?: string;
}

/** Contrôle des limites Colissimo : poids, longueur, somme des dimensions. */
export function checkParcelLimits(
    poidsKg: number,
    dims: ParcelDims = {},
    settings: PricingSettings = DEFAULT_SETTINGS,
): LimitsResult {
    if (poidsKg > MAX_WEIGHT_KG) {
        return { accepte: false, supplementGabaritEur: 0, raison: `Poids ${poidsKg} kg > ${MAX_WEIGHT_KG} kg (limite Colissimo).` };
    }
    const l = dims.longueurCm ?? 0;
    const w = dims.largeurCm ?? 0;
    const h = dims.hauteurCm ?? 0;
    const somme = l + w + h;

    if (l > MAX_LENGTH_CM) {
        return { accepte: false, supplementGabaritEur: 0, raison: `Longueur ${l} cm > ${MAX_LENGTH_CM} cm.` };
    }
    if (somme > DIMS_SUM_MAX_CM) {
        return { accepte: false, supplementGabaritEur: 0, raison: `Somme des dimensions ${somme} cm > ${DIMS_SUM_MAX_CM} cm.` };
    }
    if (somme > DIMS_SUM_STANDARD_CM) {
        return { accepte: true, supplementGabaritEur: settings.supplementGabaritEur };
    }
    return { accepte: true, supplementGabaritEur: 0 };
}

export interface ShippingResult {
    poidsFactureKg: number;   // poids majoré de la marge de sécurité
    trancheKg: number;
    portEur: number;
    supplementGabaritEur: number;
}

/**
 * Port Colissimo estimé : on majore d'abord le poids de la marge de sécurité,
 * PUIS on sélectionne la tranche (une sous-estimation coûte le port réel).
 */
export function computeShipping(
    poidsKg: number,
    tranches: RateTranche[],
    settings: PricingSettings = DEFAULT_SETTINGS,
    dims: ParcelDims = {},
): ShippingResult {
    if (!(poidsKg > 0)) throw new PricingError('Poids invalide.', 'INVALID_WEIGHT');

    const limits = checkParcelLimits(poidsKg, dims, settings);
    if (!limits.accepte) throw new PricingError(limits.raison!, 'OUT_OF_GAUGE');

    const poidsFactureKg = poidsKg * (1 + settings.margeSecuritePortPourcent / 100);
    if (poidsFactureKg > MAX_WEIGHT_KG) {
        throw new PricingError(
            `Poids majoré ${poidsFactureKg.toFixed(2)} kg > ${MAX_WEIGHT_KG} kg (limite Colissimo).`,
            'WEIGHT_TOO_HIGH',
        );
    }

    const tranche = selectTranche(poidsFactureKg, tranches);
    return {
        poidsFactureKg: Math.round(poidsFactureKg * 100) / 100,
        trancheKg: tranche.poidsMaxKg,
        portEur: tranche.prixEur,
        supplementGabaritEur: limits.supplementGabaritEur,
    };
}

// ── Frais de traitement ──────────────────────────────────────────────
export interface FeeTier {
    valeurMinEur: number;
    valeurMaxEur: number | null; // null = infini
    fraisEur: number;
}

/** Tranche applicable : min <= valeur < max (max null = infini). */
export function findProcessingFee(valeurEur: number, tiers: FeeTier[]): number {
    if (!tiers.length) throw new PricingError('Aucune grille de frais de traitement.', 'NO_FEE_GRID');
    const sorted = [...tiers].sort((a, b) => a.valeurMinEur - b.valeurMinEur);
    const tier = sorted.find(
        (t) => valeurEur >= t.valeurMinEur && (t.valeurMaxEur === null || valeurEur < t.valeurMaxEur),
    );
    if (!tier) throw new PricingError(`Aucune tranche de frais pour ${valeurEur} €.`, 'NO_FEE_TIER');
    return tier.fraisEur;
}

// ── Assurance ────────────────────────────────────────────────────────
export interface InsuranceResult {
    coutEur: number;
    adValoremRecommande: boolean;
    indemnisationStandardEur: number;
}

/**
 * Standard : incluse (0 €), indemnisation plafonnée à 23 €/kg.
 * Ad valorem : coût option Colissimo + marge PartFinder.
 * L'ad valorem est recommandé dès que la valeur dépasse l'indemnisation standard.
 */
export function computeInsurance(
    valeurEur: number,
    poidsKg: number,
    option: AssuranceOption = 'STANDARD',
    settings: PricingSettings = DEFAULT_SETTINGS,
): InsuranceResult {
    const indemnisationStandardEur = settings.indemnisationStandardEurKg * poidsKg;
    const adValoremRecommande = valeurEur > indemnisationStandardEur;

    if (option === 'STANDARD') {
        return { coutEur: 0, adValoremRecommande, indemnisationStandardEur };
    }
    const coutColissimo = Math.max(
        valeurEur * (settings.assuranceAdValoremPourcent / 100),
        settings.assuranceAdValoremMinEur,
    );
    return {
        coutEur: Math.round((coutColissimo + settings.assuranceMargeEur) * 100) / 100,
        adValoremRecommande,
        indemnisationStandardEur,
    };
}

// ── Marge ────────────────────────────────────────────────────────────
/** Marge = max(% du coût d'acquisition, marge minimum). */
export function computeMargin(
    prixPieceEur: number,
    portVendeurEur: number,
    settings: PricingSettings = DEFAULT_SETTINGS,
): number {
    const coutAcquisition = prixPieceEur + portVendeurEur;
    const margePct = coutAcquisition * (settings.margePourcent / 100);
    return Math.round(Math.max(margePct, settings.margeMinimumEur) * 100) / 100;
}

// ── Régime de prix ───────────────────────────────────────────────────
/**
 * FERME si le poids provient du vendeur ou du catalogue, ou d'une
 * classification IA validée par un opérateur. ESTIMÉ sinon.
 */
export function getPriceRegime(
    source: WeightSource,
    confiance = 0,
    valideParOperateur = false,
    seuilConfiance = 0.6,
): PriceRegime {
    if (source === 'SELLER' || source === 'CATALOG') return 'FERME';
    if ((source === 'AI' || source === 'AI_CACHED') && valideParOperateur) return 'FERME';
    if ((source === 'AI' || source === 'AI_CACHED') && confiance >= seuilConfiance) return 'ESTIME';
    return 'ESTIME';
}

// ── Prix total ───────────────────────────────────────────────────────
export interface TotalPriceInput {
    prixPieceEur: number;
    portVendeurEur: number;
    valeurDeclareeEur?: number;   // défaut : prix de la pièce
    poidsKg: number;
    tranches: RateTranche[];
    assurance?: AssuranceOption;
    dims?: ParcelDims;
    colisNonAnnonce?: boolean;
    consolidation?: boolean;
    settings?: PricingSettings;
}

/** Décomposition INTERNE (jamais exposée au client). */
export interface PriceBreakdown {
    prixPieceEur: number;
    portVendeurEur: number;
    fraisTraitementEur: number;
    portColissimoEur: number;
    supplementGabaritEur: number;
    supplementColisNonAnnonceEur: number;
    consolidationEur: number;
    assuranceEur: number;
    margeEur: number;
    coutAcquisitionEur: number;
    poidsFactureKg: number;
    trancheKg: number;
    valeurDeclareeEur: number;
    adValoremRecommande: boolean;
}

export interface TotalPriceResult {
    /** LE seul montant montré au client. */
    prixClientEur: number;
    detail: PriceBreakdown;
}

export function computeTotalPrice(
    input: TotalPriceInput,
    feeTiers: FeeTier[],
): TotalPriceResult {
    const settings = input.settings ?? DEFAULT_SETTINGS;
    const valeurDeclareeEur = input.valeurDeclareeEur ?? input.prixPieceEur;

    const shipping = computeShipping(input.poidsKg, input.tranches, settings, input.dims);
    const fraisTraitementEur = findProcessingFee(valeurDeclareeEur, feeTiers);
    const insurance = computeInsurance(valeurDeclareeEur, input.poidsKg, input.assurance ?? 'STANDARD', settings);
    const margeEur = computeMargin(input.prixPieceEur, input.portVendeurEur, settings);

    const supplementColisNonAnnonceEur = input.colisNonAnnonce ? settings.supplementColisNonAnnonceEur : 0;
    const consolidationEur = input.consolidation ? settings.consolidationForfaitEur : 0;

    // Somme en centimes pour éviter toute dérive de virgule flottante.
    const totalCents =
        toCents(input.prixPieceEur) +
        toCents(input.portVendeurEur) +
        toCents(fraisTraitementEur) +
        toCents(shipping.portEur) +
        toCents(shipping.supplementGabaritEur) +
        toCents(supplementColisNonAnnonceEur) +
        toCents(consolidationEur) +
        toCents(insurance.coutEur) +
        toCents(margeEur);

    return {
        prixClientEur: roundUpTo10Cents(toEur(totalCents)),
        detail: {
            prixPieceEur: input.prixPieceEur,
            portVendeurEur: input.portVendeurEur,
            fraisTraitementEur,
            portColissimoEur: shipping.portEur,
            supplementGabaritEur: shipping.supplementGabaritEur,
            supplementColisNonAnnonceEur,
            consolidationEur,
            assuranceEur: insurance.coutEur,
            margeEur,
            coutAcquisitionEur: Math.round((input.prixPieceEur + input.portVendeurEur) * 100) / 100,
            poidsFactureKg: shipping.poidsFactureKg,
            trancheKg: shipping.trancheKg,
            valeurDeclareeEur,
            adValoremRecommande: insurance.adValoremRecommande,
        },
    };
}

// ── Prix hors port d'acheminement ────────────────────────────────────
export interface PartialPriceInput {
    prixPieceEur: number;
    portVendeurEur: number;
    valeurDeclareeEur?: number;
    colisNonAnnonce?: boolean;
    consolidation?: boolean;
    settings?: PricingSettings;
}

export interface PartialPriceResult {
    /** Tout sauf le port outre-mer (qui exige de connaître le poids). */
    prixHorsPortEur: number;
    detail: {
        prixPieceEur: number;
        portVendeurEur: number;
        fraisTraitementEur: number;
        supplementColisNonAnnonceEur: number;
        consolidationEur: number;
        margeEur: number;
        coutAcquisitionEur: number;
        valeurDeclareeEur: number;
    };
}

/**
 * Prix calculable SANS connaître le poids : toutes les composantes sauf le port
 * Colissimo. Sert à afficher « XX € + frais de port » sur les résultats de
 * recherche, sans déclencher d'appel IA pour chaque annonce.
 */
export function computePriceWithoutShipping(
    input: PartialPriceInput,
    feeTiers: FeeTier[],
): PartialPriceResult {
    const settings = input.settings ?? DEFAULT_SETTINGS;
    const valeurDeclareeEur = input.valeurDeclareeEur ?? input.prixPieceEur;

    const fraisTraitementEur = findProcessingFee(valeurDeclareeEur, feeTiers);
    const margeEur = computeMargin(input.prixPieceEur, input.portVendeurEur, settings);
    const supplementColisNonAnnonceEur = input.colisNonAnnonce ? settings.supplementColisNonAnnonceEur : 0;
    const consolidationEur = input.consolidation ? settings.consolidationForfaitEur : 0;

    const totalCents =
        toCents(input.prixPieceEur) +
        toCents(input.portVendeurEur) +
        toCents(fraisTraitementEur) +
        toCents(supplementColisNonAnnonceEur) +
        toCents(consolidationEur) +
        toCents(margeEur);

    return {
        prixHorsPortEur: roundUpTo10Cents(toEur(totalCents)),
        detail: {
            prixPieceEur: input.prixPieceEur,
            portVendeurEur: input.portVendeurEur,
            fraisTraitementEur,
            supplementColisNonAnnonceEur,
            consolidationEur,
            margeEur,
            coutAcquisitionEur: Math.round((input.prixPieceEur + input.portVendeurEur) * 100) / 100,
            valeurDeclareeEur,
        },
    };
}

// ── Écart de pesée ───────────────────────────────────────────────────
/**
 * Compare l'estimation à la pesée réelle : renvoie l'écart en NOMBRE DE
 * TRANCHES et le complément de port à appeler si le seuil est franchi.
 */
export function computeWeightDeviation(
    poidsEstimeKg: number,
    poidsReelKg: number,
    tranches: RateTranche[],
    settings: PricingSettings = DEFAULT_SETTINGS,
): { ecartTranches: number; complementEur: number; declencheAppelDeFonds: boolean } {
    const sorted = [...tranches].sort((a, b) => a.poidsMaxKg - b.poidsMaxKg);
    const idx = (kg: number) => {
        const majore = kg * (1 + settings.margeSecuritePortPourcent / 100);
        const i = sorted.findIndex((t) => majore <= t.poidsMaxKg);
        return i === -1 ? sorted.length : i; // hors grille = au-delà de la dernière
    };
    const iEstime = idx(poidsEstimeKg);
    const iReel = idx(poidsReelKg);
    const ecartTranches = iReel - iEstime;

    const prixAt = (i: number) => (i < sorted.length ? sorted[i].prixEur : sorted[sorted.length - 1].prixEur);
    const complementEur = Math.max(0, Math.round((prixAt(iReel) - prixAt(iEstime)) * 100) / 100);

    return {
        ecartTranches,
        complementEur,
        declencheAppelDeFonds: ecartTranches >= settings.seuilEcartTranches && complementEur > 0,
    };
}
