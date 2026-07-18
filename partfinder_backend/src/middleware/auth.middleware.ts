import { Request, Response, NextFunction } from 'express';
import { AuthService, TokenPayload } from '../services/auth.service';

/**
 * Middlewares d'authentification (JWT en header Authorization: Bearer <token>).
 */

export interface AuthedRequest extends Request {
    user?: TokenPayload;
}

function extractToken(req: Request): string {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// Exige un utilisateur authentifie ; attache req.user.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Non authentifié' });
    }
    try {
        req.user = AuthService.verifyToken(token);
        next();
    } catch {
        return res.status(401).json({ error: 'Session invalide ou expirée' });
    }
}

// Exige un utilisateur ADMIN.
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    requireAuth(req, res, () => {
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
        }
        next();
    });
}
