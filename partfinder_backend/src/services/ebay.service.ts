import axios from 'axios';

/**
 * eBay Browse API service.
 *
 * Environnement piloté par EBAY_ENV ("sandbox" | "production").
 * - Sandbox : peu / pas d'annonces réelles, sert à valider l'intégration.
 * - Production : vraies annonces (image, prix, description).
 *
 * Variables d'environnement attendues :
 *   EBAY_ENV=sandbox|production        (défaut: production)
 *   EBAY_APP_ID=...                    (Client ID)
 *   EBAY_CERT_ID=...                   (Client Secret / Cert ID)
 *   EBAY_MARKETPLACE_ID=EBAY_FR        (défaut: EBAY_FR)
 */

const EBAY_ENV = (process.env.EBAY_ENV || 'production').toLowerCase();
const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;
const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || 'EBAY_FR';

// Pays de livraison : l'entrepôt de réception est en France (Sarralbe).
const DELIVERY_COUNTRY = process.env.EBAY_DELIVERY_COUNTRY || 'FR';

const IS_SANDBOX = EBAY_ENV === 'sandbox';
const API_BASE = IS_SANDBOX ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

// Catégorie eBay "Auto Parts & Accessories" (Vehicle Parts & Accessories).
const DEFAULT_CATEGORY_ID = process.env.EBAY_CATEGORY_ID || '6030';

export interface NormalizedPart {
    itemId: string;
    title: string;
    price: number | null;
    currency: string;
    image: string | null;
    thumbnail: string | null;
    condition: string | null;
    itemWebUrl: string | null;
    seller: string | null;
    shortDescription: string | null;
    fullDescription: string | null;
    /** Frais de port : montant si connu, null si non communiqué / calculé à l'adresse. */
    shippingCost?: number | null;
    /** FIXED (montant ferme) | CALCULATED (dépend de l'adresse) | null (inconnu). */
    shippingType?: string | null;
    /** Modes d'achat (FIXED_PRICE / AUCTION / BEST_OFFER) — INTERNE. */
    buyingOptions?: string[] | null;
    /** Enchère en cours, le cas échéant — sert à détecter un prix ambigu. */
    currentBidEur?: number | null;
    isMock?: boolean;
}

/**
 * Une annonce est-elle achetable immédiatement à un prix ferme ?
 *
 * Une annonce mixte « enchère + achat immédiat » est CONSERVÉE : elle est
 * réellement achetable au prix affiché. En revanche elle est écartée si
 * l'enchère a dépassé ce prix — le montant affiché n'est alors plus celui
 * auquel on peut acheter, et le prix annoncé au client serait faux.
 */
export function estPrixFerme(p: {
    buyingOptions?: string[] | null; price?: number | null; currentBidEur?: number | null;
}): boolean {
    const opts = p.buyingOptions;
    // Champ absent (mock, autre source) : on ne bloque pas.
    if (!opts || !opts.length) return true;
    if (!opts.includes('FIXED_PRICE')) return false;
    if (p.currentBidEur != null && p.price != null && p.currentBidEur >= p.price) return false;
    return true;
}

interface SearchOptions {
    limit?: number;
    categoryId?: string;
    marketplaceId?: string;
    /** Récupère la description complète (getItem) pour les N premiers résultats. */
    withDescriptions?: boolean;
    descriptionCount?: number;
    /** Restreint la recherche à ces vendeurs (casses professionnelles). */
    sellers?: string[];
}

/** Plafond eBay sur le filtre `sellers` : au-delà, la requête est rejetée. */
export const MAX_SELLERS_PER_QUERY = 30;

/**
 * N'accepter QUE les annonces à prix fixe (« Buy It Now »).
 *
 * PartFinder annonce au client un prix ferme, tout compris. Sur une enchère,
 * ce prix n'a aucun sens : le montant final est inconnu et la vente peut être
 * perdue au profit d'un autre enchérisseur, après qu'un engagement a été pris.
 * Désactivable par EBAY_FIXED_PRICE_ONLY=0 sans redéploiement.
 */
