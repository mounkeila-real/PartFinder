import axios from 'axios';
import crypto from 'crypto';
import { NormalizedPart } from './ebay.service';
import { getValidAccessToken } from './aliexpress_token';

/**
 * AliExpress Affiliate — recherche de produits.
 *
 * Renvoie des résultats au MÊME format NormalizedPart que l'eBay, pour être
 * fusionnés et rendus avec la même carte côté frontend.
 *
 * Auth : signature par requête (app_key + app_secret), pas de token OAuth
 * nécessaire pour la recherche produits (le callback OAuth sert à autre chose).
 *
 * Variables d'environnement :
 *   ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET   (obligatoires)
 *   ALIEXPRESS_TRACKING_ID                       (optionnel, défaut "default")
 *   ALIEXPRESS_SHIP_TO   (défaut FR)
 *   ALIEXPRESS_CURRENCY  (défaut EUR)
 *   ALIEXPRESS_LANGUAGE  (défaut FR)
 *
 * NB : implémentation "best effort" — l'endpoint/la signature exacte d'AliExpress
 * n'ont pas pu être testés. La réponse brute est loggée pour ajustement rapide.
 * En cas d'échec ou d'absence de config, renvoie [] (n'impacte jamais l'eBay).
 */

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '';
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || '';
const SHIP_TO = process.env.ALIEXPRESS_SHIP_TO || 'FR';
const CURRENCY = process.env.ALIEXPRESS_CURRENCY || 'EUR';
const LOCAL = process.env.ALIEXPRESS_LOCAL || 'fr_FR';

/**
 * Méthode de recherche. L'app est autorisée sur le groupe « AliExpress-dropship »
 * (ds.*) et PAS sur l'Affiliate : surchargeable par variable d'environnement
 * pour ajuster sans redéploiement si le nom exact diffère.
 */
const SEARCH_METHOD = process.env.ALIEXPRESS_SEARCH_METHOD || 'aliexpress.ds.text.search';

// Gateway "système" AliExpress (Singapour).
const GATEWAY = 'https://api-sg.aliexpress.com/sync';

/** Coupe-circuit : après N refus d'autorisation, on cesse d'appeler. */
const SEUIL_COUPURE = 3;
const DUREE_COUPURE_MS = 6 * 60 * 60 * 1000; // 6 h

/**
 * Erreurs qui ne se résoudront JAMAIS d'elles-mêmes : elles relèvent du compte
 * AliExpress (permission d'API non accordée), pas du code ni du réseau.
 * Réessayer à chaque recherche ne fait que polluer les journaux et ajouter
 * de la latence.
 */
const ERREURS_PERMANENTES = /InsufficientPermission|does not have permission|InvalidAppKey|AppCallLimit/i;

/** Un objet ressemble-t-il à un produit AliExpress ? */
function estProduit(o: any): boolean {
    if (!o || typeof o !== 'object') return false;
    return o.product_id != null || o.productId != null || o.itemId != null
        || o.product_title != null || o.productTitle != null;
}

/**
 * Cherche récursivement le premier tableau de produits dans la réponse,
 * quel que soit le nom des clés du wrapper (selection_search_product,
 * traffic_product_d_t_o, products…). Évite de dépendre d'un chemin exact
 * qui casse à la moindre variation d'API.
 */
function trouverProduits(node: any, profondeur = 0): any[] {
    if (!node || typeof node !== 'object' || profondeur > 6) return [];
    if (Array.isArray(node)) {
        return node.some(estProduit) ? node.filter(estProduit) : [];
    }
    for (const k of Object.keys(node)) {
        const trouve = trouverProduits(node[k], profondeur + 1);
        if (trouve.length) return trouve;
    }
    return [];
}

/** Récupère l'objet wrapper `*_response` (contient rsp_code/rsp_msg). */
function trouverWrapper(data: any): any {
    if (!data || typeof data !== 'object') return null;
    const cle = Object.keys(data).find((k) => k.endsWith('_response'));
    return cle ? data[cle] : data;
}

export class AliexpressService {

    /** Coupe-circuit : refus consécutifs et date de réarmement. */
    private static refusConsecutifs = 0;
    private static couperJusqua = 0;

    static isConfigured(): boolean {
        // Interrupteur explicite : permet de couper la source sans retirer
        // les clés de Railway, le temps d'obtenir l'autorisation.
        if (process.env.ALIEXPRESS_ENABLED === '0') return false;
        return !!(APP_KEY && APP_SECRET);
    }

    /** La source est-elle temporairement coupée après des refus répétés ? */
    static estCoupee(): boolean {
        return Date.now() < this.couperJusqua;
    }

    static rearmer(): void {
        this.refusConsecutifs = 0;
        this.couperJusqua = 0;
    }

