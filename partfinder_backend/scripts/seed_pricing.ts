import { PrismaClient } from '@prisma/client';

/**
 * Seed des référentiels de tarification (idempotent — rejouable à chaque déploiement).
 *
 * ⚠️ GRILLE COLISSIMO : les tarifs ci-dessous sont des valeurs de travail, ancrées sur
 * quelques points connus et interpolées. Ils DOIVENT être vérifiés et mis à jour depuis
 * la grille officielle La Poste chaque 1er janvier, via l'admin (Tarification →
 * grille Colissimo), sans écraser l'historique (dates de validité).
 */

const prisma = new PrismaClient();

// ── Catégories de pièces : poids de référence (kg) ──────────────────
// dims en cm (L, l, h) quand pertinent ; horsGabarit = hors normes Colissimo.
type Cat = {
    code: string; label: string; poids: number;
    dims?: [number, number, number]; horsGabarit?: boolean; syn: string[];
};

const CATEGORIES: Cat[] = [
    { code: 'alternateur', label: 'Alternateur', poids: 6, dims: [25, 20, 20], syn: ['alternateur', 'alternator', 'generatrice'] },
    { code: 'demarreur', label: 'Démarreur', poids: 5, dims: [25, 15, 15], syn: ['demarreur', 'starter', 'démarreur'] },
    { code: 'etrier-frein', label: 'Étrier de frein', poids: 4, dims: [20, 15, 15], syn: ['etrier', 'étrier', 'caliper', 'etrier de frein'] },
    { code: 'disque-frein', label: 'Disque de frein (unité)', poids: 7, dims: [35, 35, 8], syn: ['disque', 'disque de frein', 'brake disc', 'rotor'] },
    { code: 'disque-frein-paire', label: 'Disques de frein (paire)', poids: 14, dims: [35, 35, 15], syn: ['disques', 'paire de disques', 'brake discs'] },
    { code: 'plaquettes-frein', label: 'Plaquettes de frein (jeu)', poids: 2, dims: [20, 15, 10], syn: ['plaquettes', 'plaquette', 'brake pads'] },
    { code: 'phare', label: 'Phare / optique avant', poids: 2.5, dims: [50, 30, 25], syn: ['phare', 'optique', 'headlight', 'projecteur'] },
    { code: 'feu-arriere', label: 'Feu arrière', poids: 1.8, dims: [40, 25, 20], syn: ['feu arriere', 'feu arrière', 'taillight', 'optique arriere'] },
    { code: 'retroviseur', label: 'Rétroviseur', poids: 1.5, dims: [25, 20, 15], syn: ['retroviseur', 'rétroviseur', 'mirror'] },
    { code: 'turbo', label: 'Turbocompresseur', poids: 8, dims: [30, 25, 25], syn: ['turbo', 'turbocompresseur', 'turbocharger'] },
    { code: 'calculateur', label: 'Calculateur moteur (ECU)', poids: 1, dims: [25, 20, 8], syn: ['calculateur', 'ecu', 'ecm', 'boitier moteur'] },
    { code: 'pompe-injection', label: 'Pompe à injection', poids: 9, dims: [30, 25, 25], syn: ['pompe injection', 'pompe a injection', 'injection pump'] },
    { code: 'injecteur', label: 'Injecteur', poids: 0.8, dims: [20, 10, 10], syn: ['injecteur', 'injector'] },
    { code: 'radiateur', label: 'Radiateur de refroidissement', poids: 5, dims: [70, 50, 10], syn: ['radiateur', 'radiator'] },
    { code: 'condenseur-clim', label: 'Condenseur de climatisation', poids: 4, dims: [70, 45, 8], syn: ['condenseur', 'condensateur clim', 'condenser'] },
    { code: 'compresseur-clim', label: 'Compresseur de climatisation', poids: 7, dims: [30, 25, 25], syn: ['compresseur clim', 'compresseur climatisation', 'ac compressor'] },
    { code: 'boite-vitesses', label: 'Boîte de vitesses manuelle', poids: 35, dims: [70, 50, 50], horsGabarit: true, syn: ['boite de vitesses', 'boîte de vitesses', 'bv', 'gearbox', 'transmission'] },
    { code: 'culasse', label: 'Culasse', poids: 18, dims: [60, 30, 25], syn: ['culasse', 'cylinder head'] },
    { code: 'vanne-egr', label: 'Vanne EGR', poids: 2, dims: [20, 15, 15], syn: ['egr', 'vanne egr', 'egr valve'] },
    { code: 'debitmetre', label: "Débitmètre d'air", poids: 0.5, dims: [15, 10, 10], syn: ['debitmetre', 'débitmètre', 'maf', 'air flow meter'] },
    { code: 'cardan', label: 'Cardan / transmission', poids: 6, dims: [80, 15, 15], syn: ['cardan', 'arbre de transmission', 'driveshaft'] },
    { code: 'triangle-suspension', label: 'Triangle de suspension', poids: 4, dims: [50, 30, 15], syn: ['triangle', 'bras de suspension', 'control arm'] },
    { code: 'amortisseur', label: 'Amortisseur', poids: 5, dims: [65, 15, 15], syn: ['amortisseur', 'shock absorber', 'suspension'] },
    { code: 'colonne-direction', label: 'Colonne de direction', poids: 8, dims: [80, 20, 20], syn: ['colonne de direction', 'steering column'] },
    { code: 'cremaillere', label: 'Crémaillère de direction', poids: 10, dims: [90, 20, 15], syn: ['cremaillere', 'crémaillère', 'steering rack'] },
    { code: 'pompe-direction', label: 'Pompe de direction assistée', poids: 4, dims: [25, 20, 20], syn: ['pompe de direction', 'pompe assistee', 'power steering pump'] },
    { code: 'bobine-allumage', label: "Bobine d'allumage", poids: 0.4, dims: [15, 10, 10], syn: ['bobine', 'bobine allumage', 'ignition coil'] },
    { code: 'pompe-eau', label: 'Pompe à eau', poids: 2, dims: [20, 15, 15], syn: ['pompe a eau', 'pompe à eau', 'water pump'] },
    { code: 'pompe-carburant', label: 'Pompe à carburant', poids: 1.5, dims: [25, 15, 15], syn: ['pompe carburant', 'pompe essence', 'fuel pump'] },
    { code: 'sonde-lambda', label: 'Sonde lambda', poids: 0.3, dims: [15, 8, 8], syn: ['sonde lambda', 'lambda', 'oxygen sensor', 'sonde o2'] },
    { code: 'poignee-porte', label: 'Poignée de porte', poids: 0.5, dims: [25, 12, 8], syn: ['poignee', 'poignée de porte', 'door handle'] },
    { code: 'leve-vitre', label: 'Lève-vitre', poids: 2, dims: [50, 35, 10], syn: ['leve vitre', 'lève-vitre', 'window regulator'] },
    { code: 'moteur-essuie-glace', label: "Moteur d'essuie-glace", poids: 2, dims: [25, 20, 15], syn: ['essuie glace', 'moteur essuie-glace', 'wiper motor'] },
    { code: 'neiman', label: 'Neiman / antivol de direction', poids: 1, dims: [20, 15, 10], syn: ['neiman', 'antivol de direction', 'ignition lock'] },
    { code: 'compteur', label: 'Compteur / combiné d\'instruments', poids: 1.2, dims: [35, 20, 15], syn: ['compteur', 'combine', 'tableau de bord', 'instrument cluster'] },
    { code: 'airbag-volant', label: 'Airbag de volant', poids: 2, dims: [30, 30, 12], syn: ['airbag', 'airbag volant', 'air bag'] },
    { code: 'ceinture-securite', label: 'Ceinture de sécurité', poids: 1.5, dims: [30, 20, 15], syn: ['ceinture', 'ceinture de securite', 'seat belt'] },
    { code: 'silencieux', label: 'Silencieux d\'échappement', poids: 8, dims: [80, 35, 25], syn: ['silencieux', 'pot echappement', 'muffler'] },
    { code: 'catalyseur', label: 'Catalyseur', poids: 6, dims: [60, 25, 20], syn: ['catalyseur', 'pot catalytique', 'catalytic converter'] },
    { code: 'volant-moteur', label: 'Volant moteur', poids: 12, dims: [40, 40, 12], syn: ['volant moteur', 'flywheel', 'volant bi-masse'] },
    { code: 'embrayage-kit', label: 'Kit d\'embrayage', poids: 10, dims: [40, 40, 20], syn: ['embrayage', 'kit embrayage', 'clutch kit'] },
    { code: 'boitier-papillon', label: 'Boîtier papillon', poids: 1.5, dims: [20, 15, 15], syn: ['papillon', 'boitier papillon', 'throttle body'] },
    { code: 'demarreur-alternateur-supp', label: 'Support moteur', poids: 2.5, dims: [25, 20, 15], syn: ['support moteur', 'silent bloc', 'engine mount'] },
    { code: 'retroviseur-interieur', label: 'Rétroviseur intérieur', poids: 0.6, dims: [30, 12, 12], syn: ['retroviseur interieur', 'rearview mirror'] },
    { code: 'capot', label: 'Capot moteur', poids: 20, dims: [150, 130, 15], horsGabarit: true, syn: ['capot', 'hood', 'bonnet'] },
    { code: 'porte', label: 'Porte de véhicule', poids: 28, dims: [120, 100, 25], horsGabarit: true, syn: ['porte', 'portiere', 'portière', 'door'] },
    { code: 'pare-choc', label: 'Pare-chocs', poids: 9, dims: [160, 50, 40], horsGabarit: true, syn: ['pare choc', 'pare-chocs', 'bumper'] },
    { code: 'autre', label: 'Autre pièce', poids: 5, syn: ['autre', 'divers', 'piece'] },
];

