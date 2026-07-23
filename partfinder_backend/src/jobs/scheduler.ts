import cron from 'node-cron';
import { EmailService } from '../services/email.service';
import { checkGridFreshness, replaceGrid, activeProvider } from '../services/colissimo.service';
import * as pricing from '../services/pricing';
import { prisma } from '../lib/prisma';
import { refreshTokenSiBientotExpire } from '../services/aliexpress_token';

/**
 * Tâches planifiées.
 *
 * Désactivable par `DISABLE_CRON=1` (utile si plusieurs instances tournent :
 * sans cela chaque replica exécuterait le job).
 */


/** Destinataire des alertes : ADMIN_ALERT_EMAIL, sinon le premier compte ADMIN. */
async function adminEmail(): Promise<string | null> {
    if (process.env.ADMIN_ALERT_EMAIL) return process.env.ADMIN_ALERT_EMAIL;
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
    return admin?.email ?? null;
}

/**
 * Rafraîchissement de la grille Colissimo.
 * - Si un fournisseur automatique est configuré (contrat Entreprise) : récupère
 *   les tarifs et publie une nouvelle version de la grille.
 * - Sinon : contrôle la fraîcheur et alerte l'admin si elle est périmée.
 */
export async function refreshColissimoRates(): Promise<void> {
    const provider = activeProvider();

    if (provider.name !== 'manuel' && provider.isConfigured()) {
        try {
            const rows = await provider.fetchRates();
            if (rows.length) {
                const count = await replaceGrid(rows, new Date());
                console.log(`[cron] grille Colissimo mise à jour automatiquement (${count} tranches, source ${provider.name})`);
                return;
            }
        } catch (e: any) {
            console.error('[cron] échec du rafraîchissement automatique:', e.message);
            // On retombe volontairement sur le contrôle de fraîcheur ci-dessous.
        }
    }

    const report = await checkGridFreshness();
    console.log('[cron] Colissimo —', report.message);

    if (report.stale) {
        const to = await adminEmail();
        if (to) {
            await EmailService.sendColissimoGridAlert(to, report.message);
        } else {
            console.warn('[cron] grille périmée mais aucun destinataire admin trouvé.');
        }
    }
}

/**
 * Facturation du stockage : gratuit N jours après réception, puis X €/jour.
 *
 * Un SEUL appel de fonds par colis, mis à jour au fil des jours (compteur) —
 * et non un appel quotidien, qui serait ingérable pour le client comme pour
 * la comptabilité. Il sera réglé au moment de l'expédition.
 */
export async function billStorage(): Promise<void> {
    const settings = await pricing.getSettings();
    const gratuits = settings.stockageJoursGratuits;
    const prixJour = settings.stockagePrixJourEur;
    if (!(prixJour > 0)) return;

    const limite = new Date(Date.now() - gratuits * 86_400_000);

    // Colis encore en entrepôt, reçus au-delà de la franchise.
    const parcels = await prisma.inboundParcel.findMany({
        where: {
            receivedAt: { lt: limite, not: null },
            statut: { in: ['RECEIVED', 'WEIGHED', 'ISSUE'] },
        },
        select: { id: true, userId: true, orderId: true, receivedAt: true },
    });

    for (const p of parcels) {
        const jours = Math.floor((Date.now() - p.receivedAt!.getTime()) / 86_400_000) - gratuits;
        if (jours <= 0) continue;
        const montant = Math.round(jours * prixJour * 100) / 100;
        const detail = `Stockage du colis #${p.id} : ${jours} jour(s) au-delà des ${gratuits} jours offerts.`;

        // Un seul appel de fonds STOCKAGE par colis : on le met à jour.
        const existing = await prisma.paymentRequest.findFirst({
            where: { userId: p.userId, motif: 'STOCKAGE', statut: 'PENDING', detail: { contains: `colis #${p.id} ` } },
        });

        if (existing) {
            if (Number(existing.montantEur) !== montant) {
                await prisma.paymentRequest.update({ where: { id: existing.id }, data: { montantEur: montant, detail } });
            }
        } else {
            await prisma.paymentRequest.create({
                data: { userId: p.userId, orderId: p.orderId, motif: 'STOCKAGE', montantEur: montant, detail, statut: 'PENDING' },
            });
            console.log(`[cron] stockage facturé — colis #${p.id}, ${jours} j, ${montant} €`);
        }
    }
}

/**
 * Relances des appels de fonds en attente, à J+3 et J+7.
 *
 * Le cron tourne une fois par jour : un paiement est relancé le jour où son
 * ancienneté atteint exactement 3 puis 7 jours. Pas de champ de suivi des
 * relances en base — si le process est arrêté ce jour-là, la relance saute
 * (limitation assumée, sans double envoi possible).
 */
export async function remindPaymentRequests(): Promise<void> {
    const pending = await prisma.paymentRequest.findMany({
        where: { statut: 'PENDING' },
        include: { user: { select: { email: true, companyName: true } } },
    });

    for (const pr of pending) {
        const ageJours = Math.floor((Date.now() - pr.createdAt.getTime()) / 86_400_000);
        if (ageJours !== 3 && ageJours !== 7) continue;
        if (!pr.user?.email) continue;

        await EmailService.sendPaymentReminderEmail(
            pr.user.email,
            pr.orderId ?? pr.id,
            Number(pr.montantEur),
            pr.detail,
            ageJours,
        );
        console.log(`[cron] relance J+${ageJours} — appel de fonds #${pr.id} (${pr.user.email})`);
    }
}

export function startScheduler(): void {
    if (process.env.DISABLE_CRON === '1') {
        console.log('[cron] désactivé (DISABLE_CRON=1)');
        return;
    }

    // Tous les lundis à 08h00 (Europe/Paris) : contrôle/rafraîchissement de la grille.
    cron.schedule('0 8 * * 1', () => {
        refreshColissimoRates().catch((e) => console.error('[cron] refreshColissimoRates:', e.message));
    }, { timezone: 'Europe/Paris' });

    // Le 2 janvier à 09h00 : rappel dédié à la mise à jour tarifaire annuelle.
    cron.schedule('0 9 2 1 *', () => {
        refreshColissimoRates().catch((e) => console.error('[cron] rappel annuel:', e.message));
    }, { timezone: 'Europe/Paris' });

    // Chaque jour à 06h00 : facturation du stockage au-delà de la franchise.
    cron.schedule('0 6 * * *', () => {
        billStorage().catch((e) => console.error('[cron] billStorage:', e.message));
    }, { timezone: 'Europe/Paris' });

    // Chaque jour à 09h00 : relances des appels de fonds (J+3 et J+7).
    cron.schedule('0 9 * * *', () => {
        remindPaymentRequests().catch((e) => console.error('[cron] remindPaymentRequests:', e.message));
    }, { timezone: 'Europe/Paris' });

    // Chaque jour à 05h00 : renouvelle le token AliExpress s'il expire bientôt,
    // pour qu'il ne tombe jamais en panne faute de re-autorisation manuelle.
    cron.schedule('0 5 * * *', () => {
        refreshTokenSiBientotExpire().catch((e) => console.error('[cron] refresh token AliExpress:', e.message));
    }, { timezone: 'Europe/Paris' });

    console.log('[cron] planificateur démarré (grille Colissimo : lundi 08:00 + 2 janvier ; stockage : quotidien 06:00)');

    // Contrôle au démarrage, sans bloquer le boot.
    setTimeout(() => {
        refreshColissimoRates().catch((e) => console.error('[cron] contrôle initial:', e.message));
    }, 10_000);
}
