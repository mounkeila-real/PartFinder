import axios from 'axios';

// Note: To use the eBay API, we need the App ID, Cert ID (Secret), and a RuName for OAuth.
const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;

export class EbayService {

    /**
     * Obtains an Application Access Token (Client Credentials Grant)
     * Used for general APIs like Catalog API or Browse API (searching parts).
     */
    static async getAccessToken(): Promise<string> {
        if (!EBAY_APP_ID || !EBAY_CERT_ID) {
            console.warn("eBay credentials missing. Returning mock token for now.");
            return "mock_ebay_token";
        }

        const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');

        try {
            const response = await axios.post(
                'https://api.ebay.com/identity/v1/oauth2/token',
                'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${credentials}`
                    }
                }
            );

            return response.data.access_token;
        } catch (error: any) {
            console.error("Failed to get eBay access token:", error.response?.data || error.message);
            throw new Error("eBay Authentication Failed");
        }
    }

    /**
     * Searches for active items on eBay using the Browse API.
     * We can pass an OEM reference or part name here.
     */
    static async searchParts(query: string) {
        try {
            const token = await this.getAccessToken();

            // Note: If using mock_ebay_token, we skip the real call
            if (token === "mock_ebay_token") {
                return this.generateMockEbayResults(query);
            }

            const response = await axios.get(
                'https://api.ebay.com/buy/browse/v1/item_summary/search',
                {
                    params: {
                        q: query,
                        category_ids: '6030', // Auto Parts category
                        limit: 3 // top 3 results
                    },
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-EBAY-C-MARKETPLACE-ID': 'EBAY-FR'
                    }
                }
            );

            return response.data;
        } catch (error: any) {
            console.error("Failed to search eBay:", error.response?.data || error.message);
            // Fallback to mock data if the API fails during MVP
            return this.generateMockEbayResults(query);
        }
    }

    /**
     * Temporary mock data fallback while API keys are pending
     */
    private static generateMockEbayResults(query: string) {
        return {
            itemSummaries: [
                {
                    itemId: "mock_123",
                    title: `[eBay] ${query} - Qualité Premium OES`,
                    price: { value: "45.00", currency: "EUR" },
                    image: { imageUrl: "https://i.ebayimg.com/thumbs/images/g/xxxx/s-l225.jpg" }
                }
            ]
        };
    }
}
