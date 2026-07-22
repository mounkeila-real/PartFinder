/**
 * Traduction des annonces étrangères vers le français.
 *
 * Ordre :
 *   1. API Translator du navigateur (Chrome/Edge 138+) — sur l'appareil,
 *      gratuite et illimitée, aucun texte n'est envoyé sur le réseau ;
 *   2. Repli serveur (DeepL) pour Firefox, Safari et mobile ;
 *   3. Texte d'origine si tout échoue — une annonce lisible dans sa langue
 *      vaut mieux qu'une annonce absente.
 *
 * Aucun jeton d'IA n'est consommé dans aucun de ces cas.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    // Cache de session : une même annonce revient d'une recherche à l'autre.
    const cache = new Map();
    // Traducteurs par langue source — leur création télécharge un modèle.
    const traducteurs = new Map();

    function navigateurCompatible() {
        return typeof self !== 'undefined' && 'Translator' in self;
    }

    async function traducteurPour(langue) {
        if (traducteurs.has(langue)) return traducteurs.get(langue);
        const p = (async () => {
            try {
                const dispo = await self.Translator.availability({
                    sourceLanguage: langue, targetLanguage: 'fr',
                });
                if (dispo === 'unavailable') return null;
                // « downloadable » : le modèle se télécharge à la création.
                return await self.Translator.create({
                    sourceLanguage: langue, targetLanguage: 'fr',
                });
            } catch { return null; }
        })();
        traducteurs.set(langue, p);
        return p;
    }

    /**
     * Traduit des textes groupés par langue.
     * @param {{texte: string, langue: string}[]} entrees
     * @returns {Promise<string[]>} textes dans l'ordre d'entrée
     */
    async function traduire(entrees) {
        const sortie = entrees.map(e => e.texte);
        const aFaire = [];

        entrees.forEach((e, i) => {
            if (!e.texte || !e.texte.trim()) return;
            // Déjà en français : rien à faire.
            if (!e.langue || e.langue === 'fr') return;
            const cle = e.langue + '|' + e.texte;
            if (cache.has(cle)) { sortie[i] = cache.get(cle); return; }
            aFaire.push({ i, ...e, cle });
        });

        if (!aFaire.length) return sortie;

        // 1) Navigateur — par langue, pour réutiliser chaque traducteur.
        if (navigateurCompatible()) {
            const parLangue = new Map();
            aFaire.forEach(x => {
                if (!parLangue.has(x.langue)) parLangue.set(x.langue, []);
                parLangue.get(x.langue).push(x);
            });

            await Promise.all([...parLangue.entries()].map(async ([langue, lot]) => {
                const tr = await traducteurPour(langue);
                if (!tr) return;
                await Promise.all(lot.map(async (x) => {
                    try {
                        const t = await tr.translate(x.texte);
                        if (t) { sortie[x.i] = t; cache.set(x.cle, t); x.fait = true; }
                    } catch { /* laissé au repli serveur */ }
                }));
            }));
        }

        // 2) Repli serveur pour ce qui reste.
        const restants = aFaire.filter(x => !x.fait);
        if (restants.length) {
            try {
                const r = await fetch(API_BASE_URL + '/parts/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ textes: restants.map(x => x.texte) }),
                });
                const d = await r.json();
                (d.textes || []).forEach((t, k) => {
                    const x = restants[k];
                    if (x && t) { sortie[x.i] = t; cache.set(x.cle, t); }
                });
            } catch { /* 3) on garde les textes d'origine */ }
        }

        return sortie;
    }

    window.pfTraduire = traduire;
    window.pfTraductionNavigateur = navigateurCompatible;
})();