const FIXED_PRICE_ONLY = process.env.EBAY_FIXED_PRICE_ONLY !== '0';

/**
 * Construit le paramètre `filter` de la Browse API (valeurs séparées par des
 * virgules). Extrait pour être testable sans appel réseau.
 */
export function buildSearchFilter(opts: { sellers?: string[] } = {}): string {
    const filtres: string[] = [];

    // Livrable en France : l'entrepôt de réception y est. Sans ce filtre,
    // l'opérateur découvrait au moment d'acheter que le vendeur n'expédie pas.
    filtres.push(`deliveryCountry:${DELIVERY_COUNTRY}`);

    if (FIXED_PRICE_ONLY) {
        // Une annonce « enchère + achat immédiat » possède les deux options :
        // elle est conservée, car elle EST achetable au prix affiché.
        filtres.push('buyingOptions:{FIXED_PRICE}');
    }

    if (opts.sellers && opts.sellers.length) {
        // Ciblage nominatif de vendeurs professionnels : une recherche
        // générale noie les grosses casses parmi les particuliers.
        // eBay plafonne cette liste — au-delà, la requête est rejetée.
        filtres.push(`sellers:{${opts.sellers.slice(0, MAX_SELLERS_PER_QUERY).join('|')}}`);
    }

    return filtres.join(',');
}

export class EbayService {

    /**
     * Dernier diagnostic d'appel. En cas d'échec, searchParts renvoie des
     * données MOCK : sans cette trace, une panne d'API ressemble à une
     * recherche qui fonctionne (résultats plausibles, mais faux).
     */
    static lastDiagnostic: {
        at: string; ok: boolean; count: number; marketplace: string;
        error: string | null; mock: boolean;
    } | null = null;

    private static cachedToken: { value: string; expiresAt: number } | null = null;

    static isConfigured(): boolean {
        return Boolean(EBAY_APP_ID && EBAY_CERT_ID);
    }

    static currentEnv(): string {
        return IS_SANDBOX ? 'sandbox' : 'production';
    }

    /**
     * Application Access Token (Client Credentials Grant) avec cache mémoire.
     */
    static async getAccessToken(): Promise<string> {
        if (!this.isConfigured()) {
            console.warn('[eBay] Credentials manquants (EBAY_APP_ID / EBAY_CERT_ID). Mode mock.');
            return 'mock_ebay_token';
        }

        // Réutilise le token en cache s'il reste > 60s de validité.
        if (this.cachedToken && this.cachedToken.expiresAt - Date.now() > 60_000) {
            return this.cachedToken.value;
        }

        const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');

        try {
            const response = await axios.post(
                `${API_BASE}/identity/v1/oauth2/token`,
                'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${credentials}`,
                    },
                    timeout: 15000,
                }
            );

