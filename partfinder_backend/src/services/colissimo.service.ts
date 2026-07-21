import { PrismaClient } from '@prisma/client';

/**
 * Grille tarifaire Colissimo Outre-mer.
 *
 * ⚠️ IMPORTANT — pourquoi il n'y a pas de récupération automatique des tarifs :
 * La Poste ne publie AUCUNE API publique et gratuite des tarifs Colissimo grand
 * public. L'API « Colissimo Entreprise » (service de calcul de tarif) existe mais
 * exige un CONTRAT et des identifiants. Scraper laposte.fr serait fragile et
 * produirait silencieusement des prix faux — donc des ventes à perte.
 *
 * Conception retenue :
 *   1. La grille vit en base, VERSIONNÉE par dates de validité (historique conservé).
 *   2. `replaceGrid()` clôture proprement l'ancienne grille et active la nouvelle.
 *   3. Un job planifié surveille la FRAÎCHEUR et alerte l'admin quand elle est
 *      périmée (rappel automatique de la mise à jour du 1er janvier).
 *   4. `ColissimoApiProvider` est prêt à brancher le jour où un contrat Entreprise
 *      est signé : le rafraîchissement deviendra alors réellement automatique.
 */

const prisma = new PrismaClient();

export type Zone = 'OM1' | 'OM2';

export interface RateRow {
    zone: Zone;
    poidsMaxKg: number;
    prixEur: number;
}

/** Tarifs en vigueur à la date donnée (défaut : aujourd'hui). */
export async function getActiveRates(zone?: Zone, at: Date = new Date()) {
    return prisma.colissimoRate.findMany({
        where: {
            ...(zone ? { zone } : {}),
            valideDu: { lte: at },
            OR: [{ valideAu: null }, { valideAu: { gte: at } }],
        },
        orderBy: [{ zone: 'asc' }, { poidsMaxKg: 'asc' }],
    });
}

/**
 * Remplace la grille en vigueur par une nouvelle, à partir de `valideDu`.
 * L'ancienne n'est PAS supprimée : elle est clôturée (valideAu = veille),
 * ce qui préserve l'historique et permet de retarifer une commande passée.
 */
export async function replaceGrid(rows: RateRow[], valideDu: Date) {
    if (!rows.length) throw new Error('Grille vide.');

    const veille = new Date(valideDu);
    veille.setDate(veille.getDate() - 1);

    return prisma.$transaction(async (tx) => {
        // Clôture des tarifs encore ouverts.
        await tx.colissimoRate.updateMany({
            where: { valideAu: null, valideDu: { lt: valideDu } },
            data: { valideAu: veille },
        });
        await tx.colissimoRate.createMany({
            data: rows.map((r) => ({
                zone: r.zone,
                poidsMaxKg: r.poidsMaxKg,
                prixEur: r.prixEur,
                valideDu,
            })),
        });
        return tx.colissimoRate.count({ where: { valideDu } });
    });
}

export interface FreshnessReport {
    stale: boolean;
    ageDays: number | null;
    valideDu: Date | null;
    rowCount: number;
    message: string;
}

/**
 * La grille est considérée périmée si elle date de plus de `maxAgeDays`
 * (défaut 365 j) — ou si aucune grille n'est en vigueur.
 */
export async function checkGridFreshness(maxAgeDays = 365): Promise<FreshnessReport> {
    const active = await getActiveRates();
    if (active.length === 0) {
        return { stale: true, ageDays: null, valideDu: null, rowCount: 0, message: 'Aucune grille Colissimo en vigueur.' };
    }
    const valideDu = active.reduce<Date>((min, r) => (r.valideDu < min ? r.valideDu : min), active[0].valideDu);
    const ageDays = Math.floor((Date.now() - valideDu.getTime()) / 86_400_000);
    const stale = ageDays > maxAgeDays;
    return {
        stale,
        ageDays,
        valideDu,
        rowCount: active.length,
        message: stale
            ? `Grille Colissimo en vigueur depuis ${ageDays} jours (${valideDu.toISOString().slice(0, 10)}) — vérification requise.`
            : `Grille à jour (${active.length} tranches, en vigueur depuis le ${valideDu.toISOString().slice(0, 10)}).`,
    };
}

/* ── Fournisseurs de tarifs ────────────────────────────────────────
   Interface prête pour l'automatisation réelle le jour d'un contrat
   Colissimo Entreprise. */

export interface ColissimoRateProvider {
    readonly name: string;
    isConfigured(): boolean;
    fetchRates(): Promise<RateRow[]>;
}

/** Aujourd'hui : la grille est saisie/vérifiée manuellement en admin. */
export const ManualRateProvider: ColissimoRateProvider = {
    name: 'manuel',
    isConfigured: () => true,
    async fetchRates() {
        throw new Error("Grille saisie manuellement : aucune récupération automatique disponible.");
    },
};

/**
 * À implémenter le jour où un contrat Colissimo Entreprise est signé.
 * Variables attendues : COLISSIMO_CONTRACT_NUMBER, COLISSIMO_PASSWORD.
 */
export const ColissimoApiProvider: ColissimoRateProvider = {
    name: 'colissimo-entreprise',
    isConfigured: () =>
        !!(process.env.COLISSIMO_CONTRACT_NUMBER && process.env.COLISSIMO_PASSWORD),
    async fetchRates() {
        throw new Error(
            "Fournisseur Colissimo Entreprise non implémenté : nécessite un contrat " +
            "(COLISSIMO_CONTRACT_NUMBER / COLISSIMO_PASSWORD) puis l'appel du service de calcul de tarif."
        );
    },
};

/** Fournisseur actif : l'API si elle est configurée, sinon le mode manuel. */
export function activeProvider(): ColissimoRateProvider {
    return ColissimoApiProvider.isConfigured() ? ColissimoApiProvider : ManualRateProvider;
}
