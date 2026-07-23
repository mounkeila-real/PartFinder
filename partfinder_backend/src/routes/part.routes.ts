import express from 'express';
import axios from 'axios';
import { EbayService } from '../services/ebay.service';
import { AliexpressService } from '../services/aliexpress.service';
import { PartAiService, VehicleContext, PartRequest } from '../services/part_ai.service';
import * as pricing from '../services/pricing';
import { requireAdmin } from '../middleware/auth.middleware';
import { signOffer } from '../services/offer_token';
import { translateQuery, MARKETPLACES } from '../services/part_glossary';
import { TERRITOIRES } from '../services/territoires';
import { getActiveSellers } from '../services/supplier_sellers.service';
import { translateToFrench } from '../services/translation.service';
import { observerTermes } from '../services/glossary_learning.service';
import { cleanEbayDescription } from '../services/description_cleaner';

const router = express.Router();

// Marge appliquée sur le prix source (33% par défaut, surchargée par env).
const MARGIN_MULTIPLIER = Number(process.env.PART_MARGIN_MULTIPLIER || '1.33');

/* ── Relais d'images ──────────────────────────────────────────────
 * Les visuels des annonces sont servis PAR NOUS, jamais chargés depuis le
 * domaine du fournisseur : le navigateur du client ne doit jamais émettre de
 * requête vers un domaine de marketplace (l'URL trahirait la source, et ces
 * CDN sont parfois bloqués par les filtrages réseau d'entreprise).
 *
 * Liste blanche STRICTE d'hôtes + HTTPS obligatoire : sans cela, la route
 * serait un proxy ouvert (SSRF) permettant d'atteindre le réseau interne.
 */
const IMAGE_HOSTS = new Set([
    'i.ebayimg.com',
    'thumbs.ebaystatic.com',
    'ir.ebaystatic.com',
    'ae01.alicdn.com',
    'ae02.alicdn.com',
    'ae03.alicdn.com',
    'ae04.alicdn.com',
    'img.alicdn.com',
    'ae-pic-a1.aliexpress-media.com',
]);

/** Réécrit une URL d'image fournisseur en URL neutre servie par ce backend. */
function proxifyImage(url: string | null | undefined, req: express.Request): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' || !IMAGE_HOSTS.has(u.hostname)) return null;
        const token = Buffer.from(url, 'utf8').toString('base64url');
        const host = req.get('x-forwarded-host') || req.get('host');
        const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0];
        return `${proto}://${host}/api/parts/image/${token}`;
    } catch {
        return null;
    }
}

/**
 * GET /api/parts/image/:token — sert le visuel d'une annonce (PUBLIC).
 * Le token est l'URL source encodée en base64url ; l'hôte est revalidé ici.
 */
router.get('/image/:token', async (req: express.Request, res: express.Response) => {
    try {
        const raw = Buffer.from(String(req.params.token), 'base64url').toString('utf8');
        const u = new URL(raw);
        if (u.protocol !== 'https:' || !IMAGE_HOSTS.has(u.hostname)) {
            return res.status(404).end();
        }

        const upstream = await axios.get(raw, {
            responseType: 'arraybuffer',
            timeout: 10000,
            maxContentLength: 8 * 1024 * 1024,
            // Aucun en-tête identifiant notre client n'est transmis en amont.
            headers: { 'User-Agent': 'PartFinder/1.0' },
        });

        const type = String(upstream.headers['content-type'] || 'image/jpeg');
        if (!type.startsWith('image/')) return res.status(404).end();

        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 jours
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        return res.send(Buffer.from(upstream.data));
    } catch {
        // Visuel indisponible : le frontend affiche son propre repli.
        return res.status(404).end();
    }
});

/**
 * POST /api/parts/translate — traduction de repli (PUBLIC).
 *
 * Le navigateur traduit en priorité, sur l'appareil du client et sans rien
 * coûter. Cette route ne sert QUE les navigateurs non compatibles (Firefox,
 * Safari, mobile). Bornée par le service (nombre de textes, longueur) et par
 * un plafond mensuel : elle ne doit pas devenir un service de traduction
 * gratuit pour des tiers.
 */
router.post('/translate', async (req: express.Request, res: express.Response) => {
    try {
        const textes = Array.isArray(req.body?.textes) ? req.body.textes : [];
        if (!textes.length) return res.json({ textes: [], moteurs: [], quotaAtteint: false });
        const r = await translateToFrench(textes);
        res.json(r);
    } catch (e: any) {
        console.error('[parts] translate:', e.message);
        // Jamais d'échec visible : le client garde les textes d'origine.
        res.json({ textes: req.body?.textes || [], moteurs: [], quotaAtteint: false });
    }
});

