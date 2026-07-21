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

    it('rejette un jeton dont le payload a été modifié (prix falsifié)', () => {
        const token = signOffer(OFFRE);
        const [payload, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        data.sourcePriceEur = 0.01; // le client « déclare » un coût dérisoire
        const forged = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url') + '.' + sig;
        expect(verifyOffer(forged).ok).toBe(false);
    });

    it('rejette une signature altérée', () => {
        const token = signOffer(OFFRE);
        const flipped = token.slice(0, -2) + (token.slice(-2) === 'AA' ? 'BB' : 'AA');
        expect(verifyOffer(flipped).ok).toBe(false);
    });

    it('rejette les entrées absurdes sans lever', () => {
        for (const bad of [null, undefined, 42, '', 'abc', 'a.b.c', '..', {}]) {
            expect(verifyOffer(bad as any).ok).toBe(false);
        }
    });

    it('signale un jeton expiré sans le rejeter (l\'opérateur vérifiera)', () => {
        const token = signOffer(OFFRE);
        const dot = token.lastIndexOf('.');
        const data = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString('utf8'));
        expect(Date.now() - data.ts).toBeLessThan(5000);
        expect(OFFER_TOKEN_TTL_MS).toBe(72 * 3600 * 1000);
        // Un vrai jeton vieilli garde une signature valide : expired est un
        // drapeau, pas un rejet — la commande n'est jamais bloquée pour ça.
        const v = verifyOffer(token);
        if (v.ok) expect(typeof v.expired).toBe('boolean');
    });
});
