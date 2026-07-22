import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma PARTAGÉ — un seul pool de connexions pour toute l'application.
 *
 * Chaque `new PrismaClient()` ouvre son PROPRE pool (par défaut
 * 2 × cœurs + 1 connexions). Avec un client par module — 18 dans src/ — une
 * seule instance du serveur monopolisait plusieurs dizaines de connexions,
 * jusqu'à saturer PostgreSQL : le déploiement échouait sur
 * « FATAL: sorry, too many clients already », `prisma db push` ne trouvant
 * plus une seule connexion libre pendant que l'ancienne instance tournait.
 *
 * Le passage par globalThis protège des rechargements à chaud (ts-node,
 * nodemon), qui recréeraient sinon un client à chaque rechargement sans
 * jamais fermer le précédent.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        // Les requêtes ne sont pas journalisées : elles contiennent des
        // données client, et le volume masquerait les vraies erreurs.
        log: ['warn', 'error'],
    });

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
