import express from 'express';
import { EbayService } from '../services/ebay.service';
import { AliexpressService } from '../services/aliexpress.service';
import { PartAiService, VehicleContext, PartRequest } from '../services/part_ai.service';
import * as pricing from '../services/pricing';

const router = express.Router();

// Marge appliquée sur le prix source (33% par défaut, surchargée par env).
const MARGIN_MULTIPLIER = Number(process.env.PART_MARGIN_MULTIPLIER || '1.33');

// Nettoie une description HTML eBay : retire le CSS/scripts/boilerplate vendeur, garde le texte utile.
function cleanEbayDescription(html: string): string {
    if (!html) return '';
    let t = String(html);
    t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    t = t.replace(/<!--[\s\S]*?-->/g, ' ');
    t = t.replace(/<\s*br\s*\/?>/gi, '\n');
    t = t.replace(/<\/\s*(p|div|li|tr|h[1-6]|ul|ol|table|section)\s*>/gi, '\n');
    t = t.replace(/<[^>]+>/g, ' ');
    const entities: Record<string, string> = {
        '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
        '&eacute;': 'é', '&egrave;': 'è', '&agrave;': 'à', '&ccedil;': 'ç', '&ocirc;': 'ô',
        '&ldquo;': '"', '&rdquo;': '"', '&rsquo;': "'"
    };
    t = t.replace(/&[a-z#0-9]+;/gi, (m) => entities[m.toLowerCase()] ?? ' ');
    // Retire les lignes de CSS residuel
    t = t.split('\n').map(l => l.trim())
        .filter(l => l && !/[{}]/.test(l) && !/^[.#@][\w-]/.test(l))
        .join('\n');
    // Coupe au premier marqueur de pied de page vendeur
    const markers = ['procédure d', 'modes de paiement', 'tous droits réservés', '© 20'];
    const low = t.toLowerCase();
    let cut = t.length;
    for (const m of markers) { const i = low.indexOf(m); if (i > 60 && i < cut) cut = i; }
    t = t.slice(0, cut);
    t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (t.length > 1600) t = t.slice(0, 1600).replace(/\s+\S*$/, '') + '…';
    return t;
}

/**
 * GET /api/parts/shipping-info?zone=OM1 — informations d'acheminement (PUBLIC).
 * Alimente l'explication « pourquoi + frais de port » côté client : grille
 * d'acheminement outre-mer et limites de colis. Aucune donnée interne
 * (marge, coût d'acquisition, source d'approvisionnement) n'est exposée.
 */
router.get('/shipping-info', async (req: express.Request, res: express.Response) => {
    try {
        const zoneReq = String(req.query.zone || 'OM1').toUpperCase();
        const zone: 'OM1' | 'OM2' = zoneReq === 'OM2' ? 'OM2' : 'OM1';
        const tranches = await pricing.getTranches(zone);
        res.json({
            zone,
            tranches: tranches.map((t) => ({ jusquAKg: t.poidsMaxKg, prixEur: t.prixEur })),
            limites: {
                poidsMaxKg: pricing.MAX_WEIGHT_KG,
                longueurMaxCm: pricing.MAX_LENGTH_CM,
                sommeDimsStandardCm: pricing.DIMS_SUM_STANDARD_CM,
                sommeDimsMaxCm: pricing.DIMS_SUM_MAX_CM,
            },
            zones: {
                OM1: 'Guadeloupe, Martinique, Guyane, La Réunion, Mayotte, Saint-Pierre-et-Miquelon, Saint-Martin, Saint-Barthélemy',
                OM2: 'Nouvelle-Calédonie, Polynésie française, Wallis-et-Futuna',
            },
        });
    } catch (e: any) {
        console.error('[parts] shipping-info:', e.message);
        res.status(500).json({ error: 'Informations d\'acheminement indisponibles.' });
    }
});

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

        // Requête AliExpress : la plus parlante (nom pièce + véhicule), lancée EN PARALLÈLE
        // de la cascade eBay pour ne pas ralentir. Renvoie [] si non configuré / échec.
        const aeQuery = [pn, vehicle.make, vehicle.model].filter(Boolean).join(' ') || request.oem || part.ebayQuery || '';
        const aliexpressPromise = AliexpressService.searchProducts(aeQuery, limit || 20);

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

        const aliexpressResults = await aliexpressPromise;

        // Applique la marge (prix final) en gardant le prix source, et tague la source.
        const withMargin = (r: any, source: string) => ({
            ...r,
            source,
            sourcePrice: r.price,
            finalPrice: r.price != null ? Math.round(r.price * MARGIN_MULTIPLIER * 100) / 100 : null,
        });

        // Résultats fusionnés : eBay puis AliExpress, dans une seule liste homogène.
        const merged = [
            ...rawResults.map((r) => withMargin(r, 'ebay')),
            ...aliexpressResults.map((r) => withMargin(r, 'aliexpress')),
        ];

        // Tarification tout compris (aucun appel IA : interdit sur une liste).
        // La zone conditionne le port outre-mer ; OM1 par défaut.
        const zoneReq = String(req.body.zone || 'OM1').toUpperCase();
        const zone: 'OM1' | 'OM2' = zoneReq === 'OM2' ? 'OM2' : 'OM1';

        let results = merged;
        try {
            const quotes = await pricing.quoteMany(
                merged.map((r: any) => ({
                    id: String(r.itemId),
                    prixPieceEur: Number(r.price) || 0,
                    portVendeurEur: r.shippingCost != null ? Number(r.shippingCost) : null,
                    titre: r.title,
                    description: r.shortDescription,
                    // La catégorie déterminée par l'IA de recherche sert de
                    // poids de référence si elle correspond au référentiel.
                    categoryCode: (part as any).categoryCode || null,
                })),
                zone,
            );
            const byId = new Map(quotes.map((q) => [q.id, q]));
            results = merged.map((r: any) => {
                const q = byId.get(String(r.itemId));
                return {
                    ...r,
                    // Prix client : tout compris si calculable, sinon hors port.
                    prixClientEur: q?.prixClientEur ?? null,
                    prixHorsPortEur: q?.prixHorsPortEur ?? null,
                    portInconnu: q?.portInconnu ?? true,
                    regimePrix: q?.regime ?? 'ESTIME',
                };
            });
        } catch (e: any) {
            // La tarification ne doit jamais casser la recherche.
            console.error('[parts] tarification:', e.message);
        }

        res.json({
            part,
            usedQuery,
            aliexpressQuery: aeQuery,
            triedQueries: candidates,
            aiConfigured: PartAiService.isConfigured(),
            env: EbayService.currentEnv(),
            ebayConfigured: EbayService.isConfigured(),
            aliexpressConfigured: AliexpressService.isConfigured(),
            marginMultiplier: MARGIN_MULTIPLIER,
            count: results.length,
            countEbay: rawResults.length,
            countAliexpress: aliexpressResults.length,
            results,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Diagnostic: montre la reponse eBay brute (pour verifier les images).
 */
router.get('/debug-search', async (req: express.Request, res: express.Response) => {
    try {
        const q = String(req.query.q || 'alternateur');
        const raw = await EbayService.debugSearch(q);
        res.json({ query: q, env: EbayService.currentEnv(), configured: EbayService.isConfigured(), raw });
    } catch (e: any) {
        res.status(500).json({ error: e.message, ebay: e.response?.data });
    }
});

/**
 * Détail d'un article eBay pour la fiche interne (SANS lien eBay).
 * Renvoie: titre, prix TTC (marge), état, images, description complète, caractéristiques.
 */
router.get('/item/:itemId', async (req: express.Request, res: express.Response) => {
    try {
        const detail: any = await EbayService.getItem(String(req.params.itemId));
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
            description: cleanEbayDescription(detail.description || detail.shortDescription || ''),
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
