/**
 * Bandeau de consentement cookies (RGPD / recommandations CNIL).
 * - « Tout accepter » et « Tout refuser » d'égale visibilité + « Personnaliser ».
 * - Choix conservé 6 mois dans le cookie technique pf_consent (exempté).
 * - Aucun script non essentiel n'est chargé avant consentement :
 *   utiliser window.pfConsent.isAllowed('audience'|'preferences') avant tout ajout.
 * - « Gérer mes cookies » (footer/sidebar) rouvre le choix à tout moment.
 */
(function () {
    const COOKIE = 'pf_consent';
    const MAX_AGE = 60 * 60 * 24 * 182; // ~6 mois
    const CATEGORIES = [
        { id: 'essentiels', label: 'Essentiels', desc: 'Fonctionnement du site (session, panier, consentement).', locked: true },
        { id: 'audience', label: 'Mesure d\'audience', desc: 'Statistiques anonymes de fréquentation.', locked: false },
        { id: 'preferences', label: 'Préférences', desc: 'Mémorisation de vos choix d\'affichage.', locked: false },
    ];

    function readConsent() {
        const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
        if (!m) return null;
        try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
    }
    function saveConsent(choices) {
        const value = encodeURIComponent(JSON.stringify(Object.assign({ essentiels: true, ts: Date.now() }, choices)));
        document.cookie = `${COOKIE}=${value}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax`;
    }

    window.pfConsent = {
        isAllowed(cat) {
            if (cat === 'essentiels') return true;
            const c = readConsent();
            return !!(c && c[cat]);
        },
        open: null, // défini plus bas
    };

    document.addEventListener('DOMContentLoaded', () => {
        const banner = document.createElement('div');
        banner.className = 'ck-banner display-none';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Consentement aux cookies');
        banner.innerHTML = `
            <div class="ck-inner">
                <p class="ck-text">Nous utilisons des cookies essentiels au fonctionnement du site.
                Avec votre accord, nous pouvons aussi mesurer l'audience et mémoriser vos préférences.
                <a href="/confidentialite.html">En savoir plus</a></p>
                <div class="ck-prefs display-none" id="ck-prefs">
                    ${CATEGORIES.map(c => `
                        <label class="ck-cat">
                            <input type="checkbox" data-ck="${c.id}" ${c.locked ? 'checked disabled' : ''}>
                            <span><strong>${c.label}</strong><br><small>${c.desc}</small></span>
                        </label>`).join('')}
                </div>
                <div class="ck-actions">
                    <button class="ck-btn ck-accept" id="ck-accept">Tout accepter</button>
                    <button class="ck-btn ck-refuse" id="ck-refuse">Tout refuser</button>
                    <button class="ck-link" id="ck-custom">Personnaliser</button>
                    <button class="ck-btn ck-save display-none" id="ck-save">Enregistrer mes choix</button>
                </div>
            </div>`;
        document.body.appendChild(banner);

        const show = () => banner.classList.remove('display-none');
        const hide = () => banner.classList.add('display-none');

        window.pfConsent.open = show;

        banner.querySelector('#ck-accept').addEventListener('click', () => {
            saveConsent({ audience: true, preferences: true }); hide();
        });
        banner.querySelector('#ck-refuse').addEventListener('click', () => {
            saveConsent({ audience: false, preferences: false }); hide();
        });
        banner.querySelector('#ck-custom').addEventListener('click', () => {
            banner.querySelector('#ck-prefs').classList.remove('display-none');
            banner.querySelector('#ck-save').classList.remove('display-none');
            banner.querySelector('#ck-custom').classList.add('display-none');
        });
        banner.querySelector('#ck-save').addEventListener('click', () => {
            const get = (id) => banner.querySelector(`[data-ck="${id}"]`).checked;
            saveConsent({ audience: get('audience'), preferences: get('preferences') });
            hide();
        });

        // Lien « Gérer mes cookies » (rouvre le bandeau, choix pré-remplis).
        document.addEventListener('click', (e) => {
            if (!e.target.closest('[data-manage-cookies]')) return;
            e.preventDefault();
            const c = readConsent() || {};
            banner.querySelectorAll('[data-ck]').forEach((cb) => {
                if (!cb.disabled) cb.checked = !!c[cb.getAttribute('data-ck')];
            });
            show();
        });

        // Première visite : afficher le bandeau.
        if (!readConsent()) show();
    });
})();
