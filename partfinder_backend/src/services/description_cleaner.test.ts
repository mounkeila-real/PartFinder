import { describe, it, expect } from 'vitest';
import { cleanEbayDescription, neutralizeSource } from './description_cleaner';

describe('description_cleaner — couper le gabarit, garder l\'information', () => {
    it('coupe le menu de boutique allemand', () => {
        const html = `<p>Gelenksatz für Mercedes-Benz W169. Geprüfte Funktion, 6 Monate Garantie.</p>
            <div>Shop-Kategorien</div><ul><li>ABS Sensor</li><li>Gasfeder</li><li>Wasserpumpe</li></ul>`;
        const r = cleanEbayDescription(html);
        expect(r).toContain('Gelenksatz');
        expect(r).toContain('Garantie');
        expect(r.toLowerCase()).not.toContain('shop-kategorien');
        expect(r).not.toContain('Gasfeder');
    });

    it('coupe la mention de traduction automatique du vendeur', () => {
        const html = '<p>Cardan avant gauche, état correct, quelques traces d\'usure normales.</p>'
            + '<p>Cette fiche produit a été automatiquement traduite.</p>';
        const r = cleanEbayDescription(html);
        expect(r).toContain('Cardan avant gauche');
        expect(r.toLowerCase()).not.toContain('automatiquement traduite');
    });

    it('PRÉSERVE une description française détaillée', () => {
        // Cas critique : c'est ce que le client vient lire pour décider.
        const html = `<p>Étrier de frein avant droit, déposé sur un véhicule de 2018 à 84 000 km.</p>
            <p>Fonctionnement vérifié sur banc. Piston libre, soufflet intact.</p>
            <p>Légères traces de corrosion sur le corps, sans incidence sur le fonctionnement.</p>
            <p>Garantie 6 mois pièce. Livraison sous 48 h.</p>`;
        const r = cleanEbayDescription(html);
        expect(r).toContain('84 000 km');
        expect(r).toContain('Piston libre');
        expect(r).toContain('corrosion');
        expect(r).toContain('Garantie 6 mois');
    });

    it('PRÉSERVE une liste de modèles compatibles (lignes courtes AVEC chiffres)', () => {
        // Le filet « lignes courtes » ne doit pas confondre une liste de
        // compatibilités — que le client vient précisément vérifier — avec
        // un menu de catégories.
        const html = '<p>Compatible avec les modèles suivants :</p><ul>'
            + ['W169 A 150', 'W169 A 160', 'W169 A 180', 'W245 B 150', 'W245 B 170',
               'W245 B 180', 'W245 B 200', 'W176 A 180', 'W176 A 200', 'W246 B 180',
               'W246 B 200', 'W246 B 220'].map(m => `<li>${m}</li>`).join('')
            + '</ul>';
        const r = cleanEbayDescription(html);
        expect(r).toContain('W169 A 150');
        expect(r).toContain('W246 B 220');   // dernière ligne conservée
    });

    it('coupe une longue liste de catégories sans chiffre, même sans marqueur', () => {
        const html = '<p>Pièce d\'occasion garantie, expédition rapide depuis notre entrepôt.</p><ul>'
            + ['Capteur ABS', 'Ressort à gaz', 'Suspension pneumatique', 'Pompe à carburant',
               'Lève-vitre', 'Sonde lambda', 'Pompe à eau', 'Ventilateur de radiateur',
               'Vanne de recirculation', 'Pompe à vide', 'Boîte de transfert', 'Culasse']
              .map(c => `<li>${c}</li>`).join('')
            + '</ul>';
        const r = cleanEbayDescription(html);
        expect(r).toContain('expédition rapide');
        expect(r).not.toContain('Boîte de transfert');
    });

    it('n\'ampute pas une description qui S\'OUVRE sur un mot marqueur', () => {
        const html = '<p>Conditions générales de garantie : 6 mois pièce et main d\'œuvre, '
            + 'retour accepté sous 14 jours si la référence ne correspond pas.</p>';
        const r = cleanEbayDescription(html);
        expect(r).toContain('6 mois');
        expect(r).toContain('14 jours');
    });

    it('conserve les sauts de ligne (la mise en page en dépend)', () => {
        const r = cleanEbayDescription('<p>Première ligne suffisamment longue.</p><p>Seconde ligne.</p>');
        expect(r).toContain('\n');
    });

    it('retire toute mention de place de marché', () => {
        expect(neutralizeSource('Voir ma boutique eBay')).not.toMatch(/ebay/i);
        expect(neutralizeSource('Visitez https://www.ebay.fr/str/x')).not.toMatch(/ebay|http/i);
        expect(neutralizeSource('Disques Brembo 300mm')).toBe('Disques Brembo 300mm');
    });

    it('supporte les entrées vides ou absurdes sans lever', () => {
        for (const v of ['', null, undefined]) {
            expect(cleanEbayDescription(v as any)).toBe('');
        }
    });
});
