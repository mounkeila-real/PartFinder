import express from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../services/auth.service';
import { requireAuth, AuthedRequest } from '../middleware/auth.middleware';
import { EmailService } from '../services/email.service';

const router = express.Router();
const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Champs publics d'un utilisateur (jamais le passwordHash).
function publicUser(u: any) {
    return {
        id: u.id,
        email: u.email,
        companyName: u.companyName,
        contactName: u.contactName,
        phone: u.phone,
        vatNumber: u.vatNumber,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
    };
}

/**
 * POST /api/auth/register — inscription d'un compte pro (B2B).
 * body: { email, password, companyName, contactName?, phone?, vatNumber? }
 */
router.post('/register', async (req: express.Request, res: express.Response) => {
    try {
        const { email, password, companyName, contactName, phone, vatNumber } = req.body || {};

        if (!email || !EMAIL_RE.test(email)) {
            return res.status(400).json({ error: 'Email invalide.' });
        }
        if (!password || String(password).length < 8) {
            return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
        }
        if (!companyName || !String(companyName).trim()) {
            return res.status(400).json({ error: 'La raison sociale est obligatoire.' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
        }

        const passwordHash = await AuthService.hashPassword(String(password));
        const user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                passwordHash,
                companyName: String(companyName).trim(),
                contactName: contactName ? String(contactName).trim() : null,
                phone: phone ? String(phone).trim() : null,
                vatNumber: vatNumber ? String(vatNumber).trim() : null,
            },
        });

        const token = AuthService.signToken({ userId: user.id, role: user.role });
        res.status(201).json({ token, user: publicUser(user) });
    } catch (error: any) {
        console.error('[auth] register:', error.message);
        res.status(500).json({ error: 'Erreur lors de l\'inscription.' });
    }
});

/**
 * POST /api/auth/login — connexion.
 * body: { email, password }
 */
router.post('/login', async (req: express.Request, res: express.Response) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: 'Email et mot de passe requis.' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        // Message identique que l'email existe ou non (anti-enumeration).
        if (!user) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }
        if (user.status === 'SUSPENDED') {
            return res.status(403).json({ error: 'Ce compte est suspendu. Contactez le support.' });
        }

        const ok = await AuthService.verifyPassword(String(password), user.passwordHash);
        if (!ok) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const token = AuthService.signToken({ userId: user.id, role: user.role });
        res.json({ token, user: publicUser(user) });
    } catch (error: any) {
        console.error('[auth] login:', error.message);
        res.status(500).json({ error: 'Erreur lors de la connexion.' });
    }
});

/**
 * GET /api/auth/me — profil de l'utilisateur connecté.
 */
router.get('/me', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
        if (!user) return res.status(404).json({ error: 'Compte introuvable.' });
        res.json({ user: publicUser(user) });
    } catch (error: any) {
        console.error('[auth] me:', error.message);
        res.status(500).json({ error: 'Erreur.' });
    }
});

/**
 * POST /api/auth/logout — pour un JWT Bearer, la déconnexion se fait côté client
 * (suppression du token). Endpoint fourni par convention.
 */
router.post('/logout', (_req: express.Request, res: express.Response) => {
    res.json({ ok: true });
});

/**
 * PATCH /api/auth/profile — mise à jour du profil (hors email/mot de passe).
 * body: { companyName?, contactName?, phone?, vatNumber? }
 */
router.patch('/profile', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const { companyName, contactName, phone, vatNumber } = req.body || {};
        if (companyName !== undefined && !String(companyName).trim()) {
            return res.status(400).json({ error: 'La raison sociale ne peut pas être vide.' });
        }
        const user = await prisma.user.update({
            where: { id: req.user!.userId },
            data: {
                ...(companyName !== undefined ? { companyName: String(companyName).trim() } : {}),
                ...(contactName !== undefined ? { contactName: String(contactName).trim() || null } : {}),
                ...(phone !== undefined ? { phone: String(phone).trim() || null } : {}),
                ...(vatNumber !== undefined ? { vatNumber: String(vatNumber).trim() || null } : {}),
            },
        });
        res.json({ user: publicUser(user) });
    } catch (error: any) {
        console.error('[auth] profile:', error.message);
        res.status(500).json({ error: 'Erreur lors de la mise à jour du profil.' });
    }
});

