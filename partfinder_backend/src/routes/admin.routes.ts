import express from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
import { AuthService } from '../services/auth.service';
import { EmailService } from '../services/email.service';
import { requireAdmin, AuthedRequest } from '../middleware/auth.middleware';
import { getActiveRates, replaceGrid, checkGridFreshness, activeProvider } from '../services/colissimo.service';
import { refreshColissimoRates } from '../jobs/scheduler';
import * as pricing from '../services/pricing';
import { invalidateSellersCache, verifierVendeur } from '../services/supplier_sellers.service';
import { candidats, statistiques, termesValides } from '../services/glossary_learning.service';
import { traduireVers } from '../services/translation.service';
import { chargerTermesAppris } from '../services/part_glossary';
import { prisma } from '../lib/prisma';

/**
 * Administration (Phase 3) — toutes les routes exigent le rôle ADMIN.
 * Gestion des clients (liste, suspension, suppression RGPD, reset password)
 * et des commandes (liste globale, changement de statut).
 */

const router = express.Router();

router.use(requireAdmin);

const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

function publicUser(u: any) {
    return {
        id: u.id, email: u.email, companyName: u.companyName, contactName: u.contactName,
        phone: u.phone, vatNumber: u.vatNumber, role: u.role, status: u.status,
        createdAt: u.createdAt, ordersCount: u._count ? u._count.orders : undefined,
    };
}

/** GET /api/admin/users — liste des clients (avec nb de commandes). */
router.get('/users', async (_req: AuthedRequest, res: express.Response) => {
    try {
        const users = await prisma.user.findMany({
            include: { _count: { select: { orders: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        res.json({ users: users.map(publicUser) });
    } catch (e: any) {
        console.error('[admin] users:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement des clients.' });
    }
});

/** GET /api/admin/users/:id — détail d'un client + ses commandes. */
router.get('/users/:id', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const user = await prisma.user.findUnique({
            where: { id },
            include: { orders: { include: { items: true }, orderBy: { createdAt: 'desc' } } },
        });
        if (!user) return res.status(404).json({ error: 'Client introuvable.' });
        res.json({ user: { ...publicUser(user), orders: user.orders } });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur.' });
    }
});

/** PATCH /api/admin/users/:id/status — body { status: ACTIVE|SUSPENDED } */
router.patch('/users/:id/status', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const { status } = req.body || {};
        if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
            return res.status(400).json({ error: 'Statut invalide (ACTIVE ou SUSPENDED).' });
        }
        if (id === req.user!.userId) {
            return res.status(400).json({ error: 'Impossible de suspendre votre propre compte.' });
        }
        const user = await prisma.user.update({ where: { id }, data: { status } });
        res.json({ user: publicUser(user) });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors du changement de statut.' });
    }
});

/**
 * POST /api/admin/users/:id/reset-password
 * Sans fournisseur d'email (Phase 4) : génère un mot de passe temporaire
 * affiché UNE FOIS à l'admin, qui le transmet au client par son propre canal.
 */
router.post('/users/:id/reset-password', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return res.status(404).json({ error: 'Client introuvable.' });

        const tempPassword = crypto.randomBytes(6).toString('base64url'); // ~8 caractères
        const passwordHash = await AuthService.hashPassword(tempPassword);
        await prisma.user.update({ where: { id }, data: { passwordHash } });

        console.log('[admin] reset password pour', user.email);
        res.json({ ok: true, tempPassword, email: user.email });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors du reset.' });
    }
});

/** DELETE /api/admin/users/:id — suppression RGPD (commandes anonymisées). */
router.delete('/users/:id', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        if (id === req.user!.userId) {
            return res.status(400).json({ error: 'Impossible de supprimer votre propre compte ici.' });
        }
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return res.status(404).json({ error: 'Client introuvable.' });

        await prisma.$transaction([
            prisma.order.updateMany({
                where: { userId: id },
                data: { userId: null, contactInfo: '[compte supprimé]', shippingAddress: null },
            }),
            prisma.user.delete({ where: { id } }),
        ]);
        console.log('[admin] compte supprimé:', user.email);
        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }
});

