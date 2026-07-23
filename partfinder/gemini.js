/**
 * Adaptateur Gemini — isole le SDK @google/genai.
 *
 * Toute la surface de l'API Gemini est concentrée ici : si le SDK change
 * encore (le précédent, @google/generative-ai, a été renommé et refondu),
 * seul ce fichier est à revoir, pas les trois routes qui l'utilisent.
 *
 * Migration depuis @google/generative-ai@0.2.1 :
 *   avant : new GoogleGenerativeAI(key).getGenerativeModel({model}).generateContent(parts)
 *           puis result.response.text()
 *   après : new GoogleGenAI({apiKey}).models.generateContent({model, contents})
 *           puis response.text
 */
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

function isConfigured() {
    return !!process.env.GEMINI_API_KEY;
}

/**
 * Modèles de repli, essayés dans l'ordre quand le modèle demandé est
 * indisponible pour la clé. On ne sait pas à l'avance quels modèles une clé
 * donnée peut appeler (ça dépend du projet Google) : plutôt que de deviner et
 * d'échouer, on tente le plus récent puis on retombe sur des valeurs sûres.
 */
const FALLBACKS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];

// Modèle confirmé fonctionnel : évite de re-tenter la cascade à chaque appel.
let modeleQuiMarche = null;

/** Erreur signifiant « ce modèle n'existe pas / pas accessible » (≠ clé, quota). */
function estModeleIndisponible(err) {
    const m = (err && err.message ? err.message : String(err)).toLowerCase();
    return /not found|not supported|does not exist|unsupported|404/.test(m);
}

async function appel(model, contents) {
    const response = await ai.models.generateContent({ model, contents });
    // Dans le nouveau SDK, `.text` est un accesseur (et non une méthode comme
    // dans l'ancien result.response.text()).
    const text = response && typeof response.text === 'string' ? response.text : '';
    if (!text) throw new Error('Réponse Gemini vide');
    return text;
}

/**
 * Interroge Gemini et renvoie le TEXTE de la réponse.
 *
 * Essaie le modèle demandé ; s'il est indisponible pour la clé, bascule
 * automatiquement sur les modèles de repli. Toute AUTRE erreur (clé invalide,
 * quota) est propagée telle quelle — la remonter est le seul moyen de la voir.
 *
 * @param {string} model  identifiant préféré (ex. 'gemini-2.0-flash')
 * @param {Array<string|{inlineData:{data:string,mimeType:string}}>} parts
 * @returns {Promise<string>}
 */
async function generateText(model, parts) {
    const normalized = (Array.isArray(parts) ? parts : [parts]).map((p) =>
        typeof p === 'string' ? { text: p } : p
    );
    const contents = [{ role: 'user', parts: normalized }];

    // Ordre d'essai : le modèle déjà confirmé d'abord, puis le demandé, puis
    // les replis — sans doublon.
    const candidats = [...new Set([modeleQuiMarche, model, ...FALLBACKS].filter(Boolean))];

    let derniereErreur;
    for (const candidat of candidats) {
        try {
            const text = await appel(candidat, contents);
            if (candidat !== modeleQuiMarche) {
                if (candidat !== model) {
                    console.warn(`[gemini] « ${model} » indisponible, bascule sur « ${candidat} »`);
                }
                modeleQuiMarche = candidat;
            }
            return text;
        } catch (err) {
            derniereErreur = err;
            // Modèle indisponible -> on essaie le suivant. Toute autre erreur
            // (clé, quota, réseau) : inutile d'essayer d'autres modèles.
            if (!estModeleIndisponible(err)) throw err;
        }
    }
    throw derniereErreur || new Error('Aucun modèle Gemini disponible');
}

module.exports = { generateText, isConfigured };
