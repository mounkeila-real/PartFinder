import express from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../services/auth.service';
import { EmailService } from '../services/email.service';
import { requireAdmin, AuthedRequest } from '../middleware/auth.middleware';

/**
 * Administration (Phase 3) — toutes les routes exigent le rôle ADMIN.
 * Gestion des clients (liste, suspension, suppression RGPD, reset password)
 * et des commandes (liste globale, changement de statut).
 */

const router = express.Router();
const prisma = new PrismaClient();

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

export default router;