/** GET /api/admin/orders — toutes les commandes récentes. */
router.get('/orders', async (_req: AuthedRequest, res: express.Response) => {
    try {
        const orders = await prisma.order.findMany({
            include: { items: true, user: { select: { id: true, email: true, companyName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        res.json({ orders });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors du chargement des commandes.' });
    }
});

/** PATCH /api/admin/orders/:id/status — body { status } */
router.patch('/orders/:id/status', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const { status } = req.body || {};
        if (!ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Statut invalide. Attendu: ' + ORDER_STATUSES.join(', ') });
        }
        const order = await prisma.order.update({ where: { id }, data: { status }, include: { items: true } });
        res.json({ order });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors du changement de statut.' });
    }
});

/* ══════════════════════════════════════════════════════════════════
   Validation des commandes : ajustement du prix + demande de fonds
   ══════════════════════════════════════════════════════════════════ */

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

/**
 * PATCH /api/admin/orders/:id/price — l'opérateur arrête le prix définitif.
 * body: { quotedAmount, adminNote? }
 */
router.patch('/orders/:id/price', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const amount = Number(req.body?.quotedAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Montant invalide.' });
        }
        const order = await prisma.order.update({
            where: { id },
            data: {
                quotedAmount: amount,
                totalAmount: amount,
                adminNote: req.body?.adminNote ? String(req.body.adminNote) : null,
                validatedAt: new Date(),
            },
            include: { items: true },
        });
        res.json({ order });
    } catch (e: any) {
        console.error('[admin] price:', e.message);
        res.status(500).json({ error: 'Erreur lors de l\'ajustement du prix.' });
    }
});

/**
 * POST /api/admin/orders/:id/payment-link — génère la demande de fonds Stripe
 * pour le prix validé, passe la commande en AWAITING_PAYMENT et notifie le client.
 */
router.post('/orders/:id/payment-link', async (req: AuthedRequest, res: express.Response) => {
    try {
        if (!stripe) return res.status(503).json({ error: 'Paiement non configuré (STRIPE_SECRET_KEY manquant).' });

        const id = Number(req.params.id);
        const order = await prisma.order.findUnique({ where: { id }, include: { items: true, user: true } });
        if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

        const amount = Number(order.quotedAmount ?? order.totalAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Fixez d\'abord le prix définitif.' });
        }

        const base = process.env.FRONTEND_URL
            || (req.headers.origin as string)
            || 'https://partfinder-production.up.railway.app';

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: 'eur',
                    unit_amount: Math.round(amount * 100),
                    // Libellé neutre : aucune mention d'une source d'approvisionnement.
                    product_data: { name: `Commande PartFinder #${order.id}` },
                },
            }],
            success_url: `${base}/?paid=1&order=${order.id}`,
            cancel_url: `${base}/?canceled=1&order=${order.id}`,
            client_reference_id: String(order.id),
            metadata: { orderId: String(order.id) },
            customer_email: order.user?.email || undefined,
        });

        const updated = await prisma.order.update({
            where: { id: order.id },
            data: { stripeSessionId: session.id, paymentUrl: session.url, status: 'AWAITING_PAYMENT' },
        });

        // Notification client (best effort : n'échoue jamais la requête).
        if (order.user?.email && session.url) {
            EmailService.sendPaymentRequestEmail(order.user.email, order.id, amount, session.url, order.adminNote)
                .catch((err: any) => console.error('[admin] email demande de fonds:', err?.message));
        }

        res.json({ order: updated, paymentUrl: session.url });
    } catch (e: any) {
        console.error('[admin] payment-link:', e.message);
        res.status(500).json({ error: 'Erreur lors de la création de la demande de paiement.' });
    }
});

/* ══════════════════════════════════════════════════════════════════
   Grille tarifaire Colissimo (versionnée)
   ══════════════════════════════════════════════════════════════════ */

/** GET /api/admin/pricing/colissimo — grille en vigueur + état de fraîcheur. */
router.get('/pricing/colissimo', async (_req: AuthedRequest, res: express.Response) => {
    try {
        const [rates, freshness] = await Promise.all([getActiveRates(), checkGridFreshness()]);
        res.json({
            rates,
            freshness,
            provider: activeProvider().name,
            autoRefresh: activeProvider().name !== 'manuel',
        });
    } catch (e: any) {
        console.error('[admin] colissimo get:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement de la grille.' });
    }
});

