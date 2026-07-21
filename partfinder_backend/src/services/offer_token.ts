import crypto from 'crypto';

/**
 * Jeton d'offre signé — les données d'acquisition ne font plus confiance au client.
 *
 * Avant : /find envoyait sourcePrice/shippingCost en clair, et le navigateur
 * les RENVOYAIT avec la commande. Conséquences : le nom du fournisseur restait
 * lisible dans les échanges, et surtout n'importe quel client pouvait falsifier
 * son coût d'acquisition depuis la console — l'opérateur validait alors le prix
 * définitif sur une donnée truquée.
 *
 * Maintenant : le serveur scelle ces données dans un jeton HMAC opaque. Le
 * client le transporte tel quel et le renvoie à la commande ; toute altération
 * invalide la signature. Aucune écriture en base à la recherche (50 offres par
 * recherche, la quasi-totalité jamais commandées).
 */

export interface OfferData {
    itemId: string;
    source: string;               // fournisseur (ebay/aliexpress) — ne sort jamais du backend
    sourcePriceEur: number | null;
    sourceShippingEur: number | null;
    sourceShippingType: string | null;
    ts: number;                   // émission (ms epoch)
}

// Réutilise JWT_SECRET : déjà obligatoire, même niveau de sensibilité.
// Lu PARESSEUSEMENT : figé à l'import, il serait vide si ce module est chargé
// avant l'initialisation de dotenv (l'ordre des imports n'est pas garanti).
function getSecret(): string {
    return process.env.OFFER_TOKEN_SECRET || process.env.JWT_SECRET || '';
}

// Durée de vie : au-delà, le prix du fournisseur a pu changer — l'opérateur
// devra vérifier le coût à la main (la commande n'est PAS bloquée pour autant).
export const OFFER_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

function b64url(buf: Buffer): string {
    return buf.toString('base64url');
}

function hmac(payload: string): string {
    return b64url(crypto.createHmac('sha256', getSecret()).update(payload).digest());
}

export function signOffer(data: Omit<OfferData, 'ts'>): string {
    const payload = b64url(Buffer.from(JSON.stringify({ ...data, ts: Date.now() }), 'utf8'));
    return `${payload}.${hmac(payload)}`;
}

export type VerifyResult =
    | { ok: true; data: OfferData; expired: boolean }
    | { ok: false };

/**
 * Vérifie signature et fraîcheur. Une signature invalide = donnée forgée →
 * rejet ferme. Un jeton expiré reste lisible mais est signalé comme tel.
 */
export function verifyOffer(token: unknown): VerifyResult {
    if (typeof token !== 'string' || !getSecret()) return { ok: false };
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return { ok: false };
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = hmac(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OfferData;
        if (!data || typeof data.ts !== 'number') return { ok: false };
        return { ok: true, data, expired: Date.now() - data.ts > OFFER_TOKEN_TTL_MS };
    } catch {
        return { ok: false };
    }
}
