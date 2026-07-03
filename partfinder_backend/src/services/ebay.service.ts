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
    isMock?: boolean;
}

interface SearchOptions {
    limit?: number;
    categoryId?: string;
    marketplaceId?: string;
    /** Récupère la description complète (getItem) pour les N premiers résultats. */
    withDescriptions?: boolean;
    descriptionCount?: number;
}

export class EbayService {

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
        } = options;

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

            // Enrichit les premiers résultats avec la description complète.
            if (withDescriptions && results.length > 0) {
                const n = Math.min(descriptionCount, results.length);
                await Promise.all(
                    results.slice(0, n).map(async (part) => {
                        try {
                            const detail = await this.getItem(part.itemId, token, marketplaceId);
                            if (detail) {
                                part.fullDescription = detail.description || part.shortDescription;
                                if (!part.image && detail.image?.imageUrl) part.image = detail.image.imageUrl;
                            }
                        } catch {
                            // Description optionnelle : on ignore les échecs individuels.
                        }
                    })
                );
            }

            return results;
        } catch (error: any) {
            console.error('[eBay] Échec recherche:', error.response?.data || error.message);
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

    private static normalizeSummary(s: any): NormalizedPart {
        const priceValue = s.price?.value != null ? parseFloat(s.price.value) : null;
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
            shortDescription: s.shortDescription || null,
            fullDescription: null,
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
