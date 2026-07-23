import axios from 'axios';
import crypto from 'crypto';
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

function memoireValide(): string | null {
    if (!token?.access_token) return null;
    if (token.expires_at && Date.now() > token.expires_at) return null;
    return token.access_token;
}

/**
 * access_token encore valide, ou null (absent / expiré).
 *
 * Relit la BASE si le cache mémoire est vide : indispensable car le token est
 * écrit par le callback OAuth APRÈS le démarrage, et Railway peut exécuter
 * plusieurs instances (le callback écrit sur l'une, la recherche lit sur une
 * autre). Sans cette relecture, le token restait « absent » côté recherche.
 */
export async function getValidAccessToken(): Promise<string | null> {
    const enMemoire = memoireValide();
    if (enMemoire) return enMemoire;
    // Cache vide ou expiré : on retente depuis la base.
    await loadAliexpressToken();
    if (memoireValide()) return memoireValide();
    // Toujours pas valide, mais on a un refresh_token : dernier recours, on
    // tente un renouvellement plutôt que d'échouer.
    if (token?.refresh_token) {
        await refreshAliexpressToken();
        return memoireValide();
    }
    return null;
}

/* ── Rafraîchissement automatique ─────────────────────────────────── */

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '';
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || '';
const REFRESH_PATH = '/auth/token/refresh';
const REFRESH_BASE = 'https://api-sg.aliexpress.com/rest';

let refreshEnCours: Promise<void> | null = null;

/** Signature IOP (sha256) : chemin + params triés concaténés, HMAC hex maj. */
function signIop(params: Record<string, string>): string {
    const sorted = Object.keys(params).sort();
    let base = REFRESH_PATH;
    for (const k of sorted) base += k + params[k];
    return crypto.createHmac('sha256', APP_SECRET).update(base, 'utf8').digest('hex').toUpperCase();
}

/**
 * Renouvelle l'access_token via le refresh_token (le token AliExpress expire
 * ~30 j). Best-effort ; déduplique les appels concurrents. Sans ça, il faudrait
 * ré-autoriser à la main à chaque expiration.
 */
export async function refreshAliexpressToken(): Promise<void> {
    if (refreshEnCours) return refreshEnCours;
    const rt = token?.refresh_token;
    if (!rt || !APP_KEY || !APP_SECRET) return;

    refreshEnCours = (async () => {
        try {
            const params: Record<string, string> = {
                app_key: APP_KEY,
                timestamp: Date.now().toString(),
                sign_method: 'sha256',
                refresh_token: rt,
            };
            params.sign = signIop(params);
            const resp = await axios.post(`${REFRESH_BASE}${REFRESH_PATH}`, null, { params, timeout: 15000 });
            const data = resp.data;
            const accessToken = data?.access_token || data?.data?.access_token;
            if (accessToken) {
                const expiresIn = Number(data?.expires_in || data?.data?.expires_in || 0);
                await setAliexpressToken({
                    access_token: accessToken,
                    // Certaines réponses ne renvoient pas de nouveau refresh_token :
                    // on garde l'ancien plutôt que de le perdre.
                    refresh_token: data?.refresh_token || data?.data?.refresh_token || rt,
                    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
                    raw: data,
                });
                console.log('[AliExpress] token rafraîchi'
                    + (expiresIn ? ` (nouvelle expiration dans ${Math.round(expiresIn / 86400)} j)` : ''));
            } else {
                console.warn('[AliExpress] refresh sans access_token:', JSON.stringify(data).slice(0, 200));
            }
        } catch (e: any) {
            console.error('[AliExpress] echec refresh token:', (e.response?.data || e.message)?.toString().slice(0, 200));
        } finally {
            refreshEnCours = null;
        }
    })();
    return refreshEnCours;
}

/**
 * Rafraîchit si le token expire bientôt (marge configurable). Appelé par le
 * planificateur : on renouvelle AVANT expiration, pas au moment où une
 * recherche échoue.
 */
export async function refreshTokenSiBientotExpire(): Promise<void> {
    if (!token?.refresh_token || !token.expires_at) return;
    const margeMs = Number(process.env.ALIEXPRESS_REFRESH_MARGIN_DAYS || '3') * 86400 * 1000;
    if (Date.now() > token.expires_at - margeMs) {
        console.log('[AliExpress] token proche de l\'expiration — rafraîchissement préventif');
        await refreshAliexpressToken();
    }
}