    /**
     * Traduit une erreur brute en message actionnable.
     * « InsufficientPermission » ne dit pas QUOI faire ; le message doit
     * distinguer un problème de compte d'un problème de code.
     */
    private static expliquer(brut: string): string {
        if (/InsufficientPermission|does not have permission/i.test(brut)) {
            return `PERMISSION REFUSEE par AliExpress pour « ${SEARCH_METHOD} ». `
                + 'Verifier dans la console AliExpress que le groupe de permissions couvrant '
                + 'cette methode est actif (l\'app est autorisee sur AliExpress-dropship). '
                + `Brut : ${brut.slice(0, 160)}`;
        }
        if (/InvalidSignature|IncompleteSignature/i.test(brut)) {
            return `SIGNATURE REFUSEE — verifier ALIEXPRESS_APP_SECRET. Brut : ${brut.slice(0, 160)}`;
        }
        if (/AppCallLimit|Quota/i.test(brut)) {
            return `QUOTA D'APPELS ATTEINT. Brut : ${brut.slice(0, 160)}`;
        }
        return brut.slice(0, 300);
    }

    /**
     * Coupe-circuit : après plusieurs refus définitifs, on cesse d'appeler.
     * Sans cela, chaque recherche client relançait un appel voué à échouer —
     * latence inutile et journaux AliExpress saturés d'erreurs.
     */
    private static enregistrerEchec(brut: string): void {
        if (!ERREURS_PERMANENTES.test(brut)) {
            this.refusConsecutifs = 0;
            return;
        }
        this.refusConsecutifs += 1;
        if (this.refusConsecutifs >= SEUIL_COUPURE) {
            this.couperJusqua = Date.now() + DUREE_COUPURE_MS;
            if (this.lastDiagnostic) {
                this.lastDiagnostic.coupeJusqua = new Date(this.couperJusqua).toISOString();
            }
            console.warn(
                `[AliExpress] source coupee ${DUREE_COUPURE_MS / 3600000} h apres `
                + `${this.refusConsecutifs} refus consecutifs — corriger la permission puis reactiver.`
            );
        }
    }

    // Horodatage "yyyy-MM-dd HH:mm:ss" en heure de Chine (GMT+8), requis par le gateway.
    private static timestamp(): string {
        const d = new Date(Date.now() + 8 * 3600 * 1000);
        return d.toISOString().slice(0, 19).replace('T', ' ');
    }

    // Signature TOP/système : concat trié key+value, HMAC-SHA256(secret), hex majuscule.
    private static sign(params: Record<string, string>): string {
        const sorted = Object.keys(params).sort();
        let base = '';
        for (const k of sorted) base += k + params[k];
        return crypto.createHmac('sha256', APP_SECRET).update(base, 'utf8').digest('hex').toUpperCase();
    }

    /**
     * Dernier diagnostic d'appel — l'échec est volontairement silencieux pour
     * ne jamais casser le flux principal, ce qui rend la panne INVISIBLE.
     * Cette trace permet à l'admin de savoir si la source répond vraiment.
     */
    static lastDiagnostic: {
        at: string; ok: boolean; count: number; error: string | null; rawExcerpt: string | null;
        /** Vrai quand l'échec relève du compte AliExpress, pas du code. */
        permanent?: boolean;
        coupeJusqua?: string | null;
    } | null = null;

