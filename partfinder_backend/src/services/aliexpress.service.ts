import axios from 'axios';
import crypto from 'crypto';
import { NormalizedPart } from './ebay.service';

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
const TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'default';
const SHIP_TO = process.env.ALIEXPRESS_SHIP_TO || 'FR';
const CURRENCY = process.env.ALIEXPRESS_CURRENCY || 'EUR';
const LANGUAGE = process.env.ALIEXPRESS_LANGUAGE || 'FR';

// Gateway "système" AliExpress (Singapour).
const GATEWAY = 'https://api-sg.aliexpress.com/sync';

export class AliexpressService {

    static isConfigured(): boolean {
        return !!(APP_KEY && APP_SECRET);
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
    } | null = null;

    static async searchProducts(query: string, limit = 20): Promise<NormalizedPart[]> {
        if (!this.isConfigured()) {
            this.lastDiagnostic = {
                at: new Date().toISOString(), ok: false, count: 0,
                error: 'NON CONFIGURE (ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET absents)',
                rawExcerpt: null,
            };
            return [];
        }
        if (!query || !query.trim()) return [];

        try {
            const params: Record<string, string> = {
                method: 'aliexpress.affiliate.product.query',
                app_key: APP_KEY,
                timestamp: this.timestamp(),
                format: 'json',
                v: '2.0',
                sign_method: 'hmac-sha256',
                // Paramètres métier
                keywords: query,
                page_size: String(Math.min(limit, 50)),
                page_no: '1',
                target_currency: CURRENCY,
                target_language: LANGUAGE,
                ship_to_country: SHIP_TO,
                tracking_id: TRACKING_ID,
                fields: 'product_id,product_title,product_main_image_url,target_sale_price,target_sale_price_currency,promotion_link,product_detail_url,first_level_category_name',
            };
            params.sign = this.sign(params);

            const resp = await axios.post(GATEWAY, null, { params, timeout: 15000 });
            const data = resp.data;

            // Log de diagnostic (tronqué) — utile tant que l'intégration n'est pas validée.
            console.log('[AliExpress] product.query réponse:', JSON.stringify(data).slice(0, 900));

            // Chemin de réponse AliExpress (plusieurs variantes possibles selon le gateway).
            const products =
                data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ||
                data?.resp_result?.result?.products?.product ||
                data?.result?.products?.product ||
                [];

            const arr = Array.isArray(products) ? products : [];

            // Le gateway répond souvent 200 AVEC une erreur applicative dans le
            // corps (clé non approuvée...) : sans ce test, un échec passerait
            // pour un simple « 0 résultat ».
            const apiError = data?.error_response
                || (data && typeof data === 'object' && (data as any).code && (data as any).code !== '0'
                    ? { code: (data as any).code, msg: (data as any).msg || (data as any).sub_msg }
                    : null);

            this.lastDiagnostic = {
                at: new Date().toISOString(),
                ok: !apiError,
                count: arr.length,
                error: apiError ? JSON.stringify(apiError).slice(0, 300) : null,
                rawExcerpt: JSON.stringify(data).slice(0, 400),
            };

            return arr.map((p: any) => this.normalize(p));
        } catch (err: any) {
            const detail = err.response?.data || err.message;
            console.error('[AliExpress] product.query échec:', detail);
            this.lastDiagnostic = {
                at: new Date().toISOString(), ok: false, count: 0,
                error: (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300),
                rawExcerpt: null,
            };
            return []; // n'impacte jamais le flux eBay
        }
    }

    private static normalize(p: any): NormalizedPart {
        const priceRaw = p.target_sale_price ?? p.target_app_sale_price ?? p.sale_price ?? p.original_price;
        const price = priceRaw != null ? (parseFloat(String(priceRaw)) || null) : null;
        return {
            itemId: 'ae_' + (p.product_id || p.productId || Math.random().toString(36).slice(2)),
            title: p.product_title || 'Produit AliExpress',
            price,
            currency: p.target_sale_price_currency || CURRENCY,
            image: p.product_main_image_url || null,
            thumbnail: p.product_main_image_url || null,
            condition: 'NEW',
            itemWebUrl: p.promotion_link || p.product_detail_url || null,
            seller: 'AliExpress',
            shortDescription: p.first_level_category_name || null,
            fullDescription: null,
        };
    }
}
