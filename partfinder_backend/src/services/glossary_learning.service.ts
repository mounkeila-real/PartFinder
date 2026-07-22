import { normalize, GLOSSARY_SIZE } from './part_glossary';
import { prisma } from '../lib/prisma';

/**
 * Enrichissement du glossaire par la pratique.
 *
 * Boucle : on OBSERVE les termes que le glossaire ne connaît pas, DeepL
 * PROPOSE une traduction, un opérateur VALIDE, et l'entrée rejoint le
 * glossaire — devenant dès lors gratuite et instantanée.
 *
 * Rien n'entre automatiquement : le glossaire pilote aussi la recherche
 * multilingue, et une entrée fausse enverrait une requête erronée aux marchés
 * étrangers, faisant perdre des annonces sans rien signaler.
 */


/** Mots ignorés : trop courts, numériques, ou codes de modèle (E90, F20, 1.6). */
const IGNORES = new Set([
    'und', 'mit', 'fur', 'der', 'die', 'das', 'den', 'von', 'zu', 'im', 'am',
    'per', 'con', 'del', 'della', 'il', 'la', 'lo', 'di', 'da', 'in',
    'para', 'con', 'los', 'las', 'el', 'de', 'y', 'a',
    'for', 'with', 'and', 'the', 'of', 'to', 'oe', 'oem', 'kit', 'set', 'pcs',
]);

function estCandidat(mot: string): boolean {
    if (mot.length < 4 || mot.length > 28) return false;
    if (IGNORES.has(mot)) return false;
    // Codes techniques : références, motorisations, codes chassis.
    if (/\d/.test(mot)) return false;
    return /^[a-zà-ÿ]+$/i.test(mot);
}

/**
 * Enregistre les mots d'un titre étranger que le glossaire ne reconnaît pas.
 *
 * Best-effort et non bloquant : l'apprentissage ne doit jamais ralentir ni
 * faire échouer une recherche client.
 */
export async function observerTermes(titre: string, langueSource: string): Promise<void> {
    if (!titre || !langueSource || langueSource === 'fr') return;
    try {
        const mots = [...new Set(normalize(titre).split(/\s+/).filter(estCandidat))];
        if (!mots.length) return;

        // Une seule requête par terme, en incrément : le comptage des
        // occurrences fait remonter naturellement les termes qui comptent.
        await Promise.all(mots.slice(0, 12).map((terme) =>
            prisma.glossaryTerm.upsert({
                where: { terme_langueSource: { terme, langueSource } },
                update: { occurrences: { increment: 1 } },
                create: { terme, langueSource, occurrences: 1 },
            }).catch(() => null)
        ));
    } catch {
        /* l'apprentissage est un bonus, jamais un point de panne */
    }
}

export interface TermeCandidat {
    id: number;
    terme: string;
    langueSource: string;
    occurrences: number;
    labelFr: string | null;
    statut: string;
}

/** Termes les plus fréquents encore non traités, les plus rentables d'abord. */
export async function candidats(limit = 40): Promise<TermeCandidat[]> {
    const rows = await prisma.glossaryTerm.findMany({
        where: { statut: 'CANDIDAT' },
        orderBy: [{ occurrences: 'desc' }, { id: 'asc' }],
        take: limit,
    });
    return rows.map((r) => ({
        id: r.id, terme: r.terme, langueSource: r.langueSource,
        occurrences: r.occurrences, labelFr: r.labelFr, statut: r.statut,
    }));
}

/** Entrées validées, fusionnées au glossaire statique au démarrage. */
export async function termesValides(): Promise<{
    fr: string[]; de: string; es: string; it: string; en: string;
}[]> {
    const rows = await prisma.glossaryTerm.findMany({ where: { statut: 'VALIDE' } });
    return rows
        .filter((r) => r.labelFr && r.de && r.es && r.it && r.en)
        .map((r) => ({
            fr: [r.labelFr as string],
            de: r.de as string,
            es: r.es as string,
            it: r.it as string,
            en: r.en as string,
        }));
}

export async function statistiques(): Promise<{
    statiques: number; valides: number; candidats: number;
}> {
    const [valides, cands] = await Promise.all([
        prisma.glossaryTerm.count({ where: { statut: 'VALIDE' } }),
        prisma.glossaryTerm.count({ where: { statut: 'CANDIDAT' } }),
    ]);
    return { statiques: GLOSSARY_SIZE, valides, candidats: cands };
}
