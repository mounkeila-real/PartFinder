import express from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { requireAdmin, AuthedRequest } from '../middleware/auth.middleware';
import { EmailService } from '../services/email.service';
import * as pricing from '../services/pricing';
import {
    activeLabelProvider, buildCn23, DEFAULT_CODE_SH,
    type Cn23Line,
} from '../services/label.service';

/**
 * Parcours entrepôt — réception, pesée, écarts, consolidation.
 * Toutes les routes exigent le rôle ADMIN (usage opérateur).
 *
 * Règle d'or : aucune expédition tant qu'un appel de fonds lié est PENDING.
 */

const router = express.Router();
const prisma = new PrismaClient();
router.use(requireAdmin);

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

/** Zone du client : adresse par défaut si elle existe, sinon OM1. */
async function zoneOf(userId: number): Promise<'OM1' | 'OM2'> {
    const addr = await prisma.address.findFirst({
        where: { userId },
        orderBy: [{ parDefaut: 'desc' }, { createdAt: 'desc' }],
    });
    return addr?.zone === 'OM2' ? 'OM2' : 'OM1';
}

/** Poids estimé d'une commande (somme des lignes), 0 si inconnu. */
function estimatedWeightOf(order: any): number {
    if (!order?.items?.length) return 0;
    return order.items.reduce((s: number, i: any) => {
        const p = i.poidsEstimeKg != null ? Number(i.poidsEstimeKg) : 0;
        return s + p * (i.quantity || 1);
    }, 0);
}

/* ── Liste & recherche ───────────────────────────────────────────── */

