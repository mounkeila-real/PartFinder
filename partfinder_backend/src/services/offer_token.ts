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
    /** Vendeur (casse) — usage back-office : savoir chez qui acheter. */
    vendeur?: string | null;
    /** Annonce issue d'une casse professionnelle de la whitelist. */
    vendeurPro?: boolean;
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

// CHIFFRÉ, pas seulement signé : un simple HMAC laisse le payload en base64,
// que n'importe qui décode — « source: ebay » et le prix d'achat seraient
// lisibles, exactement ce que la démarketisation interdit. AES-256-GCM fournit
// les deux d'un coup : confidentialité (chiffrement) et intégrité (tag
// d'authentification — toute altération fait échouer le déchiffrement).
function getKey(): Buffer {
    return crypto.createHash('sha256').update(getSecret()).digest();
}

export function signOffer(data: Omit<OfferData, 'ts'>): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const plain = Buffer.from(JSON.stringify({ ...data, ts: Date.now() }), 'utf8');
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export type VerifyResult =
    | { ok: true; data: OfferData; expired: boolean }
    | { ok: false };

/**
 * Déchiffre et authentifie. Toute altération (payload OU tag) fait échouer le
 * déchiffrement → rejet ferme. Un jeton expiré reste lisible mais signalé.
 */
export function verifyOffer(token: unknown): VerifyResult {
    if (typeof token !== 'string' || !getSecret()) return { ok: false };
    try {
        const raw = Buffer.from(token, 'base64url');
        if (raw.length < 12 + 16 + 2) return { ok: false };
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const enc = raw.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
        const data = JSON.parse(plain.toString('utf8')) as OfferData;
        if (!data || typeof data.ts !== 'number') return { ok: false };
        return { ok: true, data, expired: Date.now() - data.ts > OFFER_TOKEN_TTL_MS };
    } catch {
        return { ok: false };
    }
}
