import { describe, it, expect } from 'vitest';
import { normalize, translateQuery, MARKETPLACES, GLOSSARY_SIZE } from './part_glossary';

describe('part_glossary — traduction déterministe des requêtes', () => {
    it('normalise accents, casse et ponctuation', () => {
        expect(normalize('Crémaillère de DIRECTION')).toBe('cremaillere de direction');
        expect(normalize("Bobine d'allumage")).toBe('bobine d allumage');
        expect(normalize('Étrier  de   frein !')).toBe('etrier de frein');
    });

    it('traduit la pièce en conservant marque et modèle', () => {
        const de = translateQuery('plaquettes de frein BMW Serie 1', 'de');
        expect(de.matched).toBe(true);
        expect(de.query).toContain('Bremsbeläge');
        expect(de.query).toContain('bmw');   // marque conservée
        expect(de.query).toContain('serie'); // modèle conservé
    });

    it('couvre les quatre langues cibles', () => {
        const q = 'alternateur Renault Clio';
        expect(translateQuery(q, 'de').query).toContain('Lichtmaschine');
        expect(translateQuery(q, 'es').query).toContain('alternador');
        expect(translateQuery(q, 'it').query).toContain('alternatore');
        expect(translateQuery(q, 'en').query).toContain('alternator');
    });

    it('préfère le terme le plus long (« plaquettes de frein » plutôt que « frein »)', () => {
        // Sans tri par longueur, « disque » pourrait primer sur « disque de frein ».
        expect(translateQuery('disque de frein avant', 'de').query).toContain('Bremsscheiben');
    });

    it('traduit aussi la position (avant/arrière/gauche/droit)', () => {
        expect(translateQuery('plaquettes de frein avant', 'de').query).toContain('vorne');
        expect(translateQuery('phare avant droit', 'it').query).toContain('anteriore');
        expect(translateQuery('feu arriere gauche', 'es').query).toContain('trasero');
    });

    it('conserve la référence OEM, meilleure clé transfrontalière', () => {
        const r = translateQuery('plaquettes de frein 34116850568', 'de');
        expect(r.query).toContain('34116850568');
    });

    it('signale un terme inconnu au lieu de produire une requête absurde', () => {
        const r = translateQuery('bidule chose inexistant', 'de');
        expect(r.matched).toBe(false);
        expect(r.term).toBeNull();
    });

    it('retire les mots-outils français (bruit dans un titre étranger)', () => {
        const r = translateQuery('pompe a eau pour Peugeot 208', 'de');
        expect(r.query).toContain('Wasserpumpe');
        expect(r.query).not.toMatch(/\bpour\b/);
        expect(r.query).not.toMatch(/\bde\b/);
    });

    it('ne modifie pas une requête française', () => {
        const q = 'plaquettes de frein BMW';
        expect(translateQuery(q, 'fr').query).toBe(q);
    });

    it('traduit en anglais les catégories où le neuf importé domine', () => {
        // La requête AliExpress part en anglais : ses titres le sont
        // massivement, une requête française y ramène beaucoup moins.
        expect(translateQuery('autoradio android BMW Serie 1', 'en').query)
            .toContain('Android car stereo');
        expect(translateQuery('camera de recul', 'en').query).toContain('reversing camera');
        expect(translateQuery('ampoules led', 'en').query).toContain('LED headlight');
    });

    it('intègre le glossaire importé (vocabulaire technique étendu)', () => {
        expect(translateQuery('vilebrequin BMW', 'de').query).toContain('Kurbelwelle');
        expect(translateQuery('capteur ABS Renault', 'es').query).toContain('Sensor ABS');
        expect(translateQuery('joint de culasse', 'en').query).toContain('gasket');
    });

    it('n\'envoie JAMAIS une requête avec une langue manquante', () => {
        // Le glossaire importé n'a pas d'italien : le marché italien doit
        // simplement être ignoré, jamais recevoir « undefined BMW ».
        for (const terme of ['vilebrequin BMW', 'capteur ABS', 'joint de culasse', 'bielle']) {
            for (const lang of ['de', 'es', 'it', 'en'] as const) {
                const r = translateQuery(terme, lang);
                expect(r.query).not.toContain('undefined');
                expect(r.query).not.toContain('null');
                if (!r.matched) expect(r.query).toBe(terme); // requête d'origine intacte
            }
        }
    });

    it('préfère un terme plus court mais TRADUIT à un terme long incomplet', () => {
        // Un terme importé plus précis mais incomplet dans une langue ne doit
        // pas masquer un terme plus court qui, lui, y est traduit — sinon on
        // perdrait un marché entier sur un terme pourtant couvert.
        // (Cas observé sur l'italien à l'import ; le mécanisme protège toute
        // langue et tout import futur incomplet.)
        const it = translateQuery('plaquettes de frein avant BMW', 'it');
        expect(it.matched).toBe(true);
        expect(it.query).toContain('pastiglie');
        // En allemand, le terme importé plus précis reste utilisé.
        expect(translateQuery('plaquettes de frein avant BMW', 'de').query)
            .toMatch(/Bremsbel/);
    });

    it('couvre les marchés visés et un glossaire non trivial', () => {
        expect(MARKETPLACES.map(m => m.id)).toContain('EBAY_DE');
        expect(GLOSSARY_SIZE).toBeGreaterThan(50);
    });

    it('n\'interroge QUE la zone euro (pas eBay UK)', () => {
        // Prix en livres + douane/TVA depuis le Brexit : le prix « tout
        // compris » ne modélise ni l'un ni l'autre.
        expect(MARKETPLACES.map(m => m.id)).not.toContain('EBAY_GB');
    });

    it('n\'interroge pas l\'Italie (décision métier)', () => {
        // Retrait volontaire, pas un oubli : ce test empêche une
        // réactivation par inadvertance.
        expect(MARKETPLACES.map(m => m.id)).not.toContain('EBAY_IT');
        expect(MARKETPLACES.map(m => m.id)).toEqual(['EBAY_FR', 'EBAY_DE', 'EBAY_ES']);
    });
});