// ── Grille Colissimo Outre-mer (valeurs de travail — à vérifier chaque janvier) ──
// Points d'ancrage : OM1 5 kg ≈ 38,90 € / OM1 30 kg ≈ 143 €
//                    OM2 5 kg ≈ 56,00 € / OM2 30 kg ≈ 287 €
const TRANCHES: Array<{ max: number; om1: number; om2: number }> = [
    { max: 0.5, om1: 12.55, om2: 16.90 },
    { max: 1, om1: 17.40, om2: 23.50 },
    { max: 2, om1: 24.60, om2: 34.20 },
    { max: 5, om1: 38.90, om2: 56.00 },
    { max: 10, om1: 62.50, om2: 101.00 },
    { max: 15, om1: 85.00, om2: 148.00 },
    { max: 20, om1: 105.00, om2: 195.00 },
    { max: 25, om1: 124.00, om2: 241.00 },
    { max: 30, om1: 143.00, om2: 287.00 },
];

const SETTINGS: Array<{ key: string; value: string; label: string }> = [
    { key: 'marge_pourcent', value: '15', label: 'Marge PartFinder (% du coût d\'acquisition)' },
    { key: 'marge_minimum_eur', value: '10', label: 'Marge minimum (€)' },
    { key: 'marge_securite_port_pourcent', value: '12', label: 'Marge de sécurité sur le port estimé (%)' },
    { key: 'consolidation_forfait_eur', value: '15', label: 'Forfait de consolidation multi-colis (€)' },
    { key: 'supplement_colis_non_annonce_eur', value: '5', label: 'Supplément colis non annoncé (€)' },
    { key: 'stockage_jours_gratuits', value: '15', label: 'Jours de stockage gratuits' },
    { key: 'stockage_prix_jour_eur', value: '1', label: 'Stockage au-delà (€/jour)' },
    { key: 'assurance_marge_eur', value: '2', label: 'Marge sur l\'option assurance ad valorem (€)' },
    { key: 'seuil_ecart_tranches', value: '2', label: 'Écart de tranches déclenchant un appel de fonds' },
    { key: 'supplement_gabarit_eur', value: '6', label: 'Supplément hors gabarit (€, somme dims 150–200 cm)' },
    { key: 'indemnisation_standard_eur_kg', value: '23', label: 'Indemnisation Colissimo standard (€/kg)' },
];

