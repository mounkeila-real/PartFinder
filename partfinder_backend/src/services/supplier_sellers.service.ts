import { EbayService, MAX_SELLERS_PER_QUERY } from './ebay.service';
import { prisma } from '../lib/prisma';

/**
 * Vendeurs professionnels ciblés (casses européennes).
 *
 * Une recherche générale classe par pertinence et noie les grosses casses
 * parmi les annonces de particuliers. On lance donc une seconde recherche
 * NOMINATIVE sur ces vendeurs, dont les stocks sont profonds, les photos
 * fiables et les délais tenus.
 */


// Cache court : la liste change rarement, mais elle est lue à chaque
// recherche et sur chaque marché interrogé.
let cache: { at: number; sellers: SellerRef[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export interface SellerRef {
    username: string;
    label: string;
    priorite: number;
    fiabilite: number;
}

export async function getActiveSellers(supplierCode = 'EBAY'): Promise<SellerRef[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.sellers;
    try {
        const rows = await prisma.supplierSeller.findMany({
            where: { supplierCode, actif: true },
            orderBy: [{ priorite: 'desc' }, { id: 'asc' }],
            take: MAX_SELLERS_PER_QUERY,
        });
        const sellers = rows.map((r) => ({
            username: r.sellerUsername,
            label: r.labelInterne,
            priorite: r.priorite,
            fiabilite: Number(r.fiabiliteScore),
        }));
        cache = { at: Date.now(), sellers };
        return sellers;
    } catch (e: any) {
        // Table absente ou base indisponible : la recherche générale continue.
        console.error('[sellers] lecture whitelist:', e.message);
        return [];
    }
}

export function invalidateSellersCache(): void {
    cache = null;
}

/**
 * Vérifie qu'un username existe réellement et remonte des annonces.
 *
 * Indispensable : un username erroné est accepté par l'API et renvoie
 * simplement 0 résultat — la casse serait « configurée » sans jamais être
 * interrogée, et personne ne s'en apercevrait.
 */
export async function verifierVendeur(id: number, marketplaceId?: string): Promise<{
    ok: boolean; nbResultats: number; message: string;
}> {
    const row = await prisma.supplierSeller.findUnique({ where: { id } });
    if (!row) return { ok: false, nbResultats: 0, message: 'Vendeur introuvable.' };

    // Requête volontairement large : on cherche à savoir si le compte existe
    // et vend des pièces, pas à évaluer une référence précise.
    const results = await EbayService.searchParts('piece auto', {
        limit: 10,
        sellers: [row.sellerUsername],
        withDescriptions: false,
        ...(marketplaceId ? { marketplaceId } : {}),
    });
    const nb = results.filter((r: any) => !r.isMock).length;

    await prisma.supplierSeller.update({
        where: { id },
        data: { verifieLe: new Date(), dernierNbResultats: nb },
    });
    invalidateSellersCache();

    return {
        ok: nb > 0,
        nbResultats: nb,
        message: nb > 0
            ? `${nb} annonce(s) trouvée(s) — le compte est actif.`
            : 'Aucune annonce. Le nom du vendeur est probablement inexact : '
              + 'il serait accepté sans erreur mais ne remonterait jamais rien.',
    };
}
