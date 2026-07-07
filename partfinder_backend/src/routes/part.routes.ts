import express from 'express';
import { EbayService } from '../services/ebay.service';
import { PartAiService, VehicleContext, PartRequest } from '../services/part_ai.service';

const router = express.Router();

// Marge appliquée sur le prix source (33% par défaut, surchargée par env).
const MARGIN_MULTIPLIER = Number(process.env.PART_MARGIN_MULTIPLIER || '1.33');

/**
 * Détermine la pièce par IA à partir du véhicule + demande client.
 * body: { vehicle: {...}, request: { description?, oem? } }
 */
router.post('/determine', async (req: express.Request, res: express.Response) => {
    try {
        const vehicle: VehicleContext = req.body.vehicle || {};
        const request: PartRequest = req.body.request || {};
        const part = await PartAiService.determinePart(vehicle, request);
        res.json({ part, aiConfigured: PartAiService.isConfigured() });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Recherche eBay à partir d'une requête déjà construite.
 * body: { query, limit? }
 */
router.post('/search', async (req: express.Request, res: express.Response) => {
    try {
        const { query, limit } = req.body;
        if (!query) return res.status(400).json({ error: 'Missing search query' });

        const results = await EbayService.searchParts(query, { limit });
        res.json({
            query,
            env: EbayService.currentEnv(),
            ebayConfigured: EbayService.isConfigured(),
            count: results.length,
            results,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Flux complet : détermine la pièce par IA PUIS lance la recherche eBay.
 * body: { vehicle: {...}, request: { description?, oem? }, limit? }
 * -> renvoie la pièce déterminée + les annonces (prix source + prix final marginé).
 */
router.post('/find', async (req: express.Request, res: express.Response) => {
    try {
        const vehicle: VehicleContext = req.body.vehicle || {};
        const request: PartRequest = req.body.request || {};
        const limit = req.body.limit;

        const part = await PartAiService.determinePart(vehicle, request);

        // Cascade de requetes : de la plus precise a la plus large.
        // eBay exige que TOUS les mots correspondent -> une requete trop longue = 0 resultat.
        const pn = part.partName || request.description || '';
        const candidatesRaw = [
            request.oem || null,                                                   // OEM seul (le plus precis)
            part.ebayQuery,                                                        // requete IA complete
            [pn, vehicle.make, vehicle.model, vehicle.platform].filter(Boolean).join(' '),
            [pn, vehicle.make, vehicle.model].filter(Boolean).join(' '),
            [pn, vehicle.make].filter(Boolean).join(' '),
        ];
        const seen = new Set<string>();
        const candidates = candidatesRaw
            .map(c => (c || '').trim())
            .filter(c => c.length > 0 && !seen.has(c.toLowerCase()) && !!seen.add(c.toLowerCase()));

        let rawResults: any[] = [];
        let usedQuery = part.ebayQuery;
        for (const q of candidates) {
            const r = await EbayService.searchParts(q, { limit });
            if (r && r.length > 0) {
                rawResults = r;
                usedQuery = q;
                break;
            }
        }

        // Ajoute le prix final (avec marge) tout en gardant le prix source.
        const results = rawResults.map((r) => ({
            ...r,
            sourcePrice: r.price,
            finalPrice: r.price != null ? Math.round(r.price * MARGIN_MULTIPLIER * 100) / 100 : null,
        }));

        res.json({
            part,
            usedQuery,
            triedQueries: candidates,
            aiConfigured: PartAiService.isConfigured(),
            env: EbayService.currentEnv(),
            ebayConfigured: EbayService.isConfigured(),
            marginMultiplier: MARGIN_MULTIPLIER,
            count: results.length,
            results,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Détail d'un article eBay pour la fiche interne (SANS lien eBay).
 * Renvoie: titre, prix TTC (marge), état, images, description complète, caractéristiques.
 */
router.get('/item/:itemId', async (req: express.Request, res: express.Response) => {
    try {
        const detail: any = await EbayService.getItem(req.params.itemId);
        if (!detail) return res.status(404).json({ error: 'Article introuvable' });

        const price = detail.price?.value != null ? parseFloat(detail.price.value) : null;
        const finalPrice = price != null ? Math.round(price * MARGIN_MULTIPLIER * 100) / 100 : null;

        const images: string[] = [];
        if (detail.image?.imageUrl) images.push(detail.image.imageUrl);
        if (Array.isArray(detail.additionalImages)) {
            for (const im of detail.additionalImages) if (im?.imageUrl) images.push(im.imageUrl);
        }

        const aspects: { name: string; value: any }[] = [];
        if (Array.isArray(detail.localizedAspects)) {
            for (const a of detail.localizedAspects) if (a?.name) aspects.push({ name: a.name, value: a.value });
        }

        // On n'expose volontairement PAS itemWebUrl / la source eBay.
        res.json({
            itemId: detail.itemId,
            title: detail.title || '',
            price: finalPrice,
            currency: detail.price?.currency || 'EUR',
            condition: detail.condition || null,
            images,
            description: detail.description || detail.shortDescription || '',
            aspects,
            brand: detail.brand || null,
            mpn: detail.mpn || null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Prix final d'un article (marge appliquée). Passe le prix source via ?base=XX.XX
 */
router.get('/:id/prices', async (req: express.Request, res: express.Response) => {
    try {
        const baseCost = parseFloat((req.query.base as string) || '100');
        const finalPrice = Math.round(baseCost * MARGIN_MULTIPLIER * 100) / 100;
        res.json({
            provider: 'partfinder_internal', // masque la source eBay
            baseCost: baseCost.toFixed(2),
            finalPrice: finalPrice.toFixed(2),
            marginPercent: `${Math.round((MARGIN_MULTIPLIER - 1) * 100)}%`,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
