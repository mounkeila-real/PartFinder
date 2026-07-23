/**
 * Stockage du jeton OAuth AliExpress — module isolé.
 *
 * Les API Drop Shipping (ds.*) agissent dans le CONTEXTE d'un compte
 * autorisé : elles exigent un `access_token` obtenu via le flux OAuth, en plus
 * de la clé d'app. Sans lui, ds.text.search répond EXCEPTION_TEXT_SEARCH_FOR_DS
 * (auth de passerelle OK, mais échec métier).
 *
 * Isolé ici pour être partagé par la route de callback (qui l'écrit) et le
 * service de recherche (qui le lit), sans dépendance circulaire.
 *
 * ⚠️ En mémoire : perdu au redémarrage du service. Le token AliExpress expire
 * aussi (typiquement 24 h). À persister en base + rafraîchir quand
 * l'intégration sera validée — voir refresh_token.
 */
export interface AliexpressToken {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    raw?: any;
}

let token: AliexpressToken | null = null;

export function setAliexpressToken(t: AliexpressToken | null): void {
    token = t;
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
