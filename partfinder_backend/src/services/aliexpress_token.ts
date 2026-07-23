import { prisma } from '../lib/prisma';

/**
 * Jeton OAuth AliExpress — PERSISTÉ en base (survit aux redémarrages).
 *
 * Les API Drop Shipping (ds.*) agissent dans le CONTEXTE d'un compte autorisé :
 * elles exigent un `access_token` obtenu via OAuth, en plus de la clé d'app.
 * Stocké seulement en mémoire, il était perdu à chaque redéploiement Railway —
 * chaque correctif poussé forçait une nouvelle autorisation, et empêchait tout
 * test stable. On le garde donc en base, avec un cache mémoire pour la lecture.
 *
 * ⚠️ Le token expire (typiquement ~24 h). Le rafraîchissement via refresh_token
 * reste à brancher une fois l'intégration confirmée.
 */
export interface AliexpressToken {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    raw?: any;
}

// Cache mémoire, alimenté au démarrage depuis la base.
let token: AliexpressToken | null = null;

/** Charge le token persisté au démarrage du serveur. */
export async function loadAliexpressToken(): Promise<void> {
    try {
        const row = await prisma.aliexpressToken.findUnique({ where: { id: 1 } });
        if (row) {
            token = {
                access_token: row.accessToken,
                refresh_token: row.refreshToken ?? undefined,
                expires_at: row.expiresAt ? row.expiresAt.getTime() : undefined,
                raw: row.raw ?? undefined,
            };
            console.log('[AliExpress] token chargé depuis la base'
                + (row.expiresAt ? ` (expire ${row.expiresAt.toISOString()})` : ''));
        }
    } catch (e: any) {
        // Table absente (avant le premier db push) : on démarre sans token.
        console.warn('[AliExpress] chargement token:', e.message);
    }
}

/** Mémorise ET persiste le token. */
export async function setAliexpressToken(t: AliexpressToken | null): Promise<void> {
    token = t;
    try {
        if (!t || !t.access_token) {
            await prisma.aliexpressToken.deleteMany({});
            return;
        }
        const data = {
            accessToken: t.access_token,
            refreshToken: t.refresh_token ?? null,
            expiresAt: t.expires_at ? new Date(t.expires_at) : null,
            raw: t.raw ?? undefined,
        };
        await prisma.aliexpressToken.upsert({
            where: { id: 1 },
            create: { id: 1, ...data },
            update: data,
        });
    } catch (e: any) {
        // Persistance best-effort : ne jamais casser le callback OAuth.
        console.error('[AliExpress] persistance token:', e.message);
    }
}

export function getAliexpressToken(): AliexpressToken | null {
    return token;
}

/** access_token encore valide, ou null (absent / expiré). */
export function getValidAccessToken(): string | null {
    if (!token?.access_token) return null;
    if (token.expires_at && Date.now() > token.expires_at) return null;
    return token.access_token;
}