/**
 * POST /api/admin/pricing/colissimo — publie une NOUVELLE grille.
 * L'ancienne est clôturée (historique conservé), jamais supprimée.
 * body: { valideDu: 'YYYY-MM-DD', rates: [{ zone, poidsMaxKg, prixEur }] }
 */
router.post('/pricing/colissimo', async (req: AuthedRequest, res: express.Response) => {
    try {
        const { valideDu, rates } = req.body || {};
        if (!Array.isArray(rates) || rates.length === 0) {
            return res.status(400).json({ error: 'Aucun tarif fourni.' });
        }
        const date = valideDu ? new Date(valideDu) : new Date();
        if (isNaN(date.getTime())) return res.status(400).json({ error: 'Date de validité invalide.' });

        // Validation stricte : une erreur de saisie ici se traduit en vente à perte.
        const clean = rates.map((r: any, i: number) => {
            const zone = String(r.zone || '').toUpperCase();
            const poids = Number(r.poidsMaxKg);
            const prix = Number(r.prixEur);
            if (zone !== 'OM1' && zone !== 'OM2') throw new Error(`Ligne ${i + 1} : zone invalide (OM1 ou OM2).`);
            if (!Number.isFinite(poids) || poids <= 0 || poids > 30) throw new Error(`Ligne ${i + 1} : poids invalide (0 < kg ≤ 30).`);
            if (!Number.isFinite(prix) || prix <= 0) throw new Error(`Ligne ${i + 1} : prix invalide.`);
            return { zone: zone as 'OM1' | 'OM2', poidsMaxKg: poids, prixEur: prix };
        });

        const count = await replaceGrid(clean, date);
        console.log(`[admin] nouvelle grille Colissimo publiée (${count} tranches) par user #${req.user!.userId}`);
        res.json({ ok: true, count, valideDu: date });
    } catch (e: any) {
        console.error('[admin] colissimo post:', e.message);
        res.status(400).json({ error: e.message || 'Erreur lors de la publication de la grille.' });
    }
});

/**
 * POST /api/admin/pricing/simulate — simulateur de prix (usage interne).
 * Renvoie la DÉCOMPOSITION COMPLÈTE, invisible côté client, pour vérifier la marge.
 * body: { prixPieceEur, portVendeurEur?, poidsKg?, categoryCode?, titre?, zone,
 *         valeurDeclareeEur?, assurance?, colisNonAnnonce?, consolidation? }
 */
router.post('/pricing/simulate', async (req: express.Request, res: express.Response) => {
    try {
        const b = req.body || {};
        const zone = String(b.zone || 'OM1').toUpperCase();
        if (zone !== 'OM1' && zone !== 'OM2') {
            return res.status(400).json({ error: 'Zone invalide (OM1 ou OM2).' });
        }
        const prixPieceEur = Number(b.prixPieceEur);
        if (!Number.isFinite(prixPieceEur) || prixPieceEur < 0) {
            return res.status(400).json({ error: 'Prix pièce invalide.' });
        }

        // Un poids saisi explicitement prime (simulation « et si »).
        const result = await pricing.quote({
            prixPieceEur,
            portVendeurEur: b.portVendeurEur != null ? Number(b.portVendeurEur) : null,
            valeurDeclareeEur: b.valeurDeclareeEur != null ? Number(b.valeurDeclareeEur) : undefined,
            zone: zone as 'OM1' | 'OM2',
            poidsVendeurKg: b.poidsKg != null ? Number(b.poidsKg) : null,
            categoryCode: b.categoryCode || null,
            titre: b.titre || null,
            assurance: b.assurance === 'AD_VALOREM' ? 'AD_VALOREM' : 'STANDARD',
            colisNonAnnonce: !!b.colisNonAnnonce,
            consolidation: !!b.consolidation,
            // Simulation sur un article isolé : l'appel IA est acceptable ici.
            allowAi: b.allowAi === true,
        });

        res.json(result);
    } catch (e: any) {
        console.error('[admin] simulate:', e.message);
        res.status(500).json({ error: e.message || 'Erreur de simulation.' });
    }
});

/** GET /api/admin/pricing/categories — référentiel des catégories (poids de référence). */
router.get('/pricing/categories', async (_req: express.Request, res: express.Response) => {
    try {
        const categories = await prisma.partCategory.findMany({ orderBy: { labelFr: 'asc' } });
        res.json({ categories });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors du chargement des catégories.' });
    }
});

