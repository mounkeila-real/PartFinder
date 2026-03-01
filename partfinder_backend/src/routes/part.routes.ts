import express from 'express';
import { EbayService } from '../services/ebay.service';

const router = express.Router();

// Search for a part by description or OEM
router.post('/search', async (req: express.Request, res: express.Response) => {
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({ error: "Missing search query" });
        }

        // Logic here: we can search local DB first, then fallback to eBay
        const ebayResults = await EbayService.searchParts(query);
        res.json(ebayResults);

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get prices for a specific item ID (simulate a selected part from search)
// We apply the core PartFinder logic here: +33% margin on the base cost.
router.get('/:id/prices', async (req: express.Request, res: express.Response) => {
    try {
        const itemId = req.params.id;

        // In a real flow, checking `EbayService.getItem(itemId)`
        // For MVP mock logic, we simulate an incoming 100 EUR item.
        const baseCostCents = 10000; // 100.00 EUR

        const markupMultiplier = 1.33;
        const finalPriceCents = Math.round(baseCostCents * markupMultiplier);

        res.json({
            provider: "partfinder_internal", // Hiding eBay source
            baseCost: (baseCostCents / 100).toFixed(2),
            finalPrice: (finalPriceCents / 100).toFixed(2),
            marginPercent: "33%"
        });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
