/**
 * Authentification PartFinder (Phase 1) — modale connexion / inscription B2B.
 * Token JWT stocké en localStorage, envoyé en Authorization: Bearer.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const TOKEN_KEY = 'pf_token';
    const getToken = () => localStorage.getItem(TOKEN_KEY);
    const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
    const clearToken = () => localStorage.removeItem(TOKEN_KEY);

    // Expose l'en-tête d'auth pour les autres modules (panier, commandes…).
    window.pfAuthHeader = () => {
        const t = getToken();
        return t ? { 'Authorization': 'Bearer ' + t } : {};
    };
    window.pfIsLoggedIn = () => !!getToken();

    document.addEventListener('DOMContentLoaded', () => {
        const overlay = document.getElementById('auth-overlay');
        const closeBtn = document.getElementById('auth-close');
        const errorBox = document.getElementById('auth-error');
        const tabs = document.querySelectorAll('.auth-tab');
        const panels = document.querySelectorAll('.auth-form');

        const btnAccount = document.getElementById('btn-account');
        const userProfile = document.getElementById('user-profile');
        const userName = document.getElementById('user-name');
        const userRole = document.getElementById('user-role');
        const userAvatar = document.getElementById('user-avatar');

        let currentUser = null;

        // --- UI helpers ---
        function showError(msg) { errorBox.textContent = msg; errorBox.classList.remove('display-none'); }
        function clearError() { errorBox.textContent = ''; errorBox.classList.add('display-none'); }

        function openModal(tab) { clearError(); switchTab(tab || 'login'); overlay.classList.remove('display-none'); }
        function closeModal() { overlay.classList.add('display-none'); }

        // Exposé pour les autres modules (ex: panier gate l'ajout si non connecté).
        window.pfOpenAuth = openModal;

        function switchTab(name) {
            tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-auth-tab') === name));
            panels.forEach(p => p.classList.toggle('display-none', p.getAttribute('data-auth-panel') !== name));
            clearError();
        }

        function reflectLoggedIn(user) {
            currentUser = user;
            const label = user.companyName || user.email;
            if (userName) userName.textContent = label;
            if (userRole) userRole.textContent = user.role === 'ADMIN' ? 'Administrateur' : 'Compte pro';
            if (userAvatar) userAvatar.textContent = (label || '?').trim().charAt(0).toUpperCase() || '?';
        }
        function reflectLoggedOut() {
            currentUser = null;
            if (userName) userName.textContent = 'Non connecté';
            if (userRole) userRole.textContent = 'Cliquer pour se connecter';
            if (userAvatar) userAvatar.textContent = '?';
        }

        // --- API ---
        async function api(path, body) {
            const res = await fetch(API_BASE_URL + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
            return data;
        }

        async function loadMe() {
            if (!getToken()) { reflectLoggedOut(); return; }
            try {
                const res = await fetch(API_BASE_URL + '/auth/me', { headers: window.pfAuthHeader() });
                if (!res.ok) throw new Error();
                const data = await res.json();
                reflectLoggedIn(data.user);
            } catch {
                clearToken(); // token invalide/expiré
                reflectLoggedOut();
            }
        }

        function onAuthed(data) {
            setToken(data.token);
            reflectLoggedIn(data.user);
            closeModal();
            window.dispatchEvent(new CustomEvent('pf-auth-changed', { detail: { user: data.user } }));
        }

        // --- Points d'entrée ---
        function accountClick() {
            if (currentUser) {
                // Déjà connecté : proposer la déconnexion (simple pour la Phase 1).
                if (confirm('Connecté en tant que ' + (currentUser.companyName || currentUser.email) + '.\nSe déconnecter ?')) {
                    clearToken();
                    reflectLoggedOut();
                    window.dispatchEvent(new CustomEvent('pf-auth-changed', { detail: { user: null } }));
                }
            } else {
                openModal('login');
            }
        }

        if (btnAccount) btnAccount.addEventListener('click', accountClick);
        if (userProfile) {
            userProfile.addEventListener('click', accountClick);
            userProfile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accountClick(); } });
        }
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
        tabs.forEach(t => t.addEventListener('click', () => switchTab(t.getAttribute('data-auth-tab'))));

        // --- Connexion ---
        const loginForm = document.getElementById('auth-login-form');
        if (loginForm) loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();
            const btn = document.getElementById('login-submit');
            btn.disabled = true; btn.textContent = 'Connexion…';
            try {
                const data = await api('/auth/login', {
                    email: document.getElementById('login-email').value,
                    password: document.getElementById('login-password').value,
                });
                onAuthed(data);
            } catch (err) {
                showError(err.message);
            } finally {
                btn.disabled = false; btn.textContent = 'Se connecter';
            }
        });

        // --- Inscription ---
        const regForm = document.getElementById('auth-register-form');
        if (regForm) regForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();
            const btn = document.getElementById('reg-submit');
            btn.disabled = true; btn.textContent = 'Création…';
            try {
                const data = await api('/auth/register', {
                    companyName: document.getElementById('reg-company').value,
                    email: document.getElementById('reg-email').value,
                    password: document.getElementById('reg-password').value,
                    contactName: document.getElementById('reg-contact').value,
                    phone: document.getElementById('reg-phone').value,
                    vatNumber: document.getElementById('reg-vat').value,
                });
                onAuthed(data);
            } catch (err) {
                showError(err.message);
            } finally {
                btn.disabled = false; btn.textContent = 'Créer mon compte';
            }
        });

        // Etat initial
        loadMe();
    });
})();
