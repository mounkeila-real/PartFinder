import { describe, it, expect } from 'vitest';
import {
    roundUpTo10Cents, selectTranche, checkParcelLimits, computeShipping,
    findProcessingFee, computeInsurance, computeMargin, getPriceRegime,
    computeTotalPrice, computePriceWithoutShipping, computeWeightDeviation, PricingError,
    DEFAULT_SETTINGS, type RateTranche, type FeeTier,
} from './compute';

// Grille de test (proche de la grille OM1 réelle)
const TRANCHES: RateTranche[] = [
    { poidsMaxKg: 0.5, prixEur: 12.55 },
    { poidsMaxKg: 1, prixEur: 17.40 },
    { poidsMaxKg: 2, prixEur: 24.60 },
    { poidsMaxKg: 5, prixEur: 38.90 },
    { poidsMaxKg: 10, prixEur: 62.50 },
    { poidsMaxKg: 15, prixEur: 85.00 },
    { poidsMaxKg: 20, prixEur: 105.00 },
    { poidsMaxKg: 25, prixEur: 124.00 },
    { poidsMaxKg: 30, prixEur: 143.00 },
];

const TIERS: FeeTier[] = [
    { valeurMinEur: 0, valeurMaxEur: 50, fraisEur: 9 },
    { valeurMinEur: 50, valeurMaxEur: 100, fraisEur: 10 },
    { valeurMinEur: 100, valeurMaxEur: 500, fraisEur: 20 },
    { valeurMinEur: 500, valeurMaxEur: null, fraisEur: 30 },
];

describe('roundUpTo10Cents', () => {
    it('arrondit au dixième d\'euro supérieur', () => {
        expect(roundUpTo10Cents(10.01)).toBe(10.1);
        expect(roundUpTo10Cents(10.11)).toBe(10.2);
        expect(roundUpTo10Cents(99.999)).toBe(100);
    });
    it('laisse inchangé un montant déjà arrondi', () => {
        expect(roundUpTo10Cents(10.1)).toBe(10.1);
        expect(roundUpTo10Cents(12)).toBe(12);
    });
});

describe('selectTranche', () => {
    it('prend la tranche supérieure', () => {
        expect(selectTranche(3, TRANCHES).poidsMaxKg).toBe(5);
        expect(selectTranche(10.1, TRANCHES).poidsMaxKg).toBe(15);
    });
    it('respecte les bornes exactes (poids = borne)', () => {
        expect(selectTranche(5, TRANCHES).prixEur).toBe(38.90);
        expect(selectTranche(0.5, TRANCHES).prixEur).toBe(12.55);
        expect(selectTranche(30, TRANCHES).prixEur).toBe(143.00);
    });
    it('échoue au-delà de la dernière tranche', () => {
        expect(() => selectTranche(31, TRANCHES)).toThrow(PricingError);
    });
    it('échoue si la grille est vide', () => {
        expect(() => selectTranche(1, [])).toThrow(/Aucune grille/);
    });
});

describe('checkParcelLimits', () => {
    it('accepte un colis standard', () => {
        expect(checkParcelLimits(5, { longueurCm: 40, largeurCm: 30, hauteurCm: 20 }))
            .toEqual({ accepte: true, supplementGabaritEur: 0 });
    });
    it('applique le supplément entre 150 et 200 cm de somme', () => {
        const r = checkParcelLimits(5, { longueurCm: 90, largeurCm: 50, hauteurCm: 40 }); // 180
        expect(r.accepte).toBe(true);
        expect(r.supplementGabaritEur).toBe(DEFAULT_SETTINGS.supplementGabaritEur);
    });
    it('refuse au-delà de 200 cm de somme', () => {
        const r = checkParcelLimits(5, { longueurCm: 100, largeurCm: 60, hauteurCm: 50 }); // 210
        expect(r.accepte).toBe(false);
    });
    it('refuse une longueur > 100 cm', () => {
        expect(checkParcelLimits(5, { longueurCm: 120, largeurCm: 10, hauteurCm: 10 }).accepte).toBe(false);
    });
    it('refuse un poids > 30 kg', () => {
        expect(checkParcelLimits(35).accepte).toBe(false);
    });
});

describe('computeShipping', () => {
    it('applique la marge de sécurité AVANT de choisir la tranche', () => {
        // 4,6 kg + 12 % = 5,152 kg -> tranche 10 kg (et non 5 kg)
        const r = computeShipping(4.6, TRANCHES);
        expect(r.trancheKg).toBe(10);
        expect(r.portEur).toBe(62.50);
    });
    it('reste dans la tranche quand la majoration ne la dépasse pas', () => {
        // 4 kg + 12 % = 4,48 kg -> tranche 5 kg
        expect(computeShipping(4, TRANCHES).trancheKg).toBe(5);
    });
    it('échoue si le poids majoré dépasse 30 kg', () => {
        expect(() => computeShipping(28, TRANCHES)).toThrow(/30 kg/); // 28 * 1,12 = 31,36
    });
    it('échoue sur un colis hors gabarit', () => {
        expect(() => computeShipping(5, TRANCHES, DEFAULT_SETTINGS, { longueurCm: 130 }))
            .toThrow(PricingError);
    });
    it('refuse un poids nul ou négatif', () => {
        expect(() => computeShipping(0, TRANCHES)).toThrow(/Poids invalide/);
    });
});

