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
 * Interroge un modèle Gemini et renvoie le TEXTE de la réponse.
 *
 * @param {string} model  identifiant du modèle (ex. 'gemini-2.0-flash')
 * @param {Array<string|{inlineData:{data:string,mimeType:string}}>} parts
 *        Éléments du message : chaînes (texte) et/ou images inline.
 *        On garde l'ancien format d'appel — un tableau de « parts » — pour que
 *        les routes n'aient rien à changer dans la façon de composer prompt+image.
 * @returns {Promise<string>} texte brut de la réponse
 */
async function generateText(model, parts) {
    // Normalise vers le format attendu par @google/genai : chaque part est un
    // objet, une chaîne devient { text: ... }.
    const normalized = (Array.isArray(parts) ? parts : [parts]).map((p) =>
        typeof p === 'string' ? { text: p } : p
    );

    const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: normalized }],
    });

    // Dans le nouveau SDK, `.text` est un accesseur (et non une méthode comme
    // dans l'ancien result.response.text()).
    const text = response && typeof response.text === 'string' ? response.text : '';
    if (!text) throw new Error('Réponse Gemini vide');
    return text;
}

module.exports = { generateText, isConfigured };