/**
 * GET /api/admin/pricing/classifications — classifications IA à revoir.
 * ?all=1 pour tout voir (par défaut : uniquement celles en attente).
 */
router.get('/pricing/classifications', async (req: express.Request, res: express.Response) => {
    try {
        const all = req.query.all === '1';
        const rows = await prisma.aiClassification.findMany({
            where: all ? {} : { valideParOperateur: false },
            include: { category: true },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json({
            classifications: rows.map((c) => ({
                id: c.id,
                titre: c.titreOrigine || c.titreNormalise,
                categoryCode: c.category?.code ?? null,
                categoryLabel: c.category?.labelFr ?? null,
                poidsUnitaireKg: c.category ? Number(c.category.poidsKg) : null,
                quantite: c.quantite,
                poidsEstimeKg: c.poidsEstimeKg != null ? Number(c.poidsEstimeKg) : null,
                confiance: Number(c.confiance),
                valideParOperateur: c.valideParOperateur,
                createdAt: c.createdAt,
            })),
        });
    } catch (e: any) {
        console.error('[admin] classifications:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement des classifications.' });
    }
});

/**
 * PATCH /api/admin/pricing/classifications/:id — valider ou corriger.
 * body: { categoryCode?, quantite?, valider? }
 * Corriger met à jour le cache : les prochains devis utiliseront la valeur validée.
 */
router.patch('/pricing/classifications/:id', async (req: express.Request, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const { categoryCode, quantite, valider } = req.body || {};

        const existing = await prisma.aiClassification.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Classification introuvable.' });

        let categoryId = existing.categoryId;
        let poidsUnitaire: number | null = null;
        if (categoryCode) {
            const cat = await prisma.partCategory.findUnique({ where: { code: String(categoryCode) } });
            if (!cat) return res.status(400).json({ error: 'Catégorie inconnue.' });
            categoryId = cat.id;
            poidsUnitaire = Number(cat.poidsKg);
        } else if (categoryId) {
            const cat = await prisma.partCategory.findUnique({ where: { id: categoryId } });
            poidsUnitaire = cat ? Number(cat.poidsKg) : null;
        }

        const qte = quantite != null ? Math.max(1, Math.round(Number(quantite))) : existing.quantite;

        const updated = await prisma.aiClassification.update({
            where: { id },
            data: {
                categoryId,
                quantite: qte,
                poidsEstimeKg: poidsUnitaire != null ? poidsUnitaire * qte : null,
                // Une correction opérateur vaut validation : le poids devient fiable
                // et le devis passera en régime FERME.
                valideParOperateur: valider !== false,
            },
            include: { category: true },
        });

        res.json({
            classification: {
                id: updated.id,
                categoryCode: updated.category?.code ?? null,
                quantite: updated.quantite,
                poidsEstimeKg: updated.poidsEstimeKg != null ? Number(updated.poidsEstimeKg) : null,
                valideParOperateur: updated.valideParOperateur,
            },
        });
    } catch (e: any) {
        console.error('[admin] classification patch:', e.message);
        res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
    }
});

/** GET /api/admin/pricing/settings — paramètres de tarification. */
router.get('/pricing/settings', async (_req: express.Request, res: express.Response) => {
    try {
        const settings = await prisma.pricingSetting.findMany({ orderBy: { key: 'asc' } });
        res.json({ settings });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors du chargement des paramètres.' });
    }
});

/**
 * PATCH /api/admin/pricing/settings/:key — modifie un paramètre + journalise.
 * body: { value }
 */
router.patch('/pricing/settings/:key', async (req: AuthedRequest, res: express.Response) => {
    try {
        const key = String(req.params.key);
        const value = String(req.body?.value ?? '').trim();
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
            return res.status(400).json({ error: 'Valeur invalide (nombre positif attendu).' });
        }
        // Bornes de sécurité : évite une marge à 0 % ou une saisie aberrante.
        const BORNES: Record<string, [number, number]> = {
            marge_pourcent: [0, 200],
            marge_minimum_eur: [0, 1000],
            marge_securite_port_pourcent: [0, 100],
            seuil_ecart_tranches: [1, 10],
        };
        const b = BORNES[key];
        if (b && (num < b[0] || num > b[1])) {
            return res.status(400).json({ error: `Valeur hors bornes pour ${key} (${b[0]}–${b[1]}).` });
        }

        const existing = await prisma.pricingSetting.findUnique({ where: { key } });
        if (!existing) return res.status(404).json({ error: 'Paramètre inconnu.' });

        const [updated] = await prisma.$transaction([
            prisma.pricingSetting.update({ where: { key }, data: { value } }),
            prisma.pricingSettingLog.create({
                data: { key, oldValue: existing.value, newValue: value, userId: req.user!.userId },
            }),
        ]);
        pricing.invalidateSettingsCache();
        res.json({ setting: updated });
    } catch (e: any) {
        console.error('[admin] settings patch:', e.message);
        res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
    }
});