describe('findProcessingFee', () => {
    it('applique la bonne tranche', () => {
        expect(findProcessingFee(30, TIERS)).toBe(9);
        expect(findProcessingFee(75, TIERS)).toBe(10);
        expect(findProcessingFee(250, TIERS)).toBe(20);
        expect(findProcessingFee(900, TIERS)).toBe(30);
    });
    it('gère les bornes : la borne basse appartient à la tranche supérieure', () => {
        expect(findProcessingFee(49.99, TIERS)).toBe(9);
        expect(findProcessingFee(50, TIERS)).toBe(10);
        expect(findProcessingFee(99.99, TIERS)).toBe(10);
        expect(findProcessingFee(100, TIERS)).toBe(20);
        expect(findProcessingFee(499.99, TIERS)).toBe(20);
        expect(findProcessingFee(500, TIERS)).toBe(30);
    });
    it('gère la valeur 0', () => {
        expect(findProcessingFee(0, TIERS)).toBe(9);
    });
});

describe('computeInsurance', () => {
    it('standard : gratuite, indemnisation 23 €/kg', () => {
        const r = computeInsurance(100, 5, 'STANDARD');
        expect(r.coutEur).toBe(0);
        expect(r.indemnisationStandardEur).toBe(115);
        expect(r.adValoremRecommande).toBe(false); // 100 < 115
    });
    it('recommande l\'ad valorem quand la valeur dépasse 23 €/kg', () => {
        expect(computeInsurance(200, 5, 'STANDARD').adValoremRecommande).toBe(true);
    });
    it('ad valorem : coût Colissimo + marge PartFinder', () => {
        // 500 € * 1 % = 5 € + marge 2 € = 7 €
        expect(computeInsurance(500, 5, 'AD_VALOREM').coutEur).toBe(7);
    });
    it('ad valorem : applique le minimum Colissimo sur les petites valeurs', () => {
        // 50 € * 1 % = 0,50 € -> minimum 1,50 € + marge 2 € = 3,50 €
        expect(computeInsurance(50, 1, 'AD_VALOREM').coutEur).toBe(3.5);
    });
});

describe('computeMargin', () => {
    it('applique le pourcentage quand il dépasse le minimum', () => {
        expect(computeMargin(200, 20)).toBe(33); // 15 % de 220
    });
    it('applique la marge MINIMUM sur les petits montants', () => {
        expect(computeMargin(20, 5)).toBe(10); // 15 % de 25 = 3,75 -> 10 €
    });
    it('respecte le seuil de bascule', () => {
        // marge mini atteinte à 66,67 € de coût d'acquisition
        expect(computeMargin(60, 0)).toBe(10);   // 9 -> 10
        expect(computeMargin(70, 0)).toBe(10.5); // 10,5 > 10
    });
});

describe('getPriceRegime', () => {
    it('FERME pour un poids vendeur ou catalogue', () => {
        expect(getPriceRegime('SELLER')).toBe('FERME');
        expect(getPriceRegime('CATALOG')).toBe('FERME');
    });
    it('ESTIME pour l\'IA non validée, même très confiante', () => {
        expect(getPriceRegime('AI', 0.95)).toBe('ESTIME');
    });
    it('FERME pour une classification IA validée par un opérateur', () => {
        expect(getPriceRegime('AI_CACHED', 0.4, true)).toBe('FERME');
    });
    it('ESTIME si la source est inconnue', () => {
        expect(getPriceRegime('UNKNOWN')).toBe('ESTIME');
    });
});