            const token = response.data.access_token as string;
            const expiresInSec = Number(response.data.expires_in || 7200);
            this.cachedToken = { value: token, expiresAt: Date.now() + expiresInSec * 1000 };
            return token;
        } catch (error: any) {
            console.error('[eBay] Échec obtention token:', error.response?.data || error.message);
            throw new Error('eBay Authentication Failed');
        }
    }

    /**
     * Recherche d'annonces actives via la Browse API.
     * Renvoie une liste normalisée (NormalizedPart[]).
     */
    static async searchParts(query: string, options: SearchOptions = {}): Promise<NormalizedPart[]> {
        const {
            limit = 6,
            categoryId = DEFAULT_CATEGORY_ID,
            marketplaceId = EBAY_MARKETPLACE_ID,
            withDescriptions = true,
            descriptionCount = 3,
            sellers,
        } = options;

        const filtre = buildSearchFilter({ sellers });

        try {
            const token = await this.getAccessToken();

            if (token === 'mock_ebay_token') {
                return this.generateMockEbayResults(query);
            }

            const response = await axios.get(
                `${API_BASE}/buy/browse/v1/item_summary/search`,
                {
                    params: {
                        q: query,
                        category_ids: categoryId,
                        limit,
                        // N'expose QUE les annonces effectivement livrables en
                        // France : sans ce filtre, l'opérateur découvrait au
                        // moment d'acheter que le vendeur n'expédie pas chez
                        // nous — après avoir annoncé un prix au client.
                        // On ne filtre PAS sur le pays du VENDEUR : les pièces
                        // d'occasion viennent massivement d'Allemagne/Italie.
                        filter: filtre,
                    },
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                        // Recherche prioritairement sur le marché FR/EU.
                        'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=FR',
                    },
                    timeout: 20000,
                }
            );

            const summaries = response.data?.itemSummaries || [];
            let results: NormalizedPart[] = summaries.map((s: any) => this.normalizeSummary(s));

            // Second rempart : le filtre eBay devrait suffire, mais une annonce
            // dont l'enchère a dépassé le prix d'achat immédiat passerait au
            // travers. Le prix annoncé au client doit toujours être achetable.
            if (FIXED_PRICE_ONLY) {
                const avant = results.length;
                results = results.filter((r) => estPrixFerme(r));
                const ecartes = avant - results.length;
                if (ecartes > 0) console.warn(`[eBay] ${ecartes} annonce(s) sans prix ferme écartée(s)`);
            }

            // Enrichissement via getItem — VOLONTAIREMENT limite aux N premiers seulement,
            // pour maitriser la consommation du quota eBay (1 getItem = 1 appel).
            //  - L'image vient deja de la recherche (image / thumbnailImages, cf. normalizeSummary) ;
            //    on n'appelle donc PLUS getItem juste pour une image. Les rares annonces sans
            //    miniature afficheront une image de repli cote frontend, et l'image reelle se
            //    charge a la demande au clic (route /parts/item -> getItem unitaire).
            //  - On recupere la description complete uniquement pour les N premiers (apercu).
            if (results.length > 0 && withDescriptions) {
                const n = Math.min(descriptionCount, results.length);
                await Promise.all(
                    results.slice(0, n).map(async (part) => {
                        try {
                            const detail = await this.getItem(part.itemId, token, marketplaceId);
                            if (detail) {
                                part.fullDescription = detail.description || part.shortDescription;
                                if (!part.image) {
                                    part.image = detail.image?.imageUrl
                                        || detail.additionalImages?.[0]?.imageUrl
                                        || part.image;
                                    if (!part.thumbnail) part.thumbnail = part.image;
                                }
                            }
                        } catch {
                            // Enrichissement optionnel : on ignore les echecs individuels.
                        }
                    })
                );
            }

            this.lastDiagnostic = {
                at: new Date().toISOString(), ok: true, count: results.length,
                marketplace: marketplaceId, error: null, mock: false,
            };
            return results;
        } catch (error: any) {
            const detail = error.response?.data || error.message;
            console.error('[eBay] Échec recherche:', detail);
            this.lastDiagnostic = {
                at: new Date().toISOString(), ok: false, count: 0,
                marketplace: marketplaceId,
                error: (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300),
                mock: true,
            };
            // Fallback mock pour ne pas casser le MVP.
            return this.generateMockEbayResults(query);
        }
    }

    /**
     * Détail d'une annonce (Browse getItem) — fournit la description HTML complète.
     */
    static async getItem(itemId: string, token?: string, marketplaceId = EBAY_MARKETPLACE_ID): Promise<any | null> {
        try {
            const accessToken = token || await this.getAccessToken();
            if (accessToken === 'mock_ebay_token') return null;

            const response = await axios.get(
                `${API_BASE}/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                    },
                    timeout: 20000,
                }
            );
            return response.data;
        } catch (error: any) {
            console.error(`[eBay] Échec getItem ${itemId}:`, error.response?.data || error.message);
            return null;
        }
    }

    // Diagnostic: renvoie la reponse eBay brute (image / thumbnailImages) des premiers items.
    static async debugSearch(query: string): Promise<any> {
        const token = await this.getAccessToken();
        if (token === 'mock_ebay_token') return { mock: true };
        const response = await axios.get(
            `${API_BASE}/buy/browse/v1/item_summary/search`,
            {
                params: { q: query, category_ids: DEFAULT_CATEGORY_ID, limit: 3 },
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
                },
                timeout: 20000,
            }
        );
        const items = response.data?.itemSummaries || [];
        return {
            total: response.data?.total,
            count: items.length,
            first: items.slice(0, 2).map((s: any) => ({
                keys: Object.keys(s),
                title: s.title,
                image: s.image,
                thumbnailImages: s.thumbnailImages,
            })),
        };
    }

    /**
     * Frais de port vendeur -> entrepôt, extraits des options d'expédition.
     *
     * ⚠️ Trois cas à ne pas confondre :
     *   - shippingCost.value = 0        -> livraison offerte (montant FERME de 0 €)
     *   - shippingCostType = CALCULATED -> dépend de l'adresse : montant INCONNU
     *   - aucune option                 -> INCONNU
     * Renvoyer 0 pour un port inconnu conduirait à vendre à perte : on renvoie
     * donc null, ce qui bascule la commande en validation opérateur.
     */
    private static extractShipping(s: any): { shippingCost: number | null; shippingType: string | null } {
        const options: any[] = Array.isArray(s.shippingOptions) ? s.shippingOptions : [];
        if (!options.length) return { shippingCost: null, shippingType: null };

        // On retient l'option la moins chère parmi celles au montant ferme.
        let best: number | null = null;
        let type: string | null = null;

        for (const o of options) {
            const t = o.shippingCostType || null;
            const raw = o.shippingCost?.value;
            const val = raw != null ? parseFloat(raw) : null;

            if (t === 'CALCULATED') {
                if (type === null) type = 'CALCULATED';
                continue; // montant non ferme : inexploitable pour un prix ferme
            }
            if (val != null && Number.isFinite(val)) {
                if (best === null || val < best) best = val;
                type = 'FIXED';
            }
        }
        return { shippingCost: best, shippingType: type };
    }

    private static normalizeSummary(s: any): NormalizedPart {
        const priceValue = s.price?.value != null ? parseFloat(s.price.value) : null;
        const shipping = this.extractShipping(s);
        return {
            itemId: s.itemId,
            title: s.title || '',
            price: Number.isFinite(priceValue as number) ? (priceValue as number) : null,
            currency: s.price?.currency || 'EUR',
            image: s.image?.imageUrl || s.thumbnailImages?.[0]?.imageUrl || null,
            thumbnail: s.thumbnailImages?.[0]?.imageUrl || s.image?.imageUrl || null,
            condition: s.condition || null,
            itemWebUrl: s.itemWebUrl || null,
            seller: s.seller?.username || null,
            buyingOptions: Array.isArray(s.buyingOptions) ? s.buyingOptions : null,
            currentBidEur: s.currentBidPrice?.value != null
                ? parseFloat(s.currentBidPrice.value) : null,
            shortDescription: s.shortDescription || null,
            fullDescription: null,
            shippingCost: shipping.shippingCost,
            shippingType: shipping.shippingType,
        };
    }

    /**
     * Données mock (creds manquants ou API en échec) — clairement marquées isMock.
     */
    private static generateMockEbayResults(query: string): NormalizedPart[] {
        return [
            {
                itemId: 'mock_123',
                title: `${query} — Qualité Premium OES`,
                price: 45.0,
                currency: 'EUR',
                image: 'https://i.ebayimg.com/images/g/placeholder/s-l500.jpg',
                thumbnail: 'https://i.ebayimg.com/images/g/placeholder/s-l225.jpg',
                condition: 'NEW',
                itemWebUrl: 'https://www.ebay.fr/',
                seller: 'mock_seller',
                shortDescription: `Pièce compatible pour la recherche : ${query}.`,
                fullDescription: `Résultat de démonstration (mock). Configurez EBAY_APP_ID / EBAY_CERT_ID pour des annonces réelles. Recherche : ${query}.`,
                isMock: true,
            },
        ];
    }
}