/**
 * GET /api/parts/territoires — territoires desservis (PUBLIC).
 * Référentiel unique : le frontend ne redéfinit pas sa propre liste, qui
 * finirait par diverger de celle qui sert au calcul du tarif.
 */
router.get('/territoires', (_req: express.Request, res: express.Response) => {
    res.json({
        territoires: TERRITOIRES.map((t) => ({
            code: t.code, label: t.label, zone: t.zone, prefixes: t.prefixes,
        })),
    });
});

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
/**
 * RESERVE AUX ADMINS : renvoie les annonces BRUTES du fournisseur (lien vers
 * l'annonce, vendeur, prix d'achat). Aucun écran client ne l'utilise — le
 * parcours client passe par /find, qui neutralise ces champs.
 */
router.post('/search', requireAdmin, async (req: express.Request, res: express.Response) => {
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

        // Requête AliExpress, lancée EN PARALLÈLE de la cascade eBay.
        // EN ANGLAIS : les titres AliExpress le sont massivement, et une
        // requête française y ramène beaucoup moins. La référence OEM, elle,
        // est universelle et prime quand elle existe.
        // L'ANNÉE et le CODE PLATEFORME sont inclus : les annonces AliExpress
        // d'électronique adaptable sont titrées « … B Class W246 2017 ». Le
        // code châssis (W246) est le meilleur mot-clé, bien plus que la variante
        // moteur (« B 180 »). On l'extrait de platform (« W246 (2011-) »).
        const platformCode = (vehicle.platform || '').match(/[A-Z]\d{2,3}/)?.[0] || null;
        const aeBase = [pn, vehicle.make, vehicle.model, platformCode, vehicle.year]
            .filter(Boolean).join(' ');
        const aeTrad = translateQuery(aeBase, 'en');
        const aeQuery = request.oem?.trim()
            || (aeTrad.matched ? aeTrad.query : aeBase)
            || part.ebayQuery || '';
        const aliexpressPromise = AliexpressService.searchProducts(aeQuery, limit || 20);

        // 1) Marché français : cascade du plus précis au plus large.
        //    eBay exige que TOUS les mots correspondent — d'où la cascade.
        let rawResults: any[] = [];
        let usedQuery = part.ebayQuery;
        for (const q of candidates) {
            const r = await EbayService.searchParts(q, { limit });
            if (r && r.length > 0) {
                // Langue du marché d'origine : connue ici avec certitude, elle
                // évite au navigateur du client d'avoir à la deviner pour
                // traduire (une détection ratée = pas de traduction).
                rawResults = r.map((x: any) => ({ ...x, langue: 'fr' }));
                usedQuery = q;
                break;
            }
        }

        // 2) Marchés étrangers : UNE requête ciblée par pays, traduite via le
        //    glossaire (déterministe, aucun appel IA). Une pièce d'occasion est
        //    massivement listée en Allemagne : « Bremsbeläge » ouvre un
        //    catalogue que « plaquettes de frein » ne touchera jamais.
        //    Une seule requête par marché : la cascade complète multiplierait
        //    le quota eBay par 5.
        const baseQuery = [pn, vehicle.make, vehicle.model].filter(Boolean).join(' ');
        const foreign = MARKETPLACES.filter((m) => m.id !== 'EBAY_FR');
        const traductions: { marketplace: string; query: string }[] = [];

        const foreignResults = await Promise.all(
            foreign.map(async (m) => {
                // La référence OEM est universelle : quand elle existe, c'est
                // la meilleure clé transfrontalière, sans traduction.
                let q: string;
                if (request.oem && String(request.oem).trim()) {
                    q = String(request.oem).trim();
                } else {
                    const t = translateQuery(baseQuery, m.lang);
                    // Terme inconnu du glossaire : traduire n'apporterait rien
                    // et gaspillerait du quota sur une requête francaise.
                    if (!t.matched) return [];
                    q = t.query;
                }
                if (!q) return [];
                traductions.push({ marketplace: m.id, query: q });
                try {
                    const r = await EbayService.searchParts(q, {
                        limit,
                        marketplaceId: m.id,
                        // Descriptions inutiles ici : elles coûtent un appel
                        // getItem chacune, sur des résultats souvent écartés.
                        withDescriptions: false,
                    });
                    // Un marché en échec (identifiant invalide, API HS) fait
                    // retomber le service sur des données FACTICES. Acceptable
                    // en dernier recours sur la recherche principale, jamais
                    // ici : ce serait inventer des annonces étrangères.
                    return r.filter((x: any) => !x.isMock)
                            .map((x: any) => ({ ...x, langue: m.lang }));
                } catch {
                    return []; // un marché en échec ne casse pas la recherche
                }
            })
        );

        // 3) Casses professionnelles : recherche NOMINATIVE sur les vendeurs
        //    de la whitelist. La recherche générale classe par pertinence et
        //    noie ces vendeurs parmi les particuliers, alors que leurs stocks
        //    sont profonds et leurs délais tenus.
        //    Marchés limités à FR + DE (paramétrable) : les grosses casses
        //    européennes y sont présentes, et le quota eBay reste tenable.
        const vendeursPro = await getActiveSellers('EBAY');
        const usernamesPro = new Set(vendeursPro.map((v) => v.username.toLowerCase()));
        const itemsPro = new Set<string>();

        const lotsPro = vendeursPro.length
            ? await Promise.all(
                (process.env.EBAY_WHITELIST_MARKETPLACES || 'EBAY_FR,EBAY_DE')
                    .split(',').map((s) => s.trim()).filter(Boolean)
                    .map(async (mid) => {
                        const m = MARKETPLACES.find((x) => x.id === mid);
                        let q = baseQuery;
                        if (request.oem && String(request.oem).trim()) {
                            q = String(request.oem).trim();
                        } else if (m && m.lang !== 'fr') {
                            const t = translateQuery(baseQuery, m.lang);
                            if (!t.matched) return [];
                            q = t.query;
                        }
                        if (!q) return [];
                        try {
                            const r = await EbayService.searchParts(q, {
                                limit,
                                marketplaceId: mid,
                                sellers: vendeursPro.map((v) => v.username),
                                withDescriptions: false,
                            });
                            // Jamais de données factices ici (cf. plus haut).
                            return r.filter((x: any) => !x.isMock)
                                    .map((x: any) => ({ ...x, langue: m?.lang || 'fr' }));
                        } catch {
                            return []; // la recherche générale reste servie
                        }
                    })
            )
            : [];

        // Fusion + déduplication : la même annonce peut remonter sur plusieurs
        // marchés (les listings transfrontaliers sont visibles des deux côtés).
        const vus = new Set<string>(rawResults.map((r: any) => String(r.itemId)));
        let ecartesDevise = 0;
        for (const lot of foreignResults) {
            for (const r of lot) {
                const item = r as any;
                // Garde-fou : toute la tarification raisonne en euros. Laisser
                // passer une autre devise reviendrait à facturer « 50 » sans
                // savoir que ce sont des livres ou des zlotys.
                if (item.currency && item.currency !== 'EUR') { ecartesDevise++; continue; }
                const id = String(item.itemId);
                if (vus.has(id)) continue;
                vus.add(id);
                rawResults.push(item);
            }
        }
        // Annonces des casses professionnelles (ajout + marquage).
        for (const lot of lotsPro) {
            for (const r of lot) {
                const item = r as any;
                if (item.currency && item.currency !== 'EUR') { ecartesDevise++; continue; }
                const id = String(item.itemId);
                itemsPro.add(id);
                if (vus.has(id)) continue;
                vus.add(id);
                rawResults.push(item);
            }
        }
        // Marque aussi celles déjà remontées par la recherche générale : sinon
        // la même annonce serait « pro » ou non selon la requête qui l'a
        // trouvée en premier.
        for (const r of rawResults as any[]) {
            if (r.seller && usernamesPro.has(String(r.seller).toLowerCase())) {
                itemsPro.add(String(r.itemId));
            }
        }

        if (ecartesDevise > 0) {
            console.warn(`[parts] ${ecartesDevise} annonce(s) écartée(s) : devise non EUR`);
        }

        // Apprentissage : relève les termes étrangers que le glossaire ne
        // connaît pas encore. Volontairement NON attendu — la recherche
        // client ne doit pas ralentir pour un enrichissement différé.
        for (const r of rawResults as any[]) {
            if (r.langue && r.langue !== 'fr' && r.title) {
                observerTermes(r.title, r.langue).catch(() => null);
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
            // Titres AliExpress massivement en anglais.
            ...aliexpressResults.map((r) => ({ ...withMargin(r, 'aliexpress'), langue: 'en' })),
        ].map((r: any) => ({ ...r, vendeurPro: itemsPro.has(String(r.itemId)) }));

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

        // Remontée des casses professionnelles à prix comparable.
        // Le bonus est un POURCENTAGE, pas un montant fixe : sur une pièce à
        // 30 € comme sur une boîte de vitesses à 800 €, « comparable » n'a pas
        // la même valeur absolue.
        const boost = Number(process.env.WHITELIST_BOOST_PCT || '12') / 100;
        const prixDe = (r: any) => {
            const p = r.prixClientEur ?? r.prixHorsPortEur ?? r.finalPrice;
            return p != null ? Number(p) : Number.POSITIVE_INFINITY;
        };
        results = [...results].sort((a: any, b: any) => {
            const pa = prixDe(a) * (a.vendeurPro ? 1 - boost : 1);
            const pb = prixDe(b) * (b.vendeurPro ? 1 - boost : 1);
            return pa - pb;
        });

        // Point de passage OBLIGE : rien qui désigne le fournisseur ne sort
        // d'ici, quel que soit le chemin emprunté au-dessus (y compris
        // tarification en échec, qui retombait sur les résultats bruts).
        results = results.map((r: any) => {
            // itemWebUrl / seller identifient la source de façon flagrante ;
            // source / prix / port d'acquisition sont des données INTERNES :
            // elles voyagent désormais scellées dans offerToken (HMAC), le
            // client ne peut ni les lire ni les falsifier.
            const {
                itemWebUrl, seller, source, price, sourcePrice,
                shippingCost, shippingType, vendeurPro,
                // Vocabulaire propre à la place de marché : ne sort jamais.
                buyingOptions, currentBidEur,
                ...rest
            } = r;
            return {
                ...rest,
                // Badge NEUTRE : signale un vendeur professionnel sans jamais
                // nommer la place de marché ni la casse.
                vendeurProfessionnel: !!vendeurPro,
                image: proxifyImage(r.image, req),
                thumbnail: proxifyImage(r.thumbnail, req),
                // Descriptions redigees par le vendeur : nettoyees du HTML et
                // de toute mention de la source (elles sont affichees au client).
                shortDescription: r.shortDescription ? cleanEbayDescription(r.shortDescription) : r.shortDescription,
                fullDescription: r.fullDescription ? cleanEbayDescription(r.fullDescription) : r.fullDescription,
                offerToken: signOffer({
                    itemId: String(r.itemId),
                    source: String(source || ''),
                    sourcePriceEur: price != null ? Number(price) : null,
                    sourceShippingEur: shippingCost != null ? Number(shippingCost) : null,
                    sourceShippingType: shippingType || null,
                    // Le vendeur remonte à l'opérateur, scellé : il saura chez
                    // qui acheter sans que le client puisse le lire.
                    vendeur: seller ? String(seller) : null,
                    vendeurPro: !!vendeurPro,
                }),
            };
        });

        // Réponse PUBLIQUE : pas de champs de diagnostic — leurs NOMS mêmes
        // (ebayQuery, countEbay...) désignaient les fournisseurs. Vérifié :
        // aucun écran ne les consommait ; les requêtes construites restent
        // visibles dans les logs serveur pour le débogage.
        const { ebayQuery, source: partSource, ...partPublic } = (part || {}) as any;

        // Diagnostic de qualité (uniquement sur ?debug=1) : montre EXACTEMENT
        // les requêtes construites, pour comprendre pourquoi une recherche
        // remonte peu. Absent de la réponse normale — ces noms désignent les
        // fournisseurs et ne doivent pas fuiter côté client.
        const debug = (req.query.debug === '1' || req.body?.debug)
            ? {
                partNameDetermine: part?.partName || null,
                ebayQueryEssayees: candidates,
                ebayQueryRetenue: usedQuery,
                aliexpressQuery: aeQuery,
                aliexpressTraduit: aeTrad.matched,
                comptes: {
                    ebay: rawResults.filter((r: any) => r.source !== 'aliexpress').length,
                    aliexpress: aliexpressResults.length,
                },
            }
            : undefined;

        res.json({
            part: partPublic,
            aiConfigured: PartAiService.isConfigured(),
            count: results.length,
            results,
            ...(debug ? { debug } : {}),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/parts/debug-query — diagnostic de qualité, OUVRABLE DANS LE
 * NAVIGATEUR (contrairement à /find qui est en POST).
 *
 * Montre la requête EXACTE construite pour AliExpress à partir d'un véhicule
 * et d'une demande, et lance une petite recherche pour voir la couverture.
 * Paramètres : make, model, year, engine, platform, description, oem.
 * Exemple : /api/parts/debug-query?make=Mercedes-Benz&model=B%20180&platform=W246&year=2017&description=Grand%20ecran%20android
 */
router.get('/debug-query', async (req: express.Request, res: express.Response) => {
    try {
        const vehicle: VehicleContext = {
            make: req.query.make ? String(req.query.make) : undefined,
            model: req.query.model ? String(req.query.model) : undefined,
            year: req.query.year ? String(req.query.year) : undefined,
            engine: req.query.engine ? String(req.query.engine) : undefined,
            platform: req.query.platform ? String(req.query.platform) : undefined,
        } as any;
        const request: PartRequest = {
            description: req.query.description ? String(req.query.description) : undefined,
            oem: req.query.oem ? String(req.query.oem) : undefined,
        } as any;

        const part = await PartAiService.determinePart(vehicle, request);
        const pn = part.partName || request.description || '';
        const platformCode = (vehicle.platform || '').match(/[A-Z]\d{2,3}/)?.[0] || null;
        const aeBase = [pn, vehicle.make, vehicle.model, platformCode, vehicle.year]
            .filter(Boolean).join(' ');
        const aeTrad = translateQuery(aeBase, 'en');
        const aeQuery = request.oem?.trim() || (aeTrad.matched ? aeTrad.query : aeBase) || '';

        const produits = await AliexpressService.searchProducts(aeQuery, 10);

        res.json({
            entree: { vehicle, request },
            partNameDetermine: part.partName || null,
            codePlateforme: platformCode,
            aliexpressQuery: aeQuery,
            traduitEnAnglais: aeTrad.matched,
            aliexpressResultats: produits.length,
            echantillon: produits.slice(0, 5).map((p: any) => ({ titre: p.title, prixEur: p.price })),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/parts/debug-sources?q=... — ETAT DES SOURCES (admin).
 *
 * Les deux services echouent en SILENCE par conception (eBay retombe sur des
 * mocks, AliExpress renvoie []) pour ne jamais casser le parcours client.
 * Consequence : une source morte est invisible. Cette route interroge les deux
 * et rapporte ce qui s'est reellement passe.
 */
router.get('/debug-sources', requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
        const q = String(req.query.q || 'plaquettes de frein BMW');

        // Un test MANUEL doit toujours interroger réellement la source :
        // sinon le coupe-circuit renverrait un résultat vide sans appel, et
        // l'opérateur ne saurait pas si la correction a fonctionné.
        AliexpressService.rearmer();

        // AliExpress est interrogé en anglais, comme dans le parcours réel.
        const traductionAe = translateQuery(q, 'en');
        const [ebayResults, aeResults] = await Promise.all([
            EbayService.searchParts(q, { limit: 5 }),
            // 20 : représentatif d'une vraie recherche (une page AliExpress),
            // pas 5 qui donnait l'impression d'un catalogue vide.
            AliexpressService.searchProducts(traductionAe.matched ? traductionAe.query : q, 20),
        ]);

        const ebayDiag = EbayService.lastDiagnostic;
        const aeDiag = AliexpressService.lastDiagnostic;

        // Aperçu des traductions : permet de repérer un terme absent du
        // glossaire (la requête part alors en français sur un marché étranger,
        // donc pour rien).
        const traductions = MARKETPLACES.filter((m) => m.id !== 'EBAY_FR').map((m) => {
            const t = translateQuery(q, m.lang);
            return { marche: m.id, pays: m.pays, reconnu: t.matched, requete: t.matched ? t.query : null };
        });

        // État de CHAQUE marché : un identifiant invalide ou une API en échec
        // ne remonte aucune erreur — le service retombe silencieusement sur
        // des données factices. Seul un test par marché le révèle.
        const marches = await Promise.all(MARKETPLACES.map(async (m) => {
            const t = m.lang === 'fr' ? { matched: true, query: q } : translateQuery(q, m.lang);
            if (!t.matched) {
                return { marche: m.id, pays: m.pays, ok: false, resultats: 0, note: 'terme absent du glossaire' };
            }
            try {
                const r = await EbayService.searchParts(t.query, {
                    limit: 3, marketplaceId: m.id, withDescriptions: false,
                });
                const factices = r.some((x: any) => x.isMock);
                const reels = r.filter((x: any) => !x.isMock).length;
                return {
                    marche: m.id, pays: m.pays,
                    ok: reels > 0 && !factices,
                    resultats: reels,
                    note: factices
                        ? 'DONNEES FACTICES — identifiant de marche probablement invalide'
                        : (reels === 0 ? 'aucun resultat' : null),
                };
            } catch (e: any) {
                return { marche: m.id, pays: m.pays, ok: false, resultats: 0, note: e.message };
            }
        }));

        res.json({
            query: q,
            traductions,
            marches,
            ebay: {
                configure: EbayService.isConfigured(),
                environnement: EbayService.currentEnv(),
                resultats: ebayResults.length,
                // Signale explicitement les donnees factices : sans cela, un
                // echec eBay ressemble a une recherche qui marche.
                donneesFactices: ebayResults.some((r: any) => r.isMock),
                diagnostic: ebayDiag,
            },
            aliexpress: {
                configure: AliexpressService.isConfigured(),
                resultats: aeResults.length,
                coupee: AliexpressService.estCoupee(),
                diagnostic: aeDiag,
                // Forme brute de la réponse : indispensable tant que
                // l'intégration n'est pas validée (le mapping en dépend).
                reponseBrute: aeDiag?.rawExcerpt || null,
                methodeAppelee: process.env.ALIEXPRESS_SEARCH_METHOD || 'aliexpress.ds.text.search',
                requeteEnvoyee: traductionAe.matched ? traductionAe.query : q,
            },
            verdict: [
                EbayService.isConfigured() && !ebayResults.some((r: any) => r.isMock)
                    ? 'eBay : OK' : 'eBay : EN ECHEC (donnees factices ou non configure)',
                AliexpressService.isConfigured()
                    ? (aeDiag?.ok && aeResults.length > 0 ? 'AliExpress : OK' : 'AliExpress : EN ECHEC ou 0 resultat')
                    : 'AliExpress : NON CONFIGURE',
            ],
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Diagnostic: montre la reponse brute du fournisseur (pour verifier les images).
 *
 * RESERVE AUX ADMINS : cette reponse expose la source d'approvisionnement
 * (marque du fournisseur, URL d'annonces, prix d'achat). Publique, elle
 * contournait toute la demarketisation pour qui connaissait l'URL.
 */
router.get('/debug-search', requireAdmin, async (req: express.Request, res: express.Response) => {
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
        const itemId = String(req.params.itemId);

        // Article AliExpress (ae_<productId>) : détail via ds.product.get, qui
        // fournit poids et frais de port — indispensables au prix tout compris.
        if (itemId.startsWith('ae_')) {
            const prod = await AliexpressService.getProduct(itemId.slice(3));
            if (!prod) return res.status(404).json({ error: 'Article introuvable' });
            const aspects: { name: string; value: any }[] = [];
            if (prod.poidsKg != null) aspects.push({ name: 'Poids', value: `${prod.poidsKg} kg` });
            if (prod.portEur != null) aspects.push({ name: 'Frais de port', value: `${prod.portEur.toFixed(2)} €` });
            return res.json({
                itemId,
                title: prod.title,
                price: prod.price,
                currency: 'EUR',
                condition: 'Neuf',
                // Images servies par notre relais (jamais le domaine source).
                images: prod.images.map((u) => proxifyImage(u, req)).filter((u): u is string => !!u),
                description: cleanEbayDescription(prod.description || ''),
                aspects,
            });
        }

        const detail: any = await EbayService.getItem(itemId);
        if (!detail) return res.status(404).json({ error: 'Article introuvable' });

        const price = detail.price?.value != null ? parseFloat(detail.price.value) : null;
        const finalPrice = price != null ? Math.round(price * MARGIN_MULTIPLIER * 100) / 100 : null;

        // Visuels servis par nous (jamais le domaine du fournisseur).
        const rawImages: string[] = [];
        if (detail.image?.imageUrl) rawImages.push(detail.image.imageUrl);
        if (Array.isArray(detail.additionalImages)) {
            for (const im of detail.additionalImages) if (im?.imageUrl) rawImages.push(im.imageUrl);
        }
        const images = rawImages
            .map((u) => proxifyImage(u, req))
            .filter((u): u is string => !!u);

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
