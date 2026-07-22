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

const router = express.Router();

// Marge appliquée sur le prix source (33% par défaut, surchargée par env).
const MARGIN_MULTIPLIER = Number(process.env.PART_MARGIN_MULTIPLIER || '1.33');

/**
 * Retire d'un texte tout ce qui désigne la source d'approvisionnement.
 *
 * Les descriptions d'annonces sont rédigées par les vendeurs : elles citent
 * la marketplace et renvoient vers leur boutique. Comme cet extrait est
 * AFFICHÉ sur chaque carte de résultat, le nom du fournisseur se retrouvait
 * sous les yeux du client.
 */
function neutralizeSource(text: string): string {
    if (!text) return '';
    return String(text)
        // Liens vendeur / boutique (contiennent le domaine de la marketplace).
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\bwww\.\S+/gi, ' ')
        // Noms de marketplaces, avec ou sans extension de domaine.
        .replace(/\b(e-?bay|ali-?express|alibaba|paypal|leboncoin)(\.[a-z]{2,3}(\.[a-z]{2,3})?)?\b/gi, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

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
    return neutralizeSource(t);
}

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

        // Requête AliExpress : la plus parlante (nom pièce + véhicule), lancée EN PARALLÈLE
        // de la cascade eBay pour ne pas ralentir. Renvoie [] si non configuré / échec.
        const aeQuery = [pn, vehicle.make, vehicle.model].filter(Boolean).join(' ') || request.oem || part.ebayQuery || '';
        const aliexpressPromise = AliexpressService.searchProducts(aeQuery, limit || 20);

        // 1) Marché français : cascade du plus précis au plus large.
        //    eBay exige que TOUS les mots correspondent — d'où la cascade.
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
                    return await EbayService.searchParts(q, {
                        limit,
                        marketplaceId: m.id,
                        // Descriptions inutiles ici : elles coûtent un appel
                        // getItem chacune, sur des résultats souvent écartés.
                        withDescriptions: false,
                    });
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
                            return await EbayService.searchParts(q, {
                                limit,
                                marketplaceId: mid,
                                sellers: vendeursPro.map((v) => v.username),
                                withDescriptions: false,
                            });
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
                shippingCost, shippingType, vendeurPro, ...rest
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
        res.json({
            part: partPublic,
            aiConfigured: PartAiService.isConfigured(),
            count: results.length,
            results,
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
        const [ebayResults, aeResults] = await Promise.all([
            EbayService.searchParts(q, { limit: 5 }),
            AliexpressService.searchProducts(q, 5),
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

        res.json({
            query: q,
            traductions,
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
                diagnostic: aeDiag,
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
        const detail: any = await EbayService.getItem(String(req.params.itemId));
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
