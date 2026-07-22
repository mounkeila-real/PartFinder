import express from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth.middleware';
import { verifyOffer } from '../services/offer_token';
import { validerAdresse, formatAdresse } from '../services/territoires';

/**
 * Extrait le coût d'acquisition d'un article depuis son jeton d'offre signé.
 *
 * On ne lit JAMAIS sourcePriceEur & co depuis le corps de la requête : ces
 * champs venaient du navigateur, donc falsifiables (un client pouvait truquer
 * son coût d'acquisition et fausser la validation opérateur). Signature
 * invalide ou jeton absent → coûts null + note, la commande passe quand même
 * (l'opérateur vérifie à la main en validation).
 */
function costsFromToken(item: any): {
    sourcePriceEur: number | null;
    sourceShippingEur: number | null;
    sourceShippingType: string | null;
    note: string | null;
} {
    const v = verifyOffer(item?.offerToken);
    if (!v.ok) {
        return {
            sourcePriceEur: null, sourceShippingEur: null, sourceShippingType: null,
            note: 'COUT NON VERIFIE (jeton absent ou altéré) — contrôler le coût d\'acquisition.',
        };
    }
    return {
        sourcePriceEur: v.data.sourcePriceEur,
        sourceShippingEur: v.data.sourceShippingEur,
        sourceShippingType: v.data.sourceShippingType,
        note: v.expired ? 'Jeton d\'offre expiré (>72 h) — revérifier le prix fournisseur.' : null,
    };
}

/**
 * Tunnel d'achat — Stripe Checkout (page de paiement hébergée par Stripe).
 * Le client paie sur Stripe ; le paiement est confirmé côté serveur via webhook.
 *
 * Variables d'environnement (Railway backend) :
 *   STRIPE_SECRET_KEY      : clé secrète Stripe (sk_...)
 *   STRIPE_WEBHOOK_SECRET  : secret de signature du webhook (whsec_...)
 *   FRONTEND_URL           : base des URLs de retour (sinon origin de la requête)
 */

const router = express.Router();
const prisma = new PrismaClient();

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

function frontendBase(req: express.Request): string {
    return process.env.FRONTEND_URL
        || (req.headers.origin as string)
        || 'https://partfinder-production.up.railway.app';
}

/**
 * POST /api/checkout/session — crée la commande (UNPAID) + une session Stripe,
 * renvoie l'URL de paiement. body: { items, shippingAddress?, poReference? }
 */
router.post('/session', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        if (!stripe) return res.status(503).json({ error: 'Paiement non configuré (STRIPE_SECRET_KEY manquant).' });

        const { items, shippingAddress, poReference } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Panier vide.' });
        }

        const totalAmount = items.reduce((s: number, i: any) => s + Number(i.priceSold) * Number(i.quantity || 1), 0);

        const order = await prisma.order.create({
            data: {
                userId: req.user!.userId,
                totalAmount,
                status: 'PENDING',
                paymentStatus: 'UNPAID',
                shippingAddress: shippingAddress ? String(shippingAddress) : null,
                poReference: poReference ? String(poReference) : null,
                items: {
                    create: items.map((i: any) => ({
                        partOem: i.partOem || '—',
                        partName: i.partName,
                        quantity: Number(i.quantity) || 1,
                        priceSold: Number(i.priceSold),
                    })),
                },
            },
        });

        const base = frontendBase(req);
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: items.map((i: any) => ({
                quantity: Number(i.quantity) || 1,
                price_data: {
                    currency: 'eur',
                    unit_amount: Math.round(Number(i.priceSold) * 100),
                    product_data: {
                        name: String(i.partName).slice(0, 250),
                        metadata: { oem: i.partOem || '' },
                    },
                },
            })),
            success_url: `${base}/?paid=1&order=${order.id}`,
            cancel_url: `${base}/?canceled=1&order=${order.id}`,
            client_reference_id: String(order.id),
            metadata: { orderId: String(order.id) },
        });

        await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });
        res.json({ url: session.url, orderId: order.id });
    } catch (e: any) {
        console.error('[checkout] session:', e.message);
        res.status(500).json({ error: 'Erreur lors de la création du paiement.' });
    }
});

/**
 * POST /api/checkout/request — DEMANDE de commande (pas de paiement immédiat).
 *
 * Tant que le poids réel et le port d'acheminement ne sont pas connus, le prix
 * définitif ne peut pas être arrêté : la commande part en PENDING_VALIDATION.
 * Un opérateur ajuste le prix puis envoie la demande de paiement (Stripe).
 * body: { items, shippingAddress, poReference? }
 */
