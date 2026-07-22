import express from 'express';
import Stripe from 'stripe';
import { requireAuth, AuthedRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';

/**
 * Appels de fonds — côté CLIENT (requireAuth).
 * Le client voit ses paiements en attente avec le justificatif (motif chiffré
 * + photos du colis), paie via Stripe, ou refuse un écart de poids (la
 * commande passe alors en litige : jamais de blocage silencieux).
 */

const router = express.Router();
router.use(requireAuth);

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

const MOTIF_FR: Record<string, string> = {
    ECART_POIDS: 'Complément d\'acheminement (écart de poids)',
    STOCKAGE: 'Frais de stockage',
    SUPPLEMENT: 'Supplément',
    AUTRE: 'Complément',
};

/** GET /api/payment-requests/mine — appels de fonds du client (avec justificatifs). */
router.get('/mine', async (req: AuthedRequest, res: express.Response) => {
    try {
        const userId = req.user!.userId;
        const requests = await prisma.paymentRequest.findMany({
            where: { userId },
            orderBy: [{ statut: 'asc' }, { createdAt: 'desc' }], // PENDING avant PAID (ordre alpha utile ici)
            take: 50,
        });

        // Justificatif visuel : photos des colis pesés liés aux commandes concernées.
        const orderIds = [...new Set(requests.map((r) => r.orderId).filter(Boolean))] as number[];
        const parcels = orderIds.length
            ? await prisma.inboundParcel.findMany({
                where: { orderId: { in: orderIds }, weighedAt: { not: null } },
                select: { orderId: true, photos: true, poidsReelKg: true },
            })
            : [];

        res.json({
            requests: requests.map((r) => {
                const parcel = parcels.find((p) => p.orderId === r.orderId);
                return {
                    id: r.id,
                    orderId: r.orderId,
                    motif: r.motif,
                    motifLabel: MOTIF_FR[r.motif] || r.motif,
                    montantEur: Number(r.montantEur),
                    detail: r.detail,
                    statut: r.statut,
                    lienPaiement: r.lienPaiement,
                    createdAt: r.createdAt,
                    paidAt: r.paidAt,
                    photos: parcel && Array.isArray(parcel.photos) ? parcel.photos : [],
                    poidsReelKg: parcel?.poidsReelKg != null ? Number(parcel.poidsReelKg) : null,
                    refusable: r.motif === 'ECART_POIDS' && r.statut === 'PENDING',
                };
            }),
        });
    } catch (e: any) {
        console.error('[payment-requests] mine:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement des paiements.' });
    }
});

/**
 * POST /api/payment-requests/:id/pay — renvoie le lien de paiement, en le
 * créant si nécessaire (les appels STOCKAGE générés par le cron n'en ont pas,
 * et le montant peut avoir évolué depuis la création du lien initial).
 */
router.post('/:id/pay', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { user: true } });
        if (!pr || pr.userId !== req.user!.userId) return res.status(404).json({ error: 'Paiement introuvable.' });
        if (pr.statut !== 'PENDING') return res.status(400).json({ error: 'Ce paiement n\'est plus en attente.' });
        if (!stripe) return res.status(503).json({ error: 'Paiement non configuré.' });

        const montant = Number(pr.montantEur);
        if (!(montant > 0)) return res.status(400).json({ error: 'Montant invalide.' });

        const base = process.env.FRONTEND_URL
            || (req.headers.origin as string)
            || 'https://partfinder-production.up.railway.app';

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: 'eur',
                    unit_amount: Math.round(montant * 100),
                    product_data: {
                        name: `${MOTIF_FR[pr.motif] || 'Complément'}${pr.orderId ? ` — commande #${pr.orderId}` : ''}`,
                    },
                },
            }],
            success_url: `${base}/?paid=1&pr=${pr.id}`,
            cancel_url: `${base}/?canceled=1&pr=${pr.id}`,
            metadata: { paymentRequestId: String(pr.id) },
            customer_email: pr.user?.email || undefined,
        });

        await prisma.paymentRequest.update({
            where: { id },
            data: { lienPaiement: session.url, stripeSessionId: session.id },
        });

        res.json({ url: session.url });
    } catch (e: any) {
        console.error('[payment-requests] pay:', e.message);
        res.status(500).json({ error: 'Erreur lors de la création du paiement.' });
    }
});

/**
 * POST /api/payment-requests/:id/refuse — refus d'un écart de poids.
 * La commande passe en LITIGE (ISSUE) pour traitement manuel : retour ou
 * remboursement partiel. Jamais de blocage silencieux.
 */
router.post('/:id/refuse', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const pr = await prisma.paymentRequest.findUnique({ where: { id } });
        if (!pr || pr.userId !== req.user!.userId) return res.status(404).json({ error: 'Paiement introuvable.' });
        if (pr.statut !== 'PENDING') return res.status(400).json({ error: 'Ce paiement n\'est plus en attente.' });
        if (pr.motif !== 'ECART_POIDS') {
            return res.status(400).json({ error: 'Seul un complément d\'écart de poids peut être contesté.' });
        }

        await prisma.$transaction(async (tx) => {
            await tx.paymentRequest.update({ where: { id }, data: { statut: 'REFUSED' } });
            if (pr.orderId) {
                await tx.order.update({ where: { id: pr.orderId }, data: { status: 'ISSUE' } });
            }
        });

        console.log('[payment-requests] refus #', id, '-> commande', pr.orderId, 'en litige');
        res.json({
            ok: true,
            message: 'Votre refus est enregistré. Notre équipe vous contacte pour trouver une solution (retour ou remboursement partiel).',
        });
    } catch (e: any) {
        console.error('[payment-requests] refuse:', e.message);
        res.status(500).json({ error: 'Erreur lors de l\'enregistrement du refus.' });
    }
});

export default router;
