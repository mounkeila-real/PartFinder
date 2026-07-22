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

    /**
     * Détecte la langue réelle d'un texte.
     *
     * Le marché d'origine n'est qu'un INDICE : eBay France liste quantité
     * d'annonces rédigées en allemand. S'y fier menait soit à ne rien
     * traduire, soit à demander une traduction fr→fr sans effet.
     * Renvoie null si la détection n'est pas disponible ou peu sûre.
     */
    let detecteur;
    async function detecterLangue(texte) {
        if (typeof self === 'undefined' || !('LanguageDetector' in self)) return null;
        try {
            if (!detecteur) detecteur = self.LanguageDetector.create();
            const d = await detecteur;
            const res = await d.detect(texte.slice(0, 400));
            const best = Array.isArray(res) ? res[0] : null;
            if (best && best.confidence > 0.5) return best.detectedLanguage;
            return null;
        } catch { return null; }
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

        // Langue réelle : détectée sur le texte le plus long (le plus fiable
        // pour la détection), sinon l'indice du marché d'origine.
        const plusLong = entrees.reduce((a, b) => (b.texte || '').length > (a.texte || '').length ? b : a, entrees[0]);
        const detectee = await detecterLangue((plusLong && plusLong.texte) || '');
        const langueReelle = detectee || null;

        // Langue retenue, exposée à l'appelant : le message affiché doit
        // distinguer « déjà en français » d'un « échec de traduction ».
        traduire.derniereLangue = langueReelle;

        // Détection sûre indiquant du français : rien à traduire, et le dire
        // vaut mieux que de lancer une traduction fr→fr sans effet.
        if (langueReelle === 'fr') return sortie;

        // DÉDOUBLONNAGE : un tableau de caractéristiques répète beaucoup les
        // mêmes libellés et valeurs (« Vorne », « Links », le nom de la pièce).
        // Les traduire une fois chacun au lieu d'une fois par cellule divise
        // le travail — c'est la principale source de lenteur.
        const parTexte = new Map();
        entrees.forEach((e, i) => {
            if (!e.texte || !e.texte.trim()) return;
            // Sans détection, l'indice du marché sert de repli ; s'il vaut
            // « fr » alors qu'aucune détection ne l'a confirmé, on tente quand
            // même : le serveur (DeepL) détecte la langue de son côté.
            const langue = langueReelle || (e.langue && e.langue !== 'fr' ? e.langue : null);
            const cle = (langue || 'auto') + '|' + e.texte;
            if (cache.has(cle)) { sortie[i] = cache.get(cle); return; }
            const deja = parTexte.get(cle);
            if (deja) { deja.indices.push(i); return; }
            parTexte.set(cle, { texte: e.texte, langue, cle, indices: [i] });
        });
        aFaire.push(...parTexte.values());

        if (!aFaire.length) return sortie;

        // Applique une traduction à toutes les cellules qui partagent ce texte.
        const appliquer = (x, t) => {
            if (!t) return;
            x.indices.forEach(i => { sortie[i] = t; });
            cache.set(x.cle, t);
            x.fait = true;
        };

        // 1) Navigateur — par langue, pour réutiliser chaque traducteur.
        //    Sans langue source identifiée, l'API n'est pas utilisable : on
        //    passe directement au serveur, qui sait détecter.
        if (navigateurCompatible()) {
            const parLangue = new Map();
            aFaire.filter(x => x.langue).forEach(x => {
                if (!parLangue.has(x.langue)) parLangue.set(x.langue, []);
                parLangue.get(x.langue).push(x);
            });

            await Promise.all([...parLangue.entries()].map(async ([langue, lot]) => {
                const tr = await traducteurPour(langue);
                if (!tr) return;

                // REGROUPEMENT : chaque appel au modèle embarqué coûte cher.
                // Vingt libellés de tableau envoyés séparément, c'est vingt
                // allers-retours ; regroupés en un texte d'une ligne par
                // libellé, c'est un seul.
                //
                // Uniquement les textes SANS saut de ligne : la description
                // en contient, et le découpage du résultat repose justement
                // sur le nombre de lignes.
                const courts = lot.filter(x => !x.texte.includes('\n'));
                const longs = lot.filter(x => x.texte.includes('\n'));

                if (courts.length > 1) {
                    try {
                        const res = await tr.translate(courts.map(x => x.texte).join('\n'));
                        const lignes = String(res).split('\n');
                        // Garde-fou : si le modèle a fusionné ou scindé des
                        // lignes, le lien texte↔cellule est rompu. On ne
                        // devine pas — on repasse au traitement individuel.
                        if (lignes.length === courts.length) {
                            courts.forEach((x, i) => appliquer(x, lignes[i].trim()));
                        }
                    } catch { /* traitement individuel ci-dessous */ }
                }

                const restants = [...courts.filter(x => !x.fait), ...longs];
                await Promise.all(restants.map(async (x) => {
                    try {
                        appliquer(x, await tr.translate(x.texte));
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
                (d.textes || []).forEach((t, k) => appliquer(restants[k], t));
            } catch { /* 3) on garde les textes d'origine */ }
        }

        return sortie;
    }

    window.pfTraduire = traduire;
    window.pfTraductionNavigateur = navigateurCompatible;
})();
