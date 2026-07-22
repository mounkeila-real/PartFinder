import axios from 'axios';
import crypto from 'crypto';
import { frenchifyTitle } from './part_glossary';
import { prisma } from '../lib/prisma';

/**
 * Traduction des annonces étrangères vers le français.
 *
 * Ordre d'emploi (le navigateur est prioritaire et n'appelle jamais ce service) :
 *   1. API de traduction du navigateur — sur l'appareil, gratuite, illimitée ;
 *   2. DeepL — ce service, pour les navigateurs non compatibles ;
 *   3. Glossaire déterministe — dernier recours quand le quota est épuisé.
 *
 * Aucun jeton d'IA n'est consommé.
 */


const DEEPL_KEY = process.env.DEEPL_API_KEY || '';
// Les clés gratuites finissent par « :fx » et utilisent un hôte distinct.
const DEEPL_HOST = DEEPL_KEY.endsWith(':fx')
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';

/**
 * Plafond mensuel de caractères. L'offre gratuite en accorde 500 000 ; on
 * s'arrête AVANT pour ne jamais tomber sur un refus en pleine recherche
 * client — au-delà, on retombe silencieusement sur le glossaire.
 */
const QUOTA_MENSUEL = Number(process.env.DEEPL_QUOTA_MENSUEL || '450000');

/** Bornes anti-abus : l'endpoint est public, il ne doit pas devenir un proxy. */
export const MAX_TEXTES = 60;
export const MAX_LONGUEUR = 600;

function hash(texte: string): string {
    return crypto.createHash('sha1').update(texte).digest('hex');
}

export function isConfigured(): boolean {
    return !!DEEPL_KEY;
}

/** Caractères déjà consommés sur le mois courant. */
export async function consommationDuMois(): Promise<number> {
    const debut = new Date();
    debut.setDate(1);
    debut.setHours(0, 0, 0, 0);
    const r = await prisma.translationCache.aggregate({
        _sum: { nbCaracteres: true },
        where: { createdAt: { gte: debut }, moteur: 'deepl' },
    });
    return r._sum.nbCaracteres || 0;
}

/**
 * Traduit un texte court vers plusieurs langues cibles (usage glossaire).
 *
 * Un terme validé doit exister dans les quatre langues : le glossaire sert
 * aussi à CONSTRUIRE les requêtes envoyées aux marchés étrangers, pas
 * seulement à afficher. Une entrée incomplète n'améliorerait que l'affichage.
 * Coût négligeable : quelques dizaines de caractères, une fois par terme.
 */
export async function traduireVers(
    texte: string,
    cibles: string[],
): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!isConfigured() || !texte.trim()) return out;

    for (const cible of cibles) {
        try {
            const resp = await axios.post(
                `${DEEPL_HOST}/v2/translate`,
                { text: [texte], target_lang: cible.toUpperCase() },
                {
                    headers: {
                        Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 12000,
                }
            );
            const t = resp.data?.translations?.[0]?.text;
            if (t) out[cible.toLowerCase()] = t;
        } catch (e: any) {
            console.error(`[traduction] terme -> ${cible}:`, e.response?.data || e.message);
        }
    }
    return out;
}

export interface TraductionResultat {
    textes: string[];
    /** Moteur réellement employé pour chaque texte. */
    moteurs: ('cache' | 'deepl' | 'glossaire' | 'original')[];
    quotaAtteint: boolean;
}

/**
 * Traduit un lot de textes vers le français.
 *
 * Jamais d'échec visible : en cas de quota atteint, de clé absente ou d'erreur
 * réseau, on renvoie le glossaire ou le texte d'origine. Une annonce affichée
 * dans sa langue vaut mieux qu'une annonce manquante.
 */
export async function translateToFrench(textes: string[]): Promise<TraductionResultat> {
    const entrees = textes.slice(0, MAX_TEXTES).map((t) => String(t || '').slice(0, MAX_LONGUEUR));
    const sortie: string[] = [...entrees];
    const moteurs: TraductionResultat['moteurs'] = entrees.map(() => 'original');

    // 1) Cache : une même annonce revient souvent d'une recherche à l'autre.
    const hashes = entrees.map(hash);
    const connus = await prisma.translationCache.findMany({
        where: { sourceHash: { in: hashes }, targetLang: 'FR' },
    });
    const parHash = new Map(connus.map((c) => [c.sourceHash, c.texteTraduit]));

    const aTraduire: { index: number; texte: string }[] = [];
    entrees.forEach((texte, i) => {
        const cache = parHash.get(hashes[i]);
        if (cache) { sortie[i] = cache; moteurs[i] = 'cache'; }
        else if (texte.trim()) aTraduire.push({ index: i, texte });
    });

    if (!aTraduire.length) return { textes: sortie, moteurs, quotaAtteint: false };

    // 2) DeepL, si configuré et sous le plafond.
    let quotaAtteint = false;
    if (isConfigured()) {
        const cout = aTraduire.reduce((s, t) => s + t.texte.length, 0);
        const dejaConsomme = await consommationDuMois();
        if (dejaConsomme + cout > QUOTA_MENSUEL) {
            quotaAtteint = true;
            console.warn(`[traduction] plafond mensuel atteint (${dejaConsomme}/${QUOTA_MENSUEL}) — repli glossaire`);
        } else {
            try {
                // Un seul appel pour tout le lot : DeepL accepte plusieurs
                // textes par requête, ce qui divise d'autant les allers-retours.
                const resp = await axios.post(
                    `${DEEPL_HOST}/v2/translate`,
                    { text: aTraduire.map((t) => t.texte), target_lang: 'FR' },
                    {
                        headers: {
                            Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 12000,
                    }
                );
                const trads = resp.data?.translations || [];
                await Promise.all(aTraduire.map(async (t, k) => {
                    const trad = trads[k];
                    if (!trad?.text) return;
                    sortie[t.index] = trad.text;
                    moteurs[t.index] = 'deepl';
                    // Cache best-effort : un doublon concurrent ne doit pas
                    // faire échouer la traduction déjà obtenue.
                    try {
                        await prisma.translationCache.create({
                            data: {
                                sourceHash: hash(t.texte),
                                sourceLang: trad.detected_source_language || null,
                                targetLang: 'FR',
                                texteTraduit: trad.text,
                                moteur: 'deepl',
                                nbCaracteres: t.texte.length,
                            },
                        });
                    } catch { /* déjà en cache */ }
                }));
            } catch (e: any) {
                console.error('[traduction] DeepL:', e.response?.data || e.message);
            }
        }
    }

    // 3) Dernier recours : glossaire déterministe sur ce qui n'a pas été traduit.
    //    Réservé aux TITRES ; sur une description il vaut mieux garder
    //    l'original que produire un texte faussement rassurant.
    entrees.forEach((texte, i) => {
        if (moteurs[i] !== 'original') return;
        if (texte.length > 120) return; // au-delà, ce n'est plus un titre
        const fr = frenchifyTitle(texte);
        if (fr) { sortie[i] = fr; moteurs[i] = 'glossaire'; }
    });

    return { textes: sortie, moteurs, quotaAtteint };
}