describe('computeTotalPrice', () => {
    it('somme toutes les composantes et arrondit au dixième supérieur', () => {
        const r = computeTotalPrice(
            { prixPieceEur: 120, portVendeurEur: 15, poidsKg: 6, tranches: TRANCHES },
            TIERS,
        );
        // pièce 120 + port vendeur 15 + frais 20 + Colissimo (6*1,12=6,72 -> 10 kg) 62,50
        // + assurance 0 + marge max(15 % de 135 = 20,25 ; 10) = 20,25  => 237,75 -> 237,80
        expect(r.detail.fraisTraitementEur).toBe(20);
        expect(r.detail.portColissimoEur).toBe(62.50);
        expect(r.detail.margeEur).toBe(20.25);
        expect(r.prixClientEur).toBe(237.80);
    });

    it('n\'expose qu\'un seul montant client mais conserve le détail interne', () => {
        const r = computeTotalPrice(
            { prixPieceEur: 50, portVendeurEur: 8, poidsKg: 2, tranches: TRANCHES },
            TIERS,
        );
        expect(typeof r.prixClientEur).toBe('number');
        expect(r.detail).toHaveProperty('margeEur');
        expect(r.detail).toHaveProperty('portColissimoEur');
        expect(r.detail.coutAcquisitionEur).toBe(58);
    });

    it('ajoute les suppléments (non annoncé + consolidation)', () => {
        const base = computeTotalPrice(
            { prixPieceEur: 100, portVendeurEur: 10, poidsKg: 3, tranches: TRANCHES },
            TIERS,
        );
        const avec = computeTotalPrice(
            { prixPieceEur: 100, portVendeurEur: 10, poidsKg: 3, tranches: TRANCHES, colisNonAnnonce: true, consolidation: true },
            TIERS,
        );
        expect(avec.prixClientEur - base.prixClientEur).toBeCloseTo(20, 2); // 5 + 15
    });

    it('inclut le coût de l\'assurance ad valorem', () => {
        const std = computeTotalPrice(
            { prixPieceEur: 400, portVendeurEur: 10, poidsKg: 3, tranches: TRANCHES },
            TIERS,
        );
        const adv = computeTotalPrice(
            { prixPieceEur: 400, portVendeurEur: 10, poidsKg: 3, tranches: TRANCHES, assurance: 'AD_VALOREM' },
            TIERS,
        );
        expect(adv.prixClientEur).toBeGreaterThan(std.prixClientEur);
        expect(adv.detail.assuranceEur).toBe(6); // 400*1% = 4 + 2
    });

    it('propage l\'erreur hors gabarit', () => {
        expect(() => computeTotalPrice(
            { prixPieceEur: 100, portVendeurEur: 10, poidsKg: 35, tranches: TRANCHES },
            TIERS,
        )).toThrow(PricingError);
    });

    it('ne perd pas de centimes (calcul en entiers)', () => {
        const r = computeTotalPrice(
            { prixPieceEur: 0.1, portVendeurEur: 0.2, poidsKg: 0.4, tranches: TRANCHES },
            TIERS,
        );
        // 0,10 + 0,20 + 9 + 12,55 + marge mini 10 = 31,85 -> 31,90
        expect(r.prixClientEur).toBe(31.90);
    });
});

describe('computePriceWithoutShipping', () => {
    it('calcule tout sauf le port outre-mer', () => {
        const r = computePriceWithoutShipping({ prixPieceEur: 120, portVendeurEur: 15 }, TIERS);
        // 120 + 15 + frais 20 + marge 20,25 = 175,25 -> 175,30
        expect(r.prixHorsPortEur).toBe(175.30);
        expect(r.detail.fraisTraitementEur).toBe(20);
        expect(r.detail.margeEur).toBe(20.25);
    });

    it('correspond au prix complet moins le port Colissimo', () => {
        const complet = computeTotalPrice(
            { prixPieceEur: 120, portVendeurEur: 15, poidsKg: 6, tranches: TRANCHES },
            TIERS,
        );
        const partiel = computePriceWithoutShipping({ prixPieceEur: 120, portVendeurEur: 15 }, TIERS);
        // 237,80 - 62,50 = 175,30
        expect(complet.prixClientEur - complet.detail.portColissimoEur).toBeCloseTo(partiel.prixHorsPortEur, 2);
    });

    it('applique la marge minimum sur les petits montants', () => {
        const r = computePriceWithoutShipping({ prixPieceEur: 20, portVendeurEur: 5 }, TIERS);
        expect(r.detail.margeEur).toBe(10);
        // 20 + 5 + 9 + 10 = 44
        expect(r.prixHorsPortEur).toBe(44);
    });

    it('inclut les suppléments', () => {
        const r = computePriceWithoutShipping(
            { prixPieceEur: 100, portVendeurEur: 10, colisNonAnnonce: true, consolidation: true },
            TIERS,
        );
        expect(r.detail.supplementColisNonAnnonceEur).toBe(5);
        expect(r.detail.consolidationEur).toBe(15);
    });
});

describe('computeWeightDeviation', () => {
    it('absorbe un écart inférieur au seuil', () => {
        // 4 kg -> tranche 5 ; 4,3 kg -> tranche 5 (aucun écart)
        const r = computeWeightDeviation(4, 4.3, TRANCHES);
        expect(r.ecartTranches).toBe(0);
        expect(r.declencheAppelDeFonds).toBe(false);
    });
    it('déclenche un appel de fonds au-delà du seuil de 2 tranches', () => {
        // 2 kg (-> 5 kg) vs 9 kg (-> 15 kg) : 2 tranches d'écart
        const r = computeWeightDeviation(2, 9, TRANCHES);
        expect(r.ecartTranches).toBeGreaterThanOrEqual(2);
        expect(r.declencheAppelDeFonds).toBe(true);
        expect(r.complementEur).toBeGreaterThan(0);
    });
    it('ne réclame rien si le colis est plus léger que prévu', () => {
        const r = computeWeightDeviation(10, 2, TRANCHES);
        expect(r.complementEur).toBe(0);
        expect(r.declencheAppelDeFonds).toBe(false);
    });
});
