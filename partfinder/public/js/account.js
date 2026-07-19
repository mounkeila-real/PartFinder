/**
 * Espace client (Phase 2) — panneau Mon compte :
 * commandes (en cours + historique), profil, mot de passe, suppression RGPD.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const STATUS_LABELS = {
        PENDING: ['En attente', 'st-pending'],
        CONFIRMED: ['Confirmée', 'st-progress'],
        PROCESSING: ['En traitement', 'st-progress'],
        SHIPPED: ['Expédiée', 'st-progress'],
        DELIVERED: ['Livrée', 'st-done'],
        CANCELLED: ['Annulée', 'st-cancel'],
    };
    const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'];

    document.addEventListener('DOMContentLoaded', () => {
        const overlay = document.getElementById('account-overlay');
        if (!overlay) return;

        const closeBtn = document.getElementById('account-close');
        const errorBox = document.getElementById('account-error');
        const successBox = document.getElementById('account-success');
        const tabs = overlay.querySelectorAll('.auth-tab[data-acc-tab]');
        const panels = overlay.querySelectorAll('[data-acc-panel]');
        const ordersBox = document.getElementById('acc-orders');

        let currentUser = null;

        function showError(m) { successBox.classList.add('display-none'); errorBox.textContent = m; errorBox.classList.remove('display-none'); }
        function showSuccess(m) { errorBox.classList.add('display-none'); successBox.textContent = m; successBox.classList.remove('display-none'); }
        function clearMsg() { errorBox.classList.add('display-none'); successBox.classList.add('display-none'); }

        function switchTab(name) {
            tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-acc-tab') === name));
            panels.forEach(p => p.classList.toggle('display-none', p.getAttribute('data-acc-panel') !== name));
            clearMsg();
        }
        tabs.forEach(t => t.addEventListener('click', () => switchTab(t.getAttribute('data-acc-tab'))));

        function close() { overlay.classList.add('display-none'); }
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        async function api(path, options) {
            const res = await fetch(API_BASE_URL + path, Object.assign({
                headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader()),
            }, options, {
                headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader(), (options && options.headers) || {}),
            }));
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
            return data;
        }

        // ── Ouverture du panneau ─────────────────────────────────────
        window.pfOpenAccount = function (user) {
            currentUser = user || currentUser;
            clearMsg();
            switchTab('orders');
            fillProfile();
            loadOrders();
            overlay.classList.remove('display-none');
        };

        function fillProfile() {
            if (!currentUser) return;
            document.getElementById('account-title').textContent = currentUser.companyName || 'Mon compte';
            document.getElementById('acc-company').value = currentUser.companyName || '';
            document.getElementById('acc-contact').value = currentUser.contactName || '';
            document.getElementById('acc-phone').value = currentUser.phone || '';
            document.getElementById('acc-vat').value = currentUser.vatNumber || '';
        }

        // ── Commandes ────────────────────────────────────────────────
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        function orderCard(o) {
            const [label, cls] = STATUS_LABELS[o.status] || [o.status, 'st-pending'];
            const date = new Date(o.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
            const items = (o.items || []).map(i =>
                `<div class="acc-order-item"><span>${esc(i.partName)} × ${i.quantity}</span><span>${(i.priceSold * i.quantity).toFixed(2)} €</span></div>`
            ).join('');
            return `<div class="acc-order">
                <div class="acc-order-head">
                    <strong>Commande #${o.id}</strong>
                    <span class="acc-status ${cls}">${esc(label)}</span>
                </div>
                <div class="acc-order-meta">${date}</div>
                ${items}
                <div class="acc-order-total"><span>Total TTC</span><strong>${Number(o.totalAmount).toFixed(2)} €</strong></div>
            </div>`;
        }

        async function loadOrders() {
            ordersBox.innerHTML = '<p class="acc-empty">Chargement…</p>';
            try {
                const data = await api('/orders/mine', { method: 'GET' });
                const orders = data.orders || [];
                if (!orders.length) {
                    ordersBox.innerHTML = '<p class="acc-empty">Aucune commande pour le moment.</p>';
                    return;
                }
                const open = orders.filter(o => OPEN_STATUSES.includes(o.status));
                const past = orders.filter(o => !OPEN_STATUSES.includes(o.status));
                let html = '';
                if (open.length) html += `<h3 class="acc-sub">En cours (${open.length})</h3>` + open.map(orderCard).join('');
                if (past.length) html += `<h3 class="acc-sub">Historique (${past.length})</h3>` + past.map(orderCard).join('');
                ordersBox.innerHTML = html;
            } catch (e) {
                ordersBox.innerHTML = '<p class="acc-empty">Impossible de charger les commandes.</p>';
            }
        }

        // ── Profil ───────────────────────────────────────────────────
        document.getElementById('acc-profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            clearMsg();
            try {
                const data = await api('/auth/profile', {
                    method: 'PATCH',
                    body: JSON.stringify({
                        companyName: document.getElementById('acc-company').value,
                        contactName: document.getElementById('acc-contact').value,
                        phone: document.getElementById('acc-phone').value,
                        vatNumber: document.getElementById('acc-vat').value,
                    }),
                });
                currentUser = data.user;
                fillProfile();
                window.dispatchEvent(new CustomEvent('pf-auth-changed', { detail: { user: data.user } }));
                showSuccess('Profil mis à jour.');
            } catch (err) { showError(err.message); }
        });

        // ── Mot de passe ─────────────────────────────────────────────
        document.getElementById('acc-password-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            clearMsg();
            try {
                await api('/auth/change-password', {
                    method: 'POST',
                    body: JSON.stringify({
                        currentPassword: document.getElementById('acc-pwd-current').value,
                        newPassword: document.getElementById('acc-pwd-new').value,
                    }),
                });
                e.target.reset();
                showSuccess('Mot de passe modifié.');
            } catch (err) { showError(err.message); }
        });

        // ── Suppression de compte (RGPD) ─────────────────────────────
        document.getElementById('acc-delete').addEventListener('click', async () => {
            clearMsg();
            const pwd = prompt('Pour confirmer la suppression DÉFINITIVE de votre compte, saisissez votre mot de passe :');
            if (pwd === null) return;
            if (!confirm('Dernière confirmation : votre compte sera supprimé et vos commandes anonymisées. Continuer ?')) return;
            try {
                await api('/auth/account', { method: 'DELETE', body: JSON.stringify({ password: pwd }) });
                localStorage.removeItem('pf_token');
                close();
                window.dispatchEvent(new CustomEvent('pf-auth-changed', { detail: { user: null } }));
                alert('Votre compte a été supprimé.');
                location.reload();
            } catch (err) { showError(err.message); }
        });

        // ── Déconnexion ──────────────────────────────────────────────
        document.getElementById('acc-logout').addEventListener('click', () => {
            localStorage.removeItem('pf_token');
            close();
            window.dispatchEvent(new CustomEvent('pf-auth-changed', { detail: { user: null } }));
            location.reload();
        });
    });
})();
