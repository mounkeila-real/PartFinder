import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

export class EmailService {
    /**
     * Sends a password reset link to the B2B user.
     * If the API key is missing, it falls back to printing the link to the console for local debugging.
     */
    static async sendPasswordResetEmail(email: string, token: string, frontendUrl?: string): Promise<boolean> {
        const baseUrl = frontendUrl || FRONTEND_URL;
        const resetLink = `${baseUrl}/index.html?tab=auth&resetToken=${token}`;

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #1a56db; text-align: center;">Réinitialisation de votre mot de passe</h2>
                <p>Bonjour,</p>
                <p>Vous avez demandé la réinitialisation de votre mot de passe pour votre compte professionnel PartFinder.</p>
                <p>Veuillez cliquer sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable pendant 1 heure.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}" style="background-color: #1a56db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Réinitialiser mon mot de passe</a>
                </div>
                <p style="font-size: 12px; color: #666;">Si le bouton ne fonctionne pas, copiez-collez le lien suivant dans votre navigateur :</p>
                <p style="font-size: 12px; color: #1a56db; word-break: break-all;">${resetLink}</p>
                <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;" />
                <p style="font-size: 11px; color: #999; text-align: center;">Cet e-mail est automatique, merci de ne pas y répondre. Si vous n'avez pas demandé ce changement, vous pouvez l'ignorer en toute sécurité.</p>
            </div>
        `;

        if (!resend) {
            console.warn('⚠️ RESEND_API_KEY is not defined. Local debugging mode.');
            console.warn(`[EMAIL BACKUP] Password Reset Link for ${email}:\n👉 ${resetLink}\n`);
            return true;
        }

        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: email,
                subject: 'Réinitialisation de votre mot de passe - PartFinder',
                html: htmlContent,
            });
            console.log(`[resend] Reset email successfully sent to ${email}`);
            return true;
        } catch (error: any) {
            console.error('[resend] Failed to send reset email:', error.message);
            // In local/dev we return true so the user is not blocked, but log the link
            console.warn(`[EMAIL BACKUP FALLBACK] Password Reset Link for ${email}:\n👉 ${resetLink}\n`);
            return false;
        }
    }

    /**
     * Demande de fonds : le prix définitif de la commande a été arrêté,
     * le client est invité à régler via le lien de paiement sécurisé.
     * Vocabulaire neutre — aucune mention d'une source d'approvisionnement.
     */
    static async sendPaymentRequestEmail(
        email: string,
        orderId: number,
        amountEur: number,
        paymentUrl: string,
        note?: string | null,
    ): Promise<boolean> {
        const montant = amountEur.toFixed(2).replace('.', ',') + ' €';
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #1F5FD6; text-align: center;">Votre commande #${orderId} est prête à être réglée</h2>
                <p>Bonjour,</p>
                <p>Nous avons vérifié votre commande et arrêté son montant définitif :</p>
                <p style="font-size: 26px; font-weight: bold; color: #F26B1D; text-align: center; margin: 24px 0;">${montant}</p>
                ${note ? `<p style="background:#F5F7FB;padding:12px 16px;border-radius:8px;font-size:14px;">${note}</p>` : ''}
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${paymentUrl}" style="background-color: #1F5FD6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Régler ma commande</a>
                </div>
                <p style="font-size: 12px; color: #666;">Si le bouton ne fonctionne pas, copiez-collez ce lien :</p>
                <p style="font-size: 12px; color: #1F5FD6; word-break: break-all;">${paymentUrl}</p>
                <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;" />
                <p style="font-size: 11px; color: #999; text-align: center;">Paiement sécurisé. Aucun débit n'est effectué sans votre accord.</p>
            </div>
        `;

        if (!resend) {
            console.warn(`[EMAIL BACKUP] Demande de paiement commande #${orderId} (${montant}) pour ${email}:\n👉 ${paymentUrl}\n`);
            return true;
        }
        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: email,
                subject: `Votre commande #${orderId} — montant à régler`,
                html: htmlContent,
            });
            console.log(`[resend] Payment request sent to ${email} (order #${orderId})`);
            return true;
        } catch (error: any) {
            console.error('[resend] Failed to send payment request:', error.message);
            return false;
        }
    }
}
