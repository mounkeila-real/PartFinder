import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Classification d'une pièce à partir du TITRE et de la DESCRIPTION d'annonce.
 *
 * Deux informations sont extraites :
 *   1. la CATÉGORIE (donne le poids de référence)
 *   2. la QUANTITÉ — décisive : « 2 disques de frein » pèse le double d'un seul,
 *      alors qu'un « jeu de 4 plaquettes » est UNE unité de la catégorie
 *      correspondante. Se tromper ici fausse le port, donc la marge.
 *
 * Garde-fous :
 *   - Cache : une clé déjà classifiée n'est JAMAIS renvoyée à l'IA.
 *   - Timeout court + repli silencieux : l'échec IA ne bloque jamais le client,
 *     il bascule simplement la commande en régime ESTIMÉ.
 *   - Confiance < 0,6 -> marqué pour revue opérateur.
 */

const prisma = new PrismaClient();

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 5000);
export const CONFIDENCE_THRESHOLD = Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.6);

const client = API_KEY ? new Anthropic({ apiKey: API_KEY, timeout: TIMEOUT_MS }) : null;

export function isConfigured(): boolean {
    return !!client;
}

/** Normalisation : minuscules, sans références numériques longues ni ponctuation. */
export function normalizeTitle(text: string): string {
    return text
        .toLowerCase()
        .replace(/[0-9]{5,}/g, ' ')
        .replace(/[^a-z0-9àâäéèêëîïôöùûüç\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}

/**
 * Clé de cache : titre normalisé + empreinte courte de la description.
 * La description influence la quantité (« vendu à l'unité », « lot de 2 »),
 * donc elle doit faire partie de la clé — sinon deux annonces au même titre
 * mais de contenance différente partageraient un poids erroné.
 */
export function cacheKey(titre: string, description?: string | null): string {
    const base = normalizeTitle(titre);
    if (!description) return base;
    const d = normalizeTitle(description).slice(0, 400);
    if (!d) return base;
    const h = crypto.createHash('sha1').update(d).digest('hex').slice(0, 8);
    return `${base}|${h}`;
}

export interface ClassificationResult {
    categoryCode: string | null;
    confiance: number;
    quantite: number;
    source: 'CACHE' | 'AI' | 'UNAVAILABLE';
    valideParOperateur?: boolean;
    besoinRevue: boolean;
}

const UNAVAILABLE: ClassificationResult = {
    categoryCode: null, confiance: 0, quantite: 1, source: 'UNAVAILABLE', besoinRevue: true,
};

function buildSystemPrompt(categories: Array<{ code: string; labelFr: string; synonymes: string[] }>): string {
    const liste = categories
        .map((c) => `- ${c.code} : ${c.labelFr}${c.synonymes.length ? ` (${c.synonymes.join(', ')})` : ''}`)
        .join('\n');

    return `Tu classes des annonces de pièces automobiles d'occasion.

On te donne le TITRE et la DESCRIPTION d'une annonce, et la liste des catégories disponibles.

Tu dois déterminer DEUX choses :
1. category_code — la catégorie qui correspond, parmi la liste ci-dessous UNIQUEMENT.
2. quantite — le NOMBRE D'UNITÉS de cette catégorie que contient le lot vendu.

Règle essentielle pour la quantité : la catégorie représente déjà son unité de vente habituelle.
- "jeu de 4 plaquettes de frein" -> catégorie plaquettes-frein, quantite = 1 (le jeu EST l'unité)
- "2 jeux de plaquettes avant + arrière" -> quantite = 2
- "paire de disques de frein" -> catégorie disque-frein-paire, quantite = 1
- "disque de frein avant" (un seul) -> catégorie disque-frein, quantite = 1
- "4 injecteurs" -> catégorie injecteur, quantite = 4
- "lot de 2 amortisseurs" -> catégorie amortisseur, quantite = 2
Si la quantité n'est pas explicite, réponds quantite = 1.

Catégories disponibles :
${liste}

Réponds UNIQUEMENT en JSON strict, sans texte autour :
{"category_code": "...", "confidence": 0.0-1.0, "quantite": 1}

Si aucune catégorie ne convient : {"category_code": null, "confidence": 0, "quantite": 1}`;
}

/** Extrait le premier objet JSON d'une réponse (robuste aux ``` éventuels). */
function parseJson(text: string): any | null {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
    try {
        return JSON.parse(match ? match[1] : text);
    } catch {
        return null;
    }
}

/**
 * Classifie une annonce. Consulte d'abord le cache ; n'appelle l'IA qu'en
 * dernier recours. Ne lève jamais.
 */
export async function classifyPart(
    titre: string,
    description?: string | null,
): Promise<ClassificationResult> {
    if (!titre || !titre.trim()) return UNAVAILABLE;

    const key = cacheKey(titre, description);

    // 1) Cache — jamais de second appel IA pour la même clé.
    try {
        const cached = await prisma.aiClassification.findUnique({
            where: { titreNormalise: key },
            include: { category: true },
        });
        if (cached) {
            const conf = Number(cached.confiance);
            return {
                categoryCode: cached.category?.code ?? null,
                confiance: conf,
                quantite: cached.quantite,
                source: 'CACHE',
                valideParOperateur: cached.valideParOperateur,
                besoinRevue: !cached.valideParOperateur && (conf < CONFIDENCE_THRESHOLD || !cached.category),
            };
        }
    } catch (e: any) {
        console.error('[ai] lecture cache:', e.message);
    }

    if (!client) {
        console.warn('[ai] ANTHROPIC_API_KEY absent — classification ignorée (régime ESTIMÉ).');
        return UNAVAILABLE;
    }

    // 2) Appel IA
    try {
        const categories = await prisma.partCategory.findMany({
            select: { id: true, code: true, labelFr: true, synonymes: true },
            orderBy: { code: 'asc' },
        });
        if (!categories.length) return UNAVAILABLE;

        const userContent = [
            `TITRE : ${titre.trim().slice(0, 300)}`,
            description ? `DESCRIPTION : ${String(description).replace(/\s+/g, ' ').trim().slice(0, 1200)}` : 'DESCRIPTION : (aucune)',
        ].join('\n');

        const response = await client.messages.create({
            model: MODEL,
            max_tokens: 200,
            system: buildSystemPrompt(categories),
            messages: [{ role: 'user', content: userContent }],
        });

        const text = response.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
        const parsed = parseJson(text);
        if (!parsed) {
            console.warn('[ai] réponse non exploitable:', text.slice(0, 200));
            return UNAVAILABLE;
        }

        const code: string | null = parsed.category_code ?? null;
        const confiance = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
        let quantite = Math.round(Number(parsed.quantite));
        if (!Number.isFinite(quantite) || quantite < 1) quantite = 1;
        if (quantite > 20) quantite = 20; // garde-fou contre une valeur aberrante

        const category = code ? categories.find((c) => c.code === code) : undefined;
        const besoinRevue = !category || confiance < CONFIDENCE_THRESHOLD;

        // 3) Mise en cache (y compris les échecs de classification : évite de
        //    rappeler l'IA indéfiniment sur une annonce inclassable).
        try {
            const cat = category
                ? await prisma.partCategory.findUnique({ where: { code: category.code } })
                : null;
            await prisma.aiClassification.create({
                data: {
                    titreNormalise: key,
                    titreOrigine: titre.trim().slice(0, 300),
                    categoryId: cat?.id ?? null,
                    confiance,
                    quantite,
                    poidsEstimeKg: cat ? Number(cat.poidsKg) * quantite : null,
                    valideParOperateur: false,
                },
            });
        } catch (e: any) {
            // Course possible entre deux requêtes simultanées : sans gravité.
            if (!String(e.message).includes('Unique constraint')) {
                console.error('[ai] écriture cache:', e.message);
            }
        }

        return {
            categoryCode: category?.code ?? null,
            confiance,
            quantite,
            source: 'AI',
            besoinRevue,
        };
    } catch (e: any) {
        // Timeout, quota, panne : on ne bloque JAMAIS le parcours client.
        console.error('[ai] classification échouée:', e?.message || e);
        return UNAVAILABLE;
    }
}
