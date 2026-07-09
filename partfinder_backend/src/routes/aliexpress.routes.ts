import express from 'express';
import crypto from 'crypto';
import axios from 'axios';

/**
 * AliExpress (Open Platform / Affiliates API) — OAuth callback.
 *
 * AliExpress redirige le vendeur/l'utilisateur vers cette URL avec un `code`
 * d'autorisation, qu'on échange contre un access_token.
 *
 * URL déclarée dans la console AliExpress (Callback URL) :
 *   https://partfinder-backend-production-c0af.up.railway.app/api/aliexpress/callback
 *
 * Variables d'environnement (à définir sur Railway, jamais en clair dans le repo) :
 *   ALIEXPRESS_APP_KEY     : App Key fourni à la création de l'app
 *   ALIEXPRESS_APP_SECRET  : App Secret
 *
 * Note : tant que APP_KEY/APP_SECRET ne sont pas configurés, le callback se
 * contente de CAPTURER le code (affichage + log) sans tenter l'échange — ce qui
 * permet déjà de valider que la redirection fonctionne.
 */

const router = express.Router();

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '';
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || '';

// Endpoint système IOP d'AliExpress (Singapour) pour créer le token.
const TOKEN_API_PATH = '/auth/token/create';
const TOKEN_API_BASE = 'https://api-sg.aliexpress.com/rest';

// Dernier token obtenu (en mémoire). À persister (Prisma) quand on branchera
// réellement la recherche de produits AliExpress.
let lastToken: { access_token?: string; refresh_token?: string; expires_at?: number; raw?: any } | null = null;

export function getAliexpressToken() {
    return lastToken;
}

/**
 * Signature IOP AliExpress (sign_method = sha256) :
 *  1. Trier les params par clé (ordre alphabétique).
 *  2. Concaténer key+value (sans séparateur).
 *  3. Préfixer par le chemin de l'API (endpoints /rest/...).
 *  4. HMAC-SHA256 avec l'App Secret, en hexadécimal MAJUSCULE.
 */
function signParams(params: Record<string, string>, apiPath: string, appSecret: string): string {
    const sorted = Object.keys(params).sort();
    let base = apiPath;
    for (const k of sorted) base += k + params[k];
    return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

async function exchangeCodeForToken(code: string) {
    const params: Record<string, string> = {
        app_key: APP_KEY,
        timestamp: Date.now().toString(),
        sign_method: 'sha256',
        code,
    };
    params.sign = signParams(params, TOKEN_API_PATH, APP_SECRET);

    // L'API IOP accepte les params en query string.
    const resp = await axios.post(`${TOKEN_API_BASE}${TOKEN_API_PATH}`, null, {
        params,
        timeout: 15000,
    });
    return resp.data;
}

router.get('/callback', async (req: express.Request, res: express.Response) => {
    const code = (req.query.code as string) || '';
    const state = (req.query.state as string) || '';

    if (!code) {
        return res.status(400).send('Paramètre "code" manquant dans le callback AliExpress.');
    }

    console.log('[AliExpress] Callback reçu — code:', code, 'state:', state);

    // Pas encore configuré : on capture juste le code (la redirection fonctionne).
    if (!APP_KEY || !APP_SECRET) {
        console.warn('[AliExpress] APP_KEY/APP_SECRET non configurés — échange de token ignoré.');
        return res
            .status(200)
            .send(callbackPage('Autorisation reçue',
                `Code d'autorisation capturé.<br><br>Configurez <code>ALIEXPRESS_APP_KEY</code> et
                 <code>ALIEXPRESS_APP_SECRET</code> sur Railway pour activer l'échange de token.`,
                code));
    }

    try {
        const data = await exchangeCodeForToken(code);
        // La forme exacte de la réponse dépend d'AliExpress ; on la logue pour ajuster.
        console.log('[AliExpress] Réponse token/create:', JSON.stringify(data));

        const accessToken = data?.access_token || data?.data?.access_token;
        if (accessToken) {
            const expiresIn = Number(data?.expires_in || data?.data?.expires_in || 0);
            lastToken = {
                access_token: accessToken,
                refresh_token: data?.refresh_token || data?.data?.refresh_token,
                expires_at: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
                raw: data,
            };
            return res.status(200).send(callbackPage('Connexion AliExpress réussie',
                'Le token a été obtenu avec succès. Vous pouvez fermer cette page.', code));
        }

        // Répondu, mais pas de token : on montre la réponse brute pour diagnostic.
        return res.status(200).send(callbackPage('Réponse AliExpress reçue',
            'Aucun access_token dans la réponse (voir logs serveur pour le détail).', code));
    } catch (error: any) {
        console.error('[AliExpress] Échec échange token:', error.response?.data || error.message);
        return res.status(200).send(callbackPage('Échec de l\'échange de token',
            'La redirection a fonctionné mais l\'échange du code a échoué (voir logs serveur). ' +
            'Le code reste affiché ci-dessous.', code));
    }
});

// Petite page HTML de retour (l'utilisateur atterrit ici après autorisation).
function callbackPage(title: string, message: string, code: string): string {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PartFinder — AliExpress</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#EEF1F6;color:#1A2B45;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#fff;border:1px solid rgba(26,43,69,.12);border-radius:16px;padding:32px;
        max-width:460px;box-shadow:0 10px 24px -6px rgba(26,43,69,.18)}
  h1{font-size:1.25rem;margin:0 0 12px}
  p{color:#4C5F7A;line-height:1.5}
  code{background:#EEF1F6;padding:2px 6px;border-radius:4px;font-size:.85em;word-break:break-all}
  .code{margin-top:16px;padding:12px;background:#F5F7FB;border-radius:8px;font-size:.8rem}
</style></head><body><div class="card">
<h1>${title}</h1><p>${message}</p>
<div class="code"><strong>code:</strong> <code>${code}</code></div>
</div></body></html>`;
}

export default router;