/** POST /api/admin/pricing/colissimo/refresh — déclenche le contrôle/rafraîchissement à la demande. */
router.post('/pricing/colissimo/refresh', async (_req: AuthedRequest, res: express.Response) => {
    try {
        await refreshColissimoRates();
        const freshness = await checkGridFreshness();
        res.json({ ok: true, freshness });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/* ── Casses professionnelles (whitelist vendeurs) ─────────────────── */

/** GET /api/admin/sellers — liste des vendeurs ciblés. */
router.get('/sellers', async (_req: express.Request, res: express.Response) => {
    try {
        const sellers = await prisma.supplierSeller.findMany({
            orderBy: [{ actif: 'desc' }, { priorite: 'desc' }, { id: 'asc' }],
        });
        res.json({ sellers });
    } catch (e: any) {
        console.error('[admin] sellers:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement des vendeurs.' });
    }
});

/** POST /api/admin/sellers — ajoute une casse à cibler. */
router.post('/sellers', async (req: express.Request, res: express.Response) => {
    try {
        const sellerUsername = String(req.body?.sellerUsername || '').trim();
        const labelInterne = String(req.body?.labelInterne || '').trim();
        if (!sellerUsername) return res.status(400).json({ error: 'Nom du vendeur requis.' });
        if (!labelInterne) return res.status(400).json({ error: 'Libellé interne requis.' });

        const seller = await prisma.supplierSeller.create({
            data: {
                supplierCode: String(req.body?.supplierCode || 'EBAY'),
                sellerUsername,
                labelInterne,
                pays: req.body?.pays ? String(req.body.pays).toUpperCase().slice(0, 2) : null,
                priorite: Number(req.body?.priorite) || 0,
                fiabiliteScore: req.body?.fiabiliteScore != null ? Number(req.body.fiabiliteScore) : 1.0,
                notes: req.body?.notes ? String(req.body.notes) : null,
                actif: req.body?.actif !== false,
            },
        });
        invalidateSellersCache();
        res.status(201).json({ seller });
    } catch (e: any) {
        if (e.code === 'P2002') return res.status(409).json({ error: 'Ce vendeur est déjà dans la liste.' });
        console.error('[admin] create seller:', e.message);
        res.status(500).json({ error: 'Erreur lors de l\'ajout.' });
    }
});

/** PATCH /api/admin/sellers/:id — activation, priorité, fiabilité, notes. */
router.patch('/sellers/:id', async (req: express.Request, res: express.Response) => {
    try {
        const data: any = {};
        if (req.body?.actif !== undefined) data.actif = !!req.body.actif;
        if (req.body?.priorite !== undefined) data.priorite = Number(req.body.priorite) || 0;
        if (req.body?.fiabiliteScore !== undefined) data.fiabiliteScore = Number(req.body.fiabiliteScore);
        if (req.body?.labelInterne !== undefined) data.labelInterne = String(req.body.labelInterne);
        if (req.body?.notes !== undefined) data.notes = String(req.body.notes || '') || null;

        const seller = await prisma.supplierSeller.update({
            where: { id: Number(req.params.id) }, data,
        });
        invalidateSellersCache();
        res.json({ seller });
    } catch (e: any) {
        console.error('[admin] update seller:', e.message);
        res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
    }
});

/** DELETE /api/admin/sellers/:id */
router.delete('/sellers/:id', async (req: express.Request, res: express.Response) => {
    try {
        await prisma.supplierSeller.delete({ where: { id: Number(req.params.id) } });
        invalidateSellersCache();
        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }
});

/**
 * POST /api/admin/sellers/:id/verify — contrôle que le vendeur existe.
 * Un nom erroné est ACCEPTÉ par l'API et renvoie simplement 0 résultat : la
 * casse serait « configurée » sans jamais être interrogée, sans aucune erreur.
 */
router.post('/sellers/:id/verify', async (req: express.Request, res: express.Response) => {
    try {
        const r = await verifierVendeur(Number(req.params.id), req.body?.marketplaceId);
        res.json(r);
    } catch (e: any) {
        console.error('[admin] verify seller:', e.message);
        res.status(500).json({ error: e.message || 'Vérification impossible.' });
    }
});

/* ── Glossaire : enrichissement par la pratique ───────────────────── */

/** GET /api/admin/glossaire — termes inconnus les plus fréquents. */
router.get('/glossaire', async (_req: express.Request, res: express.Response) => {
    try {
        const [liste, stats] = await Promise.all([candidats(40), statistiques()]);
        res.json({ candidats: liste, stats });
    } catch (e: any) {
        console.error('[admin] glossaire:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement du glossaire.' });
    }
});

/**
 * POST /api/admin/glossaire/:id/proposer — fait proposer les traductions
 * par DeepL. L'opérateur les corrige avant validation : la proposition n'est
 * qu'un point de départ, elle n'entre jamais seule dans le glossaire.
 */
router.post('/glossaire/:id/proposer', async (req: express.Request, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const terme = await prisma.glossaryTerm.findUnique({ where: { id } });
        if (!terme) return res.status(404).json({ error: 'Terme introuvable.' });

        // D'abord vers le français (c'est la clé du glossaire), puis du
        // français vers les autres langues, pour rester cohérent avec la
        // façon dont les requêtes de recherche sont construites.
        const versFr = await traduireVers(terme.terme, ['FR']);
        const labelFr = versFr.fr;
        if (!labelFr) {
            return res.status(503).json({ error: 'Traduction indisponible (DEEPL_API_KEY absente ou quota atteint).' });
        }
        const autres = await traduireVers(labelFr, ['DE', 'ES', 'IT', 'EN']);

        const maj = await prisma.glossaryTerm.update({
            where: { id },
            data: {
                labelFr,
                de: autres.de || null,
                es: autres.es || null,
                it: autres.it || null,
                en: autres.en || null,
            },
        });
        res.json({ terme: maj });
    } catch (e: any) {
        console.error('[admin] proposer terme:', e.message);
        res.status(500).json({ error: 'Erreur lors de la proposition.' });
    }
});

