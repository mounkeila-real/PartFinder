import express from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../services/auth.service';
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

export default router;
