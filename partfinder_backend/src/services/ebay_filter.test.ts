import { describe, it, expect } from 'vitest';
import { buildSearchFilter, estPrixFerme, MAX_SELLERS_PER_QUERY } from './ebay.service';

describe('filtre de recherche eBay', () => {
    it('exige un prix ferme (achat immédiat)', () => {
        // PartFinder annonce un prix ferme tout compris : sur une enchère,
        // ce prix n'a aucun sens.
        expect(buildSearchFilter()).toContain('buyingOptions:{FIXED_PRICE}');
    });

    it('n\'accepte que les annonces livrables en France', () => {
        expect(buildSearchFilter()).toContain('deliveryCountry:FR');
    });

    it('cumule les filtres avec des virgules', () => {
        const f = buildSearchFilter({ sellers: ['casse1'] });
        expect(f.split(',').length).toBe(3);
        expect(f).toContain('sellers:{casse1}');
    });

    it('joint plusieurs vendeurs par une barre verticale', () => {
        expect(buildSearchFilter({ sellers: ['a', 'b', 'c'] })).toContain('sellers:{a|b|c}');
    });

    it('plafonne la liste de vendeurs (au-delà, eBay rejette la requête)', () => {
        const beaucoup = Array.from({ length: MAX_SELLERS_PER_QUERY + 15 }, (_, i) => 'v' + i);
        const f = buildSearchFilter({ sellers: beaucoup });
        const liste = f.match(/sellers:\{([^}]*)\}/)![1].split('|');
        expect(liste).toHaveLength(MAX_SELLERS_PER_QUERY);
    });

    it('omet le filtre vendeurs quand la liste est vide', () => {
        expect(buildSearchFilter({ sellers: [] })).not.toContain('sellers:');
    });
});

describe('estPrixFerme — le prix annoncé doit être achetable', () => {
    it('accepte une annonce à prix fixe', () => {
        expect(estPrixFerme({ buyingOptions: ['FIXED_PRICE'], price: 100 })).toBe(true);
    });

    it('refuse une enchère seule', () => {
        expect(estPrixFerme({ buyingOptions: ['AUCTION'], price: 100 })).toBe(false);
    });

    it('accepte une annonce mixte enchère + achat immédiat', () => {
        // Elle EST achetable au prix affiché : l'écarter perdrait du stock.
        expect(estPrixFerme({
            buyingOptions: ['AUCTION', 'FIXED_PRICE'], price: 200, currentBidEur: 90,
        })).toBe(true);
    });

    it('refuse une annonce mixte dont l\'enchère a rattrapé le prix', () => {
        // Le montant affiché n'est plus celui auquel on peut acheter :
        // le prix annoncé au client serait faux.
        expect(estPrixFerme({
            buyingOptions: ['AUCTION', 'FIXED_PRICE'], price: 200, currentBidEur: 200,
        })).toBe(false);
        expect(estPrixFerme({
            buyingOptions: ['AUCTION', 'FIXED_PRICE'], price: 200, currentBidEur: 250,
        })).toBe(false);
    });

    it('ne bloque pas quand l\'information est absente (mock, autre source)', () => {
        expect(estPrixFerme({ price: 100 })).toBe(true);
        expect(estPrixFerme({ buyingOptions: null, price: 100 })).toBe(true);
    });

    it('accepte « meilleure offre » si l\'achat immédiat existe', () => {
        expect(estPrixFerme({ buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'], price: 80 })).toBe(true);
    });
});
