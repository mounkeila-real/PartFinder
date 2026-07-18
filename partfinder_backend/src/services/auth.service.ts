import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/**
 * Service d'authentification : hachage des mots de passe (bcrypt) + JWT.
 *
 * Variable d'environnement :
 *   JWT_SECRET  : secret de signature des tokens (OBLIGATOIRE en prod).
 *                 A definir sur Railway (chaine longue aleatoire).
 */

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;

export interface TokenPayload {
    userId: number;
    role: string;
}

export const AuthService = {
    hashPassword(plain: string): Promise<string> {
        return bcrypt.hash(plain, BCRYPT_ROUNDS);
    },

    verifyPassword(plain: string, hash: string): Promise<boolean> {
        return bcrypt.compare(plain, hash);
    },

    signToken(payload: TokenPayload): string {
        const options: jwt.SignOptions = { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] };
        return jwt.sign(payload, JWT_SECRET, options);
    },

    verifyToken(token: string): TokenPayload {
        return jwt.verify(token, JWT_SECRET) as TokenPayload;
    },

    isSecretConfigured(): boolean {
        return !!process.env.JWT_SECRET;
    },
};