/**
 * POST /api/auth/change-password
 * body: { currentPassword, newPassword }
 */
router.post('/change-password', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (!newPassword || String(newPassword).length < 8) {
            return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
        }
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
        if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

        const ok = await AuthService.verifyPassword(String(currentPassword || ''), user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

        const passwordHash = await AuthService.hashPassword(String(newPassword));
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
        res.json({ ok: true });
    } catch (error: any) {
        console.error('[auth] change-password:', error.message);
        res.status(500).json({ error: 'Erreur lors du changement de mot de passe.' });
    }
});

/**
 * DELETE /api/auth/account — désinscription (droit à l'effacement RGPD).
 * body: { password }  (confirmation obligatoire)
 * Les commandes sont CONSERVÉES (traçabilité comptable) mais ANONYMISÉES :
 * détachées du compte et contact remplacé.
 */
router.delete('/account', requireAuth, async (req: AuthedRequest, res: express.Response) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
        if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

        const ok = await AuthService.verifyPassword(String(req.body?.password || ''), user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect.' });

        await prisma.$transaction([
            prisma.order.updateMany({
                where: { userId: user.id },
                data: { userId: null, contactInfo: '[compte supprimé]', shippingAddress: null },
            }),
            prisma.user.delete({ where: { id: user.id } }),
        ]);

        console.log('[auth] compte supprimé (RGPD):', user.email);
        res.json({ ok: true });
    } catch (error: any) {
        console.error('[auth] delete account:', error.message);
        res.status(500).json({ error: 'Erreur lors de la suppression du compte.' });
    }
});

/**
 * POST /api/auth/forgot-password — demande de réinitialisation.
 * body: { email }
 */
router.post('/forgot-password', async (req: express.Request, res: express.Response) => {
    try {
        const { email } = req.body || {};
        const successMsg = 'Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.';

        if (!email || !EMAIL_RE.test(email)) {
            return res.json({ message: successMsg }); // Pas d'erreur explicite pour préserver l'anonymat
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            const expiry = new Date(Date.now() + 3600000); // 1 heure

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    resetToken: token,
                    resetTokenExpiry: expiry,
                },
            });

            await EmailService.sendPasswordResetEmail(user.email, token);
        }

        res.json({ message: successMsg });
    } catch (error: any) {
        console.error('[auth] forgot-password error:', error.message);
        res.status(500).json({ error: 'Erreur lors de la demande de réinitialisation.' });
    }
});

/**
 * POST /api/auth/reset-password — réinitialisation effective avec le token.
 * body: { token, newPassword }
 */
router.post('/reset-password', async (req: express.Request, res: express.Response) => {
    try {
        const { token, newPassword } = req.body || {};

        if (!token || !String(token).trim()) {
            return res.status(400).json({ error: 'Le jeton de réinitialisation est requis.' });
        }
        if (!newPassword || String(newPassword).length < 8) {
            return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
        }

        // Trouver l'utilisateur ayant le token non expiré
        const user = await prisma.user.findFirst({
            where: {
                resetToken: token,
                resetTokenExpiry: {
                    gt: new Date(),
                },
            },
        });

        if (!user) {
            return res.status(400).json({ error: 'Le lien de réinitialisation est invalide ou a expiré.' });
        }

        const passwordHash = await AuthService.hashPassword(String(newPassword));

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExpiry: null,
            },
        });

        res.json({ message: 'Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.' });
    } catch (error: any) {
        console.error('[auth] reset-password error:', error.message);
        res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe.' });
    }
});

export default router;