/**
 * PATCH /api/admin/glossaire/:id — corrige et/ou valide un terme.
 * La validation recharge le glossaire à chaud : effet immédiat sur
 * l'affichage ET sur les requêtes envoyées aux marchés étrangers.
 */
router.patch('/glossaire/:id', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const data: any = {};
        for (const champ of ['labelFr', 'de', 'es', 'it', 'en']) {
            if (req.body?.[champ] !== undefined) data[champ] = String(req.body[champ] || '').trim() || null;
        }
        if (req.body?.statut) {
            const s = String(req.body.statut).toUpperCase();
            if (!['CANDIDAT', 'VALIDE', 'REJETE'].includes(s)) {
                return res.status(400).json({ error: 'Statut invalide.' });
            }
            data.statut = s;
            if (s === 'VALIDE') {
                data.valideLe = new Date();
                data.valideParId = req.user?.userId ?? null;
            }
        }

        const terme = await prisma.glossaryTerm.update({ where: { id }, data });

        // Une entrée validée doit être complète : incomplète, elle
        // n'améliorerait que l'affichage et pas la recherche.
        if (terme.statut === 'VALIDE'
            && !(terme.labelFr && terme.de && terme.es && terme.it && terme.en)) {
            await prisma.glossaryTerm.update({ where: { id }, data: { statut: 'CANDIDAT' } });
            return res.status(400).json({
                error: 'Validation refusée : les cinq langues doivent être renseignées '
                    + '(le glossaire construit aussi les requêtes envoyées aux marchés étrangers).',
            });
        }

        chargerTermesAppris(await termesValides());
        res.json({ terme });
    } catch (e: any) {
        console.error('[admin] valider terme:', e.message);
        res.status(500).json({ error: 'Erreur lors de la validation.' });
    }
});

export default router;