/** GET /api/warehouse/parcels?statut=EXPECTED&q=... */
router.get('/parcels', async (req: express.Request, res: express.Response) => {
    try {
        const statut = req.query.statut ? String(req.query.statut) : undefined;
        const q = req.query.q ? String(req.query.q).trim() : '';

        const parcels = await prisma.inboundParcel.findMany({
            where: {
                ...(statut ? { statut } : {}),
                ...(q
                    ? {
                        OR: [
                            { trackingNumber: { contains: q, mode: 'insensitive' } },
                            { user: { companyName: { contains: q, mode: 'insensitive' } } },
                            { user: { email: { contains: q, mode: 'insensitive' } } },
                        ],
                    }
                    : {}),
            },
            include: {
                user: { select: { id: true, companyName: true, email: true } },
                order: { select: { id: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json({ parcels });
    } catch (e: any) {
        console.error('[warehouse] parcels:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement des colis.' });
    }
});

/** POST /api/warehouse/parcels — pré-annonce d'un colis attendu. */
router.post('/parcels', async (req: express.Request, res: express.Response) => {
    try {
        const { userId, orderId, trackingNumber, transporteur, notesOperateur } = req.body || {};
        if (!userId) return res.status(400).json({ error: 'Client requis.' });
        const parcel = await prisma.inboundParcel.create({
            data: {
                userId: Number(userId),
                orderId: orderId ? Number(orderId) : null,
                trackingNumber: trackingNumber ? String(trackingNumber).trim() : null,
                transporteur: transporteur ? String(transporteur) : null,
                notesOperateur: notesOperateur ? String(notesOperateur) : null,
                statut: 'EXPECTED',
                annonce: true,
            },
        });
        res.status(201).json({ parcel });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors de la pré-annonce.' });
    }
});

/* ── Réception ───────────────────────────────────────────────────── */

/**
 * POST /api/warehouse/receive — body { tracking, userId? }
 * Rapproche le colis d'une pré-annonce. Sans correspondance, crée un
 * « colis non annoncé » (supplément appliqué) : il faut alors un client.
 */
router.post('/receive', async (req: express.Request, res: express.Response) => {
    try {
        const tracking = String(req.body?.tracking || '').trim();
        if (!tracking) return res.status(400).json({ error: 'Numéro de suivi requis.' });

        const existing = await prisma.inboundParcel.findFirst({
            where: { trackingNumber: tracking, statut: 'EXPECTED' },
            include: { user: { select: { id: true, companyName: true, email: true } } },
        });

        if (existing) {
            const parcel = await prisma.inboundParcel.update({
                where: { id: existing.id },
                data: { statut: 'RECEIVED', receivedAt: new Date() },
                include: { user: { select: { id: true, companyName: true, email: true } } },
            });
            return res.json({ parcel, nonAnnonce: false });
        }

        // Aucune pré-annonce : il faut rattacher le colis à un client.
        const userId = req.body?.userId ? Number(req.body.userId) : null;
        if (!userId) {
            return res.status(404).json({
                error: 'Aucun colis attendu avec ce suivi. Sélectionnez le client pour l\'enregistrer comme colis non annoncé.',
                needsClient: true,
            });
        }

        const parcel = await prisma.inboundParcel.create({
            data: {
                userId,
                trackingNumber: tracking,
                statut: 'RECEIVED',
                receivedAt: new Date(),
                annonce: false, // -> supplément colis non annoncé
            },
            include: { user: { select: { id: true, companyName: true, email: true } } },
        });
        res.status(201).json({ parcel, nonAnnonce: true });
    } catch (e: any) {
        console.error('[warehouse] receive:', e.message);
        res.status(500).json({ error: 'Erreur lors de la réception.' });
    }
});

/* ── Pesée & contrôle ────────────────────────────────────────────── */

/**
 * POST /api/warehouse/parcels/:id/weigh
 * body: { poidsReelKg, longueurCm?, largeurCm?, hauteurCm?, photos: string[], notes? }
 *
 * Applique la logique d'écart :
 *  - écart < seuil            -> absorbé, colis prêt
 *  - écart >= seuil           -> appel de fonds ECART_POIDS + commande bloquée
 *  - hors normes Colissimo    -> statut ISSUE (traitement manuel)
 */
router.post('/parcels/:id/weigh', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const poidsReelKg = Number(req.body?.poidsReelKg);
        const photos: string[] = Array.isArray(req.body?.photos) ? req.body.photos : [];

        if (!Number.isFinite(poidsReelKg) || poidsReelKg <= 0) {
            return res.status(400).json({ error: 'Poids réel invalide.' });
        }
        if (photos.length < 1) {
            return res.status(400).json({ error: 'Au moins une photo est requise (preuve de réception).' });
        }

        const parcel = await prisma.inboundParcel.findUnique({
            where: { id },
            include: { user: true, order: { include: { items: true } } },
        });
        if (!parcel) return res.status(404).json({ error: 'Colis introuvable.' });

        const dims = {
            longueurCm: req.body?.longueurCm != null ? Number(req.body.longueurCm) : null,
            largeurCm: req.body?.largeurCm != null ? Number(req.body.largeurCm) : null,
            hauteurCm: req.body?.hauteurCm != null ? Number(req.body.hauteurCm) : null,
        };

        const zone = await zoneOf(parcel.userId);
        const settings = await pricing.getSettings();

        // Contrôle des limites Colissimo avant toute chose.
        const limites = pricing.checkParcelLimits(
            poidsReelKg,
            { longueurCm: dims.longueurCm, largeurCm: dims.largeurCm, hauteurCm: dims.hauteurCm },
            settings,
        );

        const updated = await prisma.inboundParcel.update({
            where: { id },
            data: {
                poidsReelKg,
                longueurCm: dims.longueurCm,
                largeurCm: dims.largeurCm,
                hauteurCm: dims.hauteurCm,
                photos: photos as any,
                notesOperateur: req.body?.notes ? String(req.body.notes) : parcel.notesOperateur,
                statut: limites.accepte ? 'WEIGHED' : 'ISSUE',
                weighedAt: new Date(),
            },
        });

        // Hors normes : pas d'expédition possible, traitement manuel.
        if (!limites.accepte) {
            if (parcel.orderId) {
                await prisma.order.update({ where: { id: parcel.orderId }, data: { status: 'ISSUE' } });
            }
            return res.json({
                parcel: updated,
                horsNormes: true,
                raison: limites.raison,
                message: 'Colis hors normes Colissimo — contactez le client (remboursement ou solution alternative).',
            });
        }

        // Écart de pesée vs estimation.
        const poidsEstime = estimatedWeightOf(parcel.order);
        let ecart: any = null;
        let paymentRequest: any = null;

        if (poidsEstime > 0) {
            ecart = await pricing.weightDeviation(poidsEstime, poidsReelKg, zone);

            if (ecart.declencheAppelDeFonds) {
                const montant = Math.round((ecart.complementEur + limites.supplementGabaritEur) * 100) / 100;
                const detail =
                    `Poids réel constaté : ${poidsReelKg} kg (estimation : ${poidsEstime.toFixed(2)} kg). ` +
                    `Complément d'acheminement : ${ecart.complementEur.toFixed(2)} €` +
                    (limites.supplementGabaritEur ? ` + supplément gabarit ${limites.supplementGabaritEur.toFixed(2)} €` : '') + '.';

                paymentRequest = await prisma.paymentRequest.create({
                    data: {
                        userId: parcel.userId,
                        orderId: parcel.orderId,
                        motif: 'ECART_POIDS',
                        montantEur: montant,
                        detail,
                        statut: 'PENDING',
                    },
                });

                // Lien de paiement Stripe (best effort).
                if (stripe && montant > 0) {
                    try {
                        const base = process.env.FRONTEND_URL || 'https://partfinder-production.up.railway.app';
                        const session = await stripe.checkout.sessions.create({
                            mode: 'payment',
                            line_items: [{
                                quantity: 1,
                                price_data: {
                                    currency: 'eur',
                                    unit_amount: Math.round(montant * 100),
                                    product_data: { name: `Complément d'acheminement — commande #${parcel.orderId ?? '—'}` },
                                },
                            }],
                            success_url: `${base}/?paid=1&pr=${paymentRequest.id}`,
                            cancel_url: `${base}/?canceled=1&pr=${paymentRequest.id}`,
                            metadata: { paymentRequestId: String(paymentRequest.id) },
                            customer_email: parcel.user?.email || undefined,
                        });
                        paymentRequest = await prisma.paymentRequest.update({
                            where: { id: paymentRequest.id },
                            data: { lienPaiement: session.url, stripeSessionId: session.id },
                        });
                        if (parcel.user?.email && session.url) {
                            EmailService.sendPaymentRequestEmail(parcel.user.email, parcel.orderId ?? paymentRequest.id, montant, session.url, detail)
                                .catch((err: any) => console.error('[warehouse] email appel de fonds:', err?.message));
                        }
                    } catch (err: any) {
                        console.error('[warehouse] lien de paiement:', err.message);
                    }
                }

                if (parcel.orderId) {
                    await prisma.order.update({
                        where: { id: parcel.orderId },
                        data: { status: 'PENDING_ADDITIONAL_PAYMENT' },
                    });
                }

                return res.json({ parcel: updated, ecart, paymentRequest, message: 'Écart significatif — appel de fonds envoyé au client.' });
            }
        }

        // Écart absorbé : le colis est prêt (sauf appel de fonds déjà en attente).
        if (parcel.orderId) {
            const pending = await prisma.paymentRequest.count({
                where: { orderId: parcel.orderId, statut: 'PENDING' },
            });
            if (pending === 0) {
                await prisma.order.update({ where: { id: parcel.orderId }, data: { status: 'READY_TO_SHIP' } });
            }
        }

        res.json({ parcel: updated, ecart, message: 'Colis pesé — écart absorbé, prêt à expédier.' });
    } catch (e: any) {
        console.error('[warehouse] weigh:', e.message);
        res.status(500).json({ error: 'Erreur lors de la pesée.' });
    }
});

/* ── Consolidation ───────────────────────────────────────────────── */

/**
 * POST /api/warehouse/consolidate — body { parcelIds: number[] }
 * Regroupe plusieurs colis pesés d'un MÊME client : poids = somme + 5 %
 * d'emballage, port recalculé sur le total, forfait de consolidation appliqué.
 */
router.post('/consolidate', async (req: express.Request, res: express.Response) => {
    try {
        const ids: number[] = Array.isArray(req.body?.parcelIds) ? req.body.parcelIds.map(Number) : [];
        if (ids.length < 2) return res.status(400).json({ error: 'Sélectionnez au moins deux colis.' });

        const parcels = await prisma.inboundParcel.findMany({ where: { id: { in: ids } } });
        if (parcels.length !== ids.length) return res.status(400).json({ error: 'Colis introuvable(s).' });

        const userIds = new Set(parcels.map((p) => p.userId));
        if (userIds.size > 1) return res.status(400).json({ error: 'Les colis doivent appartenir au même client.' });
        if (parcels.some((p) => p.statut !== 'WEIGHED')) {
            return res.status(400).json({ error: 'Tous les colis doivent être pesés.' });
        }

        const userId = parcels[0].userId;
        const zone = await zoneOf(userId);
        const settings = await pricing.getSettings();

        // Poids consolidé : somme + 5 % d'emballage.
        const poidsSomme = parcels.reduce((s, p) => s + Number(p.poidsReelKg || 0), 0);
        const poidsConsolide = Math.round(poidsSomme * 1.05 * 100) / 100;

        let portEur: number | null = null;
        let horsNormes: string | null = null;
        try {
            const ship = await pricing.getColissimoRate(poidsConsolide, zone);
            portEur = ship.portEur + ship.supplementGabaritEur;
        } catch (e: any) {
            horsNormes = e.message; // > 30 kg une fois regroupé
        }

        if (horsNormes) {
            return res.status(400).json({
                error: `Consolidation impossible : ${horsNormes}`,
                poidsConsolide,
            });
        }

        const shipment = await prisma.outboundShipment.create({
            data: {
                userId,
                orderId: parcels.find((p) => p.orderId)?.orderId ?? null,
                inboundParcelIds: ids,
                zone,
                poidsFactureKg: poidsConsolide,
                portEur: portEur!,
                statut: 'PREPARING',
            },
        });

        await prisma.inboundParcel.updateMany({ where: { id: { in: ids } }, data: { statut: 'CONSOLIDATED' } });

        res.status(201).json({
            shipment,
            poidsConsolide,
            portEur,
            forfaitConsolidationEur: settings.consolidationForfaitEur,
        });
    } catch (e: any) {
        console.error('[warehouse] consolidate:', e.message);
        res.status(500).json({ error: 'Erreur lors de la consolidation.' });
    }
});

/* ── Réexpédition ────────────────────────────────────────────────── */

/** GET /api/warehouse/shipments?statut=PREPARING — file des expéditions. */
router.get('/shipments', async (req: express.Request, res: express.Response) => {
    try {
        const statut = req.query.statut ? String(req.query.statut) : undefined;
        const shipments = await prisma.outboundShipment.findMany({
            where: statut ? { statut } : {},
            include: {
                user: { select: { id: true, companyName: true, email: true } },
                address: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });

        // Signale les expéditions bloquées par un appel de fonds en attente.
        const userIds = [...new Set(shipments.map((s) => s.userId))];
        const pending = userIds.length
            ? await prisma.paymentRequest.findMany({
                where: { userId: { in: userIds }, statut: 'PENDING' },
                select: { userId: true, orderId: true, montantEur: true },
            })
            : [];

        res.json({
            shipments: shipments.map((s) => {
                const bloquants = pending.filter(
                    (p) => p.userId === s.userId && (p.orderId == null || p.orderId === s.orderId),
                );
                return {
                    ...s,
                    bloque: bloquants.length > 0,
                    montantDuEur: bloquants.reduce((t, p) => t + Number(p.montantEur), 0),
                };
            }),
        });
    } catch (e: any) {
        console.error('[warehouse] shipments:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement des expéditions.' });
    }
});

/**
 * POST /api/warehouse/shipments — crée une expédition à partir de colis pesés.
 * body: { parcelIds: number[], addressId?, assurance?, valeurDeclareeEur? }
 */
router.post('/shipments', async (req: express.Request, res: express.Response) => {
    try {
        const ids: number[] = Array.isArray(req.body?.parcelIds) ? req.body.parcelIds.map(Number) : [];
        if (!ids.length) return res.status(400).json({ error: 'Sélectionnez au moins un colis.' });

        const parcels = await prisma.inboundParcel.findMany({ where: { id: { in: ids } } });
        if (parcels.length !== ids.length) return res.status(400).json({ error: 'Colis introuvable(s).' });
        if (parcels.some((p) => p.statut !== 'WEIGHED')) {
            return res.status(400).json({ error: 'Tous les colis doivent être pesés.' });
        }
        const userIds = new Set(parcels.map((p) => p.userId));
        if (userIds.size > 1) return res.status(400).json({ error: 'Les colis doivent appartenir au même client.' });

        const userId = parcels[0].userId;
        const orderId = parcels.find((p) => p.orderId)?.orderId ?? null;

        // BLOCAGE MÉTIER : aucune expédition tant qu'un appel de fonds est en attente.
        const pending = await prisma.paymentRequest.findMany({
            where: { userId, statut: 'PENDING', OR: [{ orderId: null }, { orderId }] },
        });
        if (pending.length) {
            const total = pending.reduce((t, p) => t + Number(p.montantEur), 0);
            return res.status(409).json({
                error: `Expédition bloquée : ${pending.length} paiement(s) en attente (${total.toFixed(2)} €).`,
                paiementsEnAttente: pending.map((p) => ({ id: p.id, motif: p.motif, montantEur: Number(p.montantEur) })),
            });
        }

        const zone = await zoneOf(userId);
        const poidsTotal = parcels.reduce((s, p) => s + Number(p.poidsReelKg || 0), 0);
        const poidsFacture = ids.length > 1
            ? Math.round(poidsTotal * 1.05 * 100) / 100  // emballage de regroupement
            : Math.round(poidsTotal * 100) / 100;

        let portEur: number;
        try {
            const ship = await pricing.getColissimoRate(poidsFacture, zone);
            portEur = ship.portEur + ship.supplementGabaritEur;
        } catch (e: any) {
            return res.status(400).json({ error: `Expédition impossible : ${e.message}` });
        }

        const addressId = req.body?.addressId ? Number(req.body.addressId) : (
            await prisma.address.findFirst({ where: { userId }, orderBy: [{ parDefaut: 'desc' }, { createdAt: 'desc' }] })
        )?.id ?? null;

        const shipment = await prisma.outboundShipment.create({
            data: {
                userId, orderId, inboundParcelIds: ids, addressId, zone,
                poidsFactureKg: poidsFacture,
                portEur,
                assurance: req.body?.assurance === 'AD_VALOREM' ? 'AD_VALOREM' : 'STANDARD',
                valeurDeclareeEur: req.body?.valeurDeclareeEur != null ? Number(req.body.valeurDeclareeEur) : null,
                statut: 'PREPARING',
            },
            include: { user: true, address: true },
        });

        res.status(201).json({ shipment });
    } catch (e: any) {
        console.error('[warehouse] create shipment:', e.message);
        res.status(500).json({ error: 'Erreur lors de la création de l\'expédition.' });
    }
});

/**
 * POST /api/warehouse/shipments/:id/label — prépare l'étiquette / la CN23.
 * Sans contrat Colissimo, renvoie les données à recopier (ManualLabelProvider).
 */
router.post('/shipments/:id/label', async (req: express.Request, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const shipment = await prisma.outboundShipment.findUnique({
            where: { id },
            include: { user: true, address: true },
        });
        if (!shipment) return res.status(404).json({ error: 'Expédition introuvable.' });

        // Re-contrôle du blocage au moment de l'étiquetage.
        const pending = await prisma.paymentRequest.count({
            where: { userId: shipment.userId, statut: 'PENDING', OR: [{ orderId: null }, { orderId: shipment.orderId }] },
        });
        if (pending) return res.status(409).json({ error: 'Paiement en attente : étiquetage bloqué.' });

        // Lignes CN23 depuis la commande (désignation neutre, sans marque de source).
        const order = shipment.orderId
            ? await prisma.order.findUnique({ where: { id: shipment.orderId }, include: { items: true } })
            : null;

        const poidsTotal = Number(shipment.poidsFactureKg || 0);
        const items = order?.items ?? [];
        const lignes: Cn23Line[] = items.length
            ? items.map((i) => ({
                designation: `Pièce détachée automobile d'occasion — ${i.partName}`.slice(0, 120),
                quantite: i.quantity || 1,
                poidsNetKg: items.length ? Math.round((poidsTotal / items.length) * 100) / 100 : poidsTotal,
                valeurEur: Number(i.priceSold) || 0,
                codeSH: String(req.body?.codeSH || DEFAULT_CODE_SH),
                origine: String(req.body?.origine || 'FR'),
            }))
            : [{
                designation: "Pièce détachée automobile d'occasion",
                quantite: 1,
                poidsNetKg: poidsTotal,
                valeurEur: Number(shipment.valeurDeclareeEur || 0),
                codeSH: String(req.body?.codeSH || DEFAULT_CODE_SH),
                origine: String(req.body?.origine || 'FR'),
            }];

        const a = shipment.address;
        const cn23 = buildCn23({
            destinataire: {
                nom: a?.destinataire || shipment.user?.companyName || '—',
                adresse: [a?.ligne1, a?.ligne2].filter(Boolean).join(', ') || '—',
                codePostal: a?.codePostal || '—',
                ville: a?.ville || '—',
                territoire: a?.territoire || shipment.zone,
                telephone: a?.telephone ?? null,
            },
            lignes,
            poidsTotalKg: poidsTotal,
        });

        const provider = activeLabelProvider();
        const label = await provider.createLabel(cn23);

        const updated = await prisma.outboundShipment.update({
            where: { id },
            data: {
                cn23Data: cn23 as any,
                statut: 'LABEL_READY',
                ...(label.tracking ? { trackingColissimo: label.tracking } : {}),
            },
        });

        res.json({ shipment: updated, label });
    } catch (e: any) {
        console.error('[warehouse] label:', e.message);
        res.status(500).json({ error: e.message || 'Erreur lors de la préparation de l\'étiquette.' });
    }
});

/**
 * POST /api/warehouse/shipments/:id/ship — saisie du suivi et notification client.
 * body: { tracking }
 */
router.post('/shipments/:id/ship', async (req: express.Request, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const tracking = String(req.body?.tracking || '').trim();
        if (!tracking) return res.status(400).json({ error: 'Numéro de suivi requis.' });

        const shipment = await prisma.outboundShipment.findUnique({ where: { id }, include: { user: true } });
        if (!shipment) return res.status(404).json({ error: 'Expédition introuvable.' });

        const pending = await prisma.paymentRequest.count({
            where: { userId: shipment.userId, statut: 'PENDING', OR: [{ orderId: null }, { orderId: shipment.orderId }] },
        });
        if (pending) return res.status(409).json({ error: 'Paiement en attente : expédition bloquée.' });

        const updated = await prisma.$transaction(async (tx) => {
            const s = await tx.outboundShipment.update({
                where: { id },
                data: { trackingColissimo: tracking, statut: 'SHIPPED', shippedAt: new Date() },
            });
            await tx.inboundParcel.updateMany({
                where: { id: { in: shipment.inboundParcelIds } },
                data: { statut: 'SHIPPED' },
            });
            if (shipment.orderId) {
                await tx.order.update({ where: { id: shipment.orderId }, data: { status: 'SHIPPED' } });
            }
            return s;
        });

        if (shipment.user?.email) {
            EmailService.sendShipmentEmail(shipment.user.email, shipment.orderId ?? id, tracking)
                .catch((err: any) => console.error('[warehouse] email expedition:', err?.message));
        }

        res.json({ shipment: updated });
    } catch (e: any) {
        console.error('[warehouse] ship:', e.message);
        res.status(500).json({ error: 'Erreur lors de l\'expédition.' });
    }
});

export default router;
