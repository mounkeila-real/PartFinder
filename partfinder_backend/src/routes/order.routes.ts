import express from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../services/auth.service';
import { requireAuth, AuthedRequest } from '../middleware/auth.middleware';

const router = express.Router();
const prisma = new PrismaClient();

// Lit un userId depuis un token Bearer optionnel (commande liée au compte si connecté).
function optionalUserId(req: express.Request): number | null {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;
    try {
        return AuthService.verifyToken(token).userId;
    } catch {
        return null;
    }
}

// Receive an order from the frontend cart
router.post('/', async (req: express.Request, res: express.Response) => {
    try {
        const { contactInfo, items, shippingAddress } = req.body;
        // Items should be an array of: { partOem, partName, quantity, priceSold }

        if (!items || items.length === 0) {
            return res.status(400).json({ error: "Order must contain items" });
        }

        const userId = optionalUserId(req);
        const totalAmount = items.reduce((sum: number, item: any) => sum + (item.priceSold * item.quantity), 0);

        // Save order and order items in a transaction using Prisma
        const order = await prisma.order.create({
            data: {
                contactInfo,
                totalAmount,
                userId: userId ?? undefined,
                shippingAddress: shippingAddress ?? undefined,
                items: {
                    create: items.map((i: any) => ({
                        partOem: i.partOem,
                        partName: i.partName,
                        quantity: i.quantity,
                        priceSold: i.priceSold
                    }))
                }
            },
            include: {
                items: true
            }
        });

        res.status(201).json({ message: "Order successfully placed for processing.", order });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/orders/mine — commandes du compte connecté (récentes d'abord).
 * "En cours" = statut != DELIVERED/CANCELLED ; l'historique complet est renvoyé,
 * le tri par statut se fait côté client.
 */
router.get('/mine', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const orders = await prisma.order.findMany({
            where: { userId: req.user!.userId },
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json({ orders });
    } catch (error: any) {
        console.error('[orders] mine:', error.message);
        res.status(500).json({ error: 'Erreur lors du chargement des commandes.' });
    }
});

export default router;