router.post('/request', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const { items, address, poReference } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Panier vide.' });
        }

        // Adresse STRUCTURÉE : la zone (OM1/OM2) commande tout le tarif
        // d'acheminement, elle est donc dérivée du territoire côté serveur.
        const v = validerAdresse(address);
        if (!v.ok || !v.valeur) {
            return res.status(400).json({ error: v.erreurs.join(' '), erreurs: v.erreurs });
        }
        const adr = v.valeur;

        // Montant indicatif (prix des pièces) — ne comprend pas encore l'acheminement.
        const estimatedAmount = items.reduce(
            (s: number, i: any) => s + Number(i.priceSold) * Number(i.quantity || 1), 0);

        // Coûts d'acquisition extraits des jetons signés (jamais du corps client).
        const costs = items.map((i: any) => costsFromToken(i));
        const notes = costs.map((c, idx) => c.note ? `Article ${idx + 1}: ${c.note}` : null).filter(Boolean);

        // Enregistre l'adresse : c'est elle qui portera la ZONE pour tout
        // l'aval (pesée, calcul du port, expédition, CN23). Sans cet
        // enregistrement, l'entrepôt retombait systématiquement sur OM1 —
        // un client de Nouvelle-Calédonie aurait été facturé au tarif Antilles.
        const userId = req.user!.userId;
        const dejaVue = await prisma.address.findFirst({
            where: {
                userId, ligne1: adr.ligne1, codePostal: adr.codePostal,
                ville: adr.ville, territoire: adr.territoire,
            },
        });
        const adresse = dejaVue
            ? await prisma.address.update({
                where: { id: dejaVue.id },
                data: {
                    destinataire: adr.destinataire, ligne2: adr.ligne2,
                    telephone: adr.telephone, zone: adr.zone, parDefaut: true,
                },
            })
            : await prisma.address.create({
                data: {
                    userId,
                    destinataire: adr.destinataire,
                    ligne1: adr.ligne1,
                    ligne2: adr.ligne2,
                    codePostal: adr.codePostal,
                    ville: adr.ville,
                    territoire: adr.territoire,
                    zone: adr.zone,
                    telephone: adr.telephone,
                    parDefaut: true,
                },
            });
        // Une seule adresse par défaut : sinon zoneOf() pourrait retenir l'ancienne.
        await prisma.address.updateMany({
            where: { userId, id: { not: adresse.id } },
            data: { parDefaut: false },
        });

        const order = await prisma.order.create({
            data: {
                userId,
                totalAmount: estimatedAmount,
                status: 'PENDING_VALIDATION',
                paymentStatus: 'UNPAID',
                shippingAddress: formatAdresse(adr),
                poReference: poReference ? String(poReference) : null,
                adminNote: notes.length ? notes.join(' | ') : null,
                items: {
                    create: items.map((i: any, idx: number) => ({
                        partOem: i.partOem || '—',
                        partName: i.partName,
                        quantity: Number(i.quantity) || 1,
                        priceSold: Number(i.priceSold),
                        // Coût d'acquisition conservé pour la validation opérateur (interne).
                        sourcePriceEur: costs[idx].sourcePriceEur,
                        sourceShippingEur: costs[idx].sourceShippingEur,
                        sourceShippingType: costs[idx].sourceShippingType,
                    })),
                },
            },
            include: { items: true },
        });

        console.log('[checkout] demande a valider #', order.id, '— zone', adr.zone);
        res.status(201).json({ orderId: order.id, status: order.status, zone: adr.zone });
    } catch (e: any) {
        console.error('[checkout] request:', e.message);
        res.status(500).json({ error: 'Erreur lors de l\'envoi de la demande.' });
    }
});

/**
 * Webhook Stripe — corps BRUT requis (monté avec express.raw dans index.ts,
 * AVANT express.json). Confirme le paiement et passe la commande en PAID/CONFIRMED.
 */
export async function stripeWebhookHandler(req: express.Request, res: express.Response) {
    if (!stripe) return res.status(503).end();

    const sig = req.headers['stripe-signature'] as string;
    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    let event: Stripe.Event;
    try {
        event = secret
            ? stripe.webhooks.constructEvent(req.body, sig, secret)
            : JSON.parse((req.body as Buffer).toString()); // fallback si secret non configuré (dev)
    } catch (e: any) {
        console.error('[checkout] webhook signature:', e.message);
        return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;

        // Cas 1 : appel de fonds (écart de poids, stockage, supplément).
        const paymentRequestId = Number(session.metadata?.paymentRequestId);
        if (paymentRequestId) {
            try {
                const pr = await prisma.paymentRequest.update({
                    where: { id: paymentRequestId },
                    data: { statut: 'PAID', paidAt: new Date() },
                });
                console.log('[checkout] appel de fonds payé #', paymentRequestId);

                // Si plus AUCUN paiement en attente sur cette commande, elle
                // redevient expédiable.
                if (pr.orderId) {
                    const encore = await prisma.paymentRequest.count({
                        where: { orderId: pr.orderId, statut: 'PENDING' },
                    });
                    if (encore === 0) {
                        await prisma.order.updateMany({
                            where: { id: pr.orderId, status: 'PENDING_ADDITIONAL_PAYMENT' },
                            data: { status: 'READY_TO_SHIP' },
                        });
                        console.log('[checkout] commande #', pr.orderId, 'débloquée -> READY_TO_SHIP');
                    }
                }
            } catch (e: any) {
                console.error('[checkout] webhook payment-request:', e.message);
            }
            return res.json({ received: true });
        }

        // Cas 2 : paiement d'une commande.
        const orderId = Number(session.metadata?.orderId || session.client_reference_id);
        if (orderId) {
            try {
                await prisma.order.update({
                    where: { id: orderId },
                    data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
                });
                console.log('[checkout] commande payée #', orderId);
            } catch (e: any) {
                console.error('[checkout] webhook update:', e.message);
            }
        }
    }

    res.json({ received: true });
}

export default router;
