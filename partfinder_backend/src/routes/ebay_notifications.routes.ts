import express from 'express';
import crypto from 'crypto';

/**
 * Conformité eBay — Marketplace Account Deletion/Closure Notification.
 *
 * Requis par eBay pour activer un keyset PRODUCTION.
 *
 * - GET  : eBay envoie un challenge_code lors de la validation de l'endpoint.
 *          On répond { challengeResponse: SHA256(challengeCode + verificationToken + endpoint) }.
 * - POST : eBay notifie la suppression d'un compte utilisateur.
 *          On répond 200 et on supprime toute donnée liée à cet utilisateur (le cas échéant).
 *
 * Variables d'environnement :
 *   EBAY_VERIFICATION_TOKEN  : chaîne 32-80 caractères (alphanumérique, _ -) — la même
 *                              que celle saisie dans le formulaire eBay.
 *   EBAY_DELETION_ENDPOINT   : l'URL HTTPS publique EXACTE de cet endpoint, telle que
 *                              déclarée à eBay (ex: https://xxx.up.railway.app/api/ebay/marketplace-deletion).
 */

const router = express.Router();

const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || '';
const ENDPOINT_URL = process.env.EBAY_DELETION_ENDPOINT || '';

// GET : validation du endpoint (challenge code).
router.get('/marketplace-deletion', (req: express.Request, res: express.Response) => {
    const challengeCode = req.query.challenge_code as string | undefined;

    if (!challengeCode) {
        return res.status(400).json({ error: 'Missing challenge_code' });
    }
    if (!VERIFICATION_TOKEN || !ENDPOINT_URL) {
        console.error('[eBay] EBAY_VERIFICATION_TOKEN ou EBAY_DELETION_ENDPOINT non configuré.');
        return res.status(500).json({ error: 'Endpoint not configured' });
    }

    // Ordre imposé par eBay : challengeCode + verificationToken + endpoint.
    const hash = crypto.createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');

    res.status(200).json({ challengeResponse });
});

// POST : notification réelle de suppression de compte.
router.post('/marketplace-deletion', (req: express.Request, res: express.Response) => {
    try {
        const notification = req.body?.notification;
        const username = notification?.data?.username;
        const userId = notification?.data?.userId;

        console.log('[eBay] Notification de suppression de compte reçue:', { username, userId });

        // PartFinder n'utilise que la Browse API (token applicatif) et ne stocke pas
        // de données d'utilisateurs eBay. Si un jour on stocke des données utilisateur,
        // les supprimer ici en se basant sur userId / username.

        // eBay attend un accusé 2xx.
        res.sendStatus(200);
    } catch (error: any) {
        console.error('[eBay] Erreur traitement notification:', error.message);
        // On accuse quand même réception pour éviter les relances agressives.
        res.sendStatus(200);
    }
});

export default router;
