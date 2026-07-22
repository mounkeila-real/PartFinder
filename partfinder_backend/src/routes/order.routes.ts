import express from 'express';
import { AuthService } from '../services/auth.service';
import { requireAuth, AuthedRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';

const router = express.Router();

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

/**
 * GET /api/orders/my-addresses — adresses enregistrées du client.
 * Évite de ressaisir une adresse outre-mer complète à chaque commande.
 */
router.get('/my-addresses', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const addresses = await prisma.address.findMany({
            where: { userId: req.user!.userId },
            orderBy: [{ parDefaut: 'desc' }, { createdAt: 'desc' }],
            take: 10,
        });
        res.json({ addresses });
    } catch (e: any) {
        console.error('[orders] my-addresses:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement des adresses.' });
    }
});

/**
 * GET /api/orders/my-parcels — suivi des colis du client connecté.
 * Vue neutre : étapes entrepôt et expédition, jamais la provenance des pièces.
 */
router.get('/my-parcels', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const userId = req.user!.userId;
        const [parcels, shipments] = await Promise.all([
            prisma.inboundParcel.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 50,
            }),
            prisma.outboundShipment.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 50,
            }),
        ]);

        res.json({
            // On n'expose ni notes internes ni identifiants de suivi entrants
            // (ils désignent l'acheminement fournisseur).
            parcels: parcels.map((p) => ({
                id: p.id,
                orderId: p.orderId,
                etape: p.statut,
                poidsKg: p.poidsReelKg != null ? Number(p.poidsReelKg) : null,
                photos: Array.isArray(p.photos) ? p.photos : [],
                recuLe: p.receivedAt,
                peseLe: p.weighedAt,
            })),
            shipments: shipments.map((s) => ({
                id: s.id,
                orderId: s.orderId,
                statut: s.statut,
                poidsKg: s.poidsFactureKg != null ? Number(s.poidsFactureKg) : null,
                tracking: s.trackingColissimo,
                expedieLe: s.shippedAt,
            })),
        });
    } catch (e: any) {
        console.error('[orders] my-parcels:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement du suivi.' });
    }
});

export default router;