async function main() {
    // Catégories
    for (const c of CATEGORIES) {
        await prisma.partCategory.upsert({
            where: { code: c.code },
            update: {
                labelFr: c.label, poidsKg: c.poids, synonymes: c.syn,
                horsGabarit: c.horsGabarit ?? false,
                longueurCm: c.dims?.[0] ?? null, largeurCm: c.dims?.[1] ?? null, hauteurCm: c.dims?.[2] ?? null,
            },
            create: {
                code: c.code, labelFr: c.label, poidsKg: c.poids, synonymes: c.syn,
                horsGabarit: c.horsGabarit ?? false,
                longueurCm: c.dims?.[0] ?? null, largeurCm: c.dims?.[1] ?? null, hauteurCm: c.dims?.[2] ?? null,
            },
        });
    }

    // Grille Colissimo (uniquement si aucune grille en cours de validité)
    const existingRates = await prisma.colissimoRate.count({ where: { valideAu: null } });
    if (existingRates === 0) {
        const valideDu = new Date('2026-01-01');
        for (const t of TRANCHES) {
            await prisma.colissimoRate.create({ data: { zone: 'OM1', poidsMaxKg: t.max, prixEur: t.om1, valideDu } });
            await prisma.colissimoRate.create({ data: { zone: 'OM2', poidsMaxKg: t.max, prixEur: t.om2, valideDu } });
        }
        console.log(`[seed] grille Colissimo initialisée (${TRANCHES.length * 2} tranches)`);
    }

    // Frais de traitement
    if (await prisma.processingFeeTier.count() === 0) {
        await prisma.processingFeeTier.createMany({
            data: [
                { valeurMinEur: 0, valeurMaxEur: 50, fraisEur: 9 },
                { valeurMinEur: 50, valeurMaxEur: 100, fraisEur: 10 },
                { valeurMinEur: 100, valeurMaxEur: 500, fraisEur: 20 },
                { valeurMinEur: 500, valeurMaxEur: null, fraisEur: 30 },
            ],
        });
        console.log('[seed] frais de traitement initialisés');
    }

    // Paramètres (create only : ne jamais écraser un réglage modifié en admin)
    for (const s of SETTINGS) {
        const exists = await prisma.pricingSetting.findUnique({ where: { key: s.key } });
        if (!exists) {
            await prisma.pricingSetting.create({ data: { key: s.key, value: s.value, label: s.label, type: 'number' } });
        }
    }

    console.log(`[seed] tarification OK — ${CATEGORIES.length} catégories, ${SETTINGS.length} paramètres`);
}

main()
    .catch((e) => { console.error('[seed] échec:', e.message); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
