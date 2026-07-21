import { describe, it, expect } from 'vitest';
import { signOffer, verifyOffer, OFFER_TOKEN_TTL_MS } from './offer_token';

// Le secret est lu paresseusement par le module : le poser ici suffit.
process.env.OFFER_TOKEN_SECRET = 'secret-de-test-offres';

const OFFRE = {
    itemId: 'v1|123456|0',
    source: 'ebay',
    sourcePriceEur: 45.9,
    sourceShippingEur: 12.5,
    sourceShippingType: 'FIXED',
};

describe('offer_token — le coût d\'acquisition ne fait plus confiance au client', () => {
    it('signe puis relit fidèlement les données', () => {
        const v = verifyOffer(signOffer(OFFRE));
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.data.sourcePriceEur).toBe(45.9);
            expect(v.data.sourceShippingEur).toBe(12.5);
            expect(v.data.source).toBe('ebay');
            expect(v.expired).toBe(false);
        }
    });

    it('le jeton est chiffré : le contenu n\'est PAS lisible en le décodant', () => {
        // C'est le cœur de la démarketisation : un jeton seulement signé
        // laisserait « ebay » et le prix d'achat lisibles en base64.
        const decoded = Buffer.from(signOffer(OFFRE), 'base64url').toString('latin1');
        expect(decoded).not.toContain('ebay');
        expect(decoded).not.toContain('source');
        expect(decoded).not.toContain('45.9');
    });

    it('rejette un jeton altéré (n\'importe quel octet)', () => {
        const token = signOffer(OFFRE);
        const raw = Buffer.from(token, 'base64url');
        for (const pos of [0, 13, raw.length - 1]) { // iv, tag, contenu
            const forged = Buffer.from(raw);
            forged[pos] = forged[pos] ^ 0xff;
            expect(verifyOffer(forged.toString('base64url')).ok).toBe(false);
        }
    });

    it('rejette les entrées absurdes sans lever', () => {
        for (const bad of [null, undefined, 42, '', 'abc', 'a.b.c', '..', {}]) {
            expect(verifyOffer(bad as any).ok).toBe(false);
        }
    });

    it('signale un jeton expiré sans le rejeter (l\'opérateur vérifiera)', () => {
        expect(OFFER_TOKEN_TTL_MS).toBe(72 * 3600 * 1000);
        // expired est un drapeau, pas un rejet — la commande n'est jamais
        // bloquée pour ça : un jeton frais doit le porter à false.
        const v = verifyOffer(signOffer(OFFRE));
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.expired).toBe(false);
    });
});