    static async searchProducts(query: string, limit = 20): Promise<NormalizedPart[]> {
        // Source coupée : on n'appelle pas. Le diagnostic conserve la cause.
        if (this.estCoupee()) return [];

        if (!this.isConfigured()) {
            this.lastDiagnostic = {
                at: new Date().toISOString(), ok: false, count: 0,
                error: process.env.ALIEXPRESS_ENABLED === '0'
                    ? 'DESACTIVEE MANUELLEMENT (ALIEXPRESS_ENABLED=0)'
                    : 'NON CONFIGURE (ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET absents)',
                rawExcerpt: null,
            };
            return [];
        }
        if (!query || !query.trim()) return [];

        try {
            // API DROP SHIPPING (ds.*), la seule autorisée pour cette app.
            // L'API Affiliate (affiliate.*) exige une permission distincte,
            // non accordée : elle répondait InsufficientPermission à chaque
            // recherche, ce qui ressemblait à « 0 résultat ».
            // API Drop Shipping = contexte utilisateur : elle exige le token
            // OAuth. Sans lui, EXCEPTION_TEXT_SEARCH_FOR_DS (auth passerelle OK,
            // échec métier). Le token vient du flux d'autorisation (callback).
            const accessToken = getValidAccessToken();

            const params: Record<string, string> = {
                method: SEARCH_METHOD,
                app_key: APP_KEY,
                timestamp: this.timestamp(),
                format: 'json',
                v: '2.0',
                sign_method: 'hmac-sha256',
                // Paramètres métier de ds.text.search (nommage différent de
                // l'API Affiliate : keyWord, local, countryCode...).
                keyWord: query,
                local: LOCAL,
                countryCode: SHIP_TO,
                currency: CURRENCY,
                pageSize: String(Math.min(limit, 50)),
                pageIndex: '1',
                sortBy: 'orders,desc',
                ...(accessToken ? { access_token: accessToken } : {}),
            };
            params.sign = this.sign(params);

            const resp = await axios.post(GATEWAY, null, {
                params,
                // ENCODAGE RFC 3986 : axios encode les espaces en « + » (style
                // formulaire). AliExpress attend « %20 » (encodeURIComponent).
                // La signature reste valide — elle est calculée sur les valeurs
                // BRUTES, et AliExpress decode %20 -> espace avant de verifier —
                // mais la recherche metier recevait sinon « Android+Auto+... »
                // avec des « + » litteraux, d'ou EXCEPTION_TEXT_SEARCH_FOR_DS.
                paramsSerializer: (p: Record<string, string>) =>
                    Object.keys(p)
                        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`)
                        .join('&'),
                timeout: 15000,
            });
            const data = resp.data;

            // Journalisé tant que l'intégration n'est pas validée : c'est cet
            // extrait qui révèle la forme réelle de la réponse.
            console.log('[AliExpress] ds.search réponse:', JSON.stringify(data).slice(0, 1500));

            // EXTRACTION ROBUSTE : plutôt que de deviner le chemin exact (qui
            // varie selon la méthode et la version), on cherche récursivement
            // le premier tableau dont les éléments ressemblent à des produits.
            const arr = trouverProduits(data);

            // Le gateway répond souvent 200 AVEC une erreur applicative dans le
            // corps. On lit le statut « business » du wrapper *_response
            // (rsp_code/rsp_msg) en plus des formes d'erreur classiques.
            const wrapper = trouverWrapper(data);
            const rspCode = wrapper?.rsp_code ?? wrapper?.code;
            const rspMsg = wrapper?.rsp_msg ?? wrapper?.msg ?? wrapper?.sub_msg;
            const apiError = data?.error_response
                || ((data as any)?.code && (data as any).code !== '0'
                    ? { code: (data as any).code, msg: (data as any).msg || (data as any).sub_msg }
                    : null)
                // rsp_code non 2xx = échec business, meme si code gateway = 0.
                || (rspCode != null && !/^2\d\d$/.test(String(rspCode))
                    ? { code: rspCode, msg: rspMsg }
                    : null);

            const texteErreur = apiError ? JSON.stringify(apiError) : '';
            this.lastDiagnostic = {
                at: new Date().toISOString(),
                ok: !apiError && arr.length > 0,
                count: arr.length,
                error: apiError ? this.expliquer(texteErreur) : null,
                // Clés de haut niveau + statut business : de quoi voir la
                // structure sans dumper toute la charge utile.
                rawExcerpt: `access_token=${accessToken ? 'present' : 'ABSENT (autorisation OAuth requise)'} `
                    + `| cles=${Object.keys(data || {}).join(',')} `
                    + `| rsp_code=${rspCode} rsp_msg=${rspMsg} `
                    + `| ${JSON.stringify(data).slice(0, 500)}`,
                permanent: ERREURS_PERMANENTES.test(texteErreur),
                coupeJusqua: null,
            };

            if (apiError) this.enregistrerEchec(texteErreur);
            else this.rearmer();

            return arr.map((p: any) => this.normalize(p));
        } catch (err: any) {
            const detail = err.response?.data || err.message;
            const brut = typeof detail === 'string' ? detail : JSON.stringify(detail);
            console.error('[AliExpress] recherche échec:', brut.slice(0, 300));
            this.lastDiagnostic = {
                at: new Date().toISOString(), ok: false, count: 0,
                error: this.expliquer(brut),
                rawExcerpt: null,
                permanent: ERREURS_PERMANENTES.test(brut),
                coupeJusqua: null,
            };
            this.enregistrerEchec(brut);
            return []; // n'impacte jamais le flux eBay
        }
    }

    private static normalize(p: any): NormalizedPart {
        // Le nommage diffère entre l'API Affiliate et l'API Drop Shipping
        // (target_sale_price vs targetSalePrice, selon la méthode et la
        // version) : on accepte les deux plutôt que de parier sur une forme.
        const priceRaw = p.target_sale_price ?? p.targetSalePrice
            ?? p.target_app_sale_price ?? p.sale_price ?? p.salePrice
            ?? p.original_price ?? p.originalPrice;
        const price = priceRaw != null ? (parseFloat(String(priceRaw)) || null) : null;
        const image = p.product_main_image_url || p.productMainImageUrl
            || p.image_url || p.imageUrl || null;
        return {
            itemId: 'ae_' + (p.product_id || p.productId || p.itemId
                || Math.random().toString(36).slice(2)),
            // Titre NEUTRE par défaut : « Produit AliExpress » se serait
            // affiché tel quel sur la fiche client en cas de titre manquant.
            title: p.product_title || p.productTitle || p.subject || 'Pièce détachée',
            price,
            currency: p.target_sale_price_currency || p.targetSalePriceCurrency || CURRENCY,
            image,
            thumbnail: image,
            condition: 'NEW',
            itemWebUrl: p.promotion_link || p.promotionLink
                || p.product_detail_url || p.productDetailUrl || null,
            seller: 'AliExpress',
            shortDescription: p.first_level_category_name || p.firstLevelCategoryName || null,
            fullDescription: null,
        };
    }
}
