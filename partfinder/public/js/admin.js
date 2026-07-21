/**
 * Panneau Administration (Phase 3) — visible uniquement pour role=ADMIN.
 * Clients : suspension, reset password (mdp temporaire affiché une fois),
 * suppression RGPD. Commandes : changement de statut.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const ORDER_STATUSES = ['PENDING_VALIDATION', 'AWAITING_PAYMENT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
    const STATUS_FR = {
        PENDING_VALIDATION: 'À valider', AWAITING_PAYMENT: 'Paiement demandé',
        PENDING: 'En attente', CONFIRMED: 'Confirmée', PROCESSING: 'En traitement',
        SHIPPED: 'Expédiée', DELIVERED: 'Livrée', CANCELLED: 'Annulée',
    };

    document.addEventListener('DOMContentLoaded', () => {
        const overlay = document.getElementById('admin-overlay');
        const navAdmin = document.getElementById('nav-admin');
        if (!overlay || !navAdmin) return;

        const errorBox = document.getElementById('admin-error');
        const successBox = document.getElementById('admin-success');
        const usersBox = document.getElementById('adm-users');
        const ordersBox = document.getElementById('adm-orders');
        const tabs = overlay.querySelectorAll('.auth-tab[data-adm-tab]');
        const panels = overlay.querySelectorAll('[data-adm-panel]');

        function showError(m) { successBox.classList.add('display-none'); errorBox.textContent = m; errorBox.classList.remove('display-none'); }
        function showSuccess(m) { errorBox.classList.add('display-none'); successBox.textContent = m; successBox.classList.remove('display-none'); }
        function clearMsg() { errorBox.classList.add('display-none'); successBox.classList.add('display-none'); }
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        // Affiche le lien Admin selon le rôle.
        window.addEventListener('pf-auth-changed', (e) => {
            const user = e.detail && e.detail.user;
            navAdmin.classList.toggle('display-none', !(user && user.role === 'ADMIN'));
        });

        navAdmin.addEventListener('click', (e) => {
            e.preventDefault();
            clearMsg();
            switchTab('clients');
            overlay.classList.remove('display-none');
            loadUsers();
        });

        document.getElementById('admin-close').addEventListener('click', () => overlay.classList.add('display-none'));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('display-none'); });

        function switchTab(name) {
            tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-adm-tab') === name));
            panels.forEach(p => p.classList.toggle('display-none', p.getAttribute('data-adm-panel') !== name));
            clearMsg();
            if (name === 'orders') loadOrders();
        }
        tabs.forEach(t => t.addEventListener('click', () => switchTab(t.getAttribute('data-adm-tab'))));

        async function api(path, options) {
            const res = await fetch(API_BASE_URL + path, Object.assign({}, options, {
                headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader(), (options && options.headers) || {}),
            }));
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
            return data;
        }

        // ── Clients ──────────────────────────────────────────────────
        function userRow(u) {
            const suspended = u.status === 'SUSPENDED';
            return `<div class="adm-row ${suspended ? 'adm-suspended' : ''}" data-uid="${u.id}">
                <div class="adm-row-main">
                    <strong>${esc(u.companyName)}</strong>
                    ${u.role === 'ADMIN' ? '<span class="acc-status st-progress">ADMIN</span>' : ''}
                    ${suspended ? '<span class="acc-status st-cancel">Suspendu</span>' : ''}
                    <div class="adm-row-meta">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''} · ${u.ordersCount || 0} commande(s)</div>
                </div>
                <div class="adm-actions">
                    <button class="adm-btn" data-act="reset" title="Réinitialiser le mot de passe"><i class="ph ph-key"></i></button>
                    <button class="adm-btn" data-act="toggle" title="${suspended ? 'Réactiver' : 'Suspendre'}"><i class="ph ${suspended ? 'ph-play' : 'ph-pause'}"></i></button>
                    <button class="adm-btn adm-btn-danger" data-act="delete" title="Supprimer (RGPD)"><i class="ph ph-trash"></i></button>
                </div>
            </div>`;
        }

        async function loadUsers() {
            usersBox.innerHTML = '<p class="acc-empty">Chargement…</p>';
            try {
                const data = await api('/admin/users', { method: 'GET' });
                const users = data.users || [];
                usersBox.innerHTML = users.length
                    ? users.map(userRow).join('')
                    : '<p class="acc-empty">Aucun client.</p>';
            } catch (e) { usersBox.innerHTML = '<p class="acc-empty">' + esc(e.message) + '</p>'; }
        }

        usersBox.addEventListener('click', async (e) => {
            const btn = e.target.closest('.adm-btn');
            if (!btn) return;
            const row = btn.closest('.adm-row');
            const uid = row.getAttribute('data-uid');
            const act = btn.getAttribute('data-act');
            const name = row.querySelector('strong').textContent;
            clearMsg();
            try {
                if (act === 'reset') {
                    if (!confirm('Réinitialiser le mot de passe de « ' + name + ' » ?')) return;
                    const data = await api('/admin/users/' + uid + '/reset-password', { method: 'POST' });
                    // Affiché une seule fois : à transmettre au client.
                    prompt('Mot de passe temporaire pour ' + data.email + ' (copiez-le, il ne sera plus affiché) :', data.tempPassword);
                    showSuccess('Mot de passe réinitialisé pour ' + data.email + '.');
                } else if (act === 'toggle') {
                    const suspended = row.classList.contains('adm-suspended');
                    await api('/admin/users/' + uid + '/status', {
                        method: 'PATCH',
                        body: JSON.stringify({ status: suspended ? 'ACTIVE' : 'SUSPENDED' }),
                    });
                    showSuccess((suspended ? 'Compte réactivé : ' : 'Compte suspendu : ') + name);
                    loadUsers();
                } else if (act === 'delete') {
                    if (!confirm('Supprimer DÉFINITIVEMENT le compte « ' + name + ' » ?\nSes commandes seront anonymisées (RGPD).')) return;
                    await api('/admin/users/' + uid, { method: 'DELETE' });
                    showSuccess('Compte supprimé : ' + name);
                    loadUsers();
                }
            } catch (err) { showError(err.message); }
        });

        // ── Commandes ────────────────────────────────────────────────
        function orderRow(o) {
            const who = o.user ? (o.user.companyName || o.user.email) : (o.contactInfo || 'Invité');
            const date = new Date(o.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
            const options = ORDER_STATUSES.map(s =>
                `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_FR[s]}</option>`).join('');
            const items = (o.items || []).map(i => esc(i.partName) + ' ×' + i.quantity).join(', ');
            const amount = Number(o.quotedAmount != null ? o.quotedAmount : o.totalAmount);
            const toValidate = o.status === 'PENDING_VALIDATION';
            const awaiting = o.status === 'AWAITING_PAYMENT';

            // Bloc de validation : fixer le prix definitif puis envoyer la demande de fonds.
            const validationHtml = (toValidate || awaiting) ? `
                <div class="adm-validate">
                    <div class="adm-validate-row">
                        <label>Prix définitif (€)
                            <input type="number" step="0.01" min="0" class="adm-price-input" value="${amount.toFixed(2)}">
                        </label>
                        <label>Note au client (optionnel)
                            <input type="text" class="adm-note-input" placeholder="Ex : port outre-mer inclus" value="${esc(o.adminNote || '')}">
                        </label>
                    </div>
                    <div class="adm-validate-actions">
                        <button class="adm-mini-btn" data-act="save-price">Enregistrer le prix</button>
                        <button class="adm-mini-btn adm-mini-primary" data-act="send-payment">
                            ${awaiting ? 'Renvoyer' : 'Envoyer'} la demande de paiement
                        </button>
                        ${o.paymentUrl ? `<a class="adm-mini-link" href="${o.paymentUrl}" target="_blank" rel="noopener">Lien de paiement</a>` : ''}
                    </div>
                </div>` : '';

            return `<div class="adm-row adm-row-order" data-oid="${o.id}">
                <div class="adm-order-head">
                    <div class="adm-row-main">
                        <strong>#${o.id}</strong> · ${esc(who)} · <span class="adm-price">${amount.toFixed(2)} €</span>
                        ${toValidate ? '<span class="acc-status st-pending">À valider</span>' : ''}
                        ${awaiting ? '<span class="acc-status st-progress">Paiement demandé</span>' : ''}
                        <div class="adm-row-meta">${date} · ${items}</div>
                        ${o.shippingAddress ? `<div class="adm-row-meta">📍 ${esc(o.shippingAddress)}</div>` : ''}
                    </div>
                    <div class="adm-actions">
                        <select class="adm-status-select">${options}</select>
                    </div>
                </div>
                ${validationHtml}
            </div>`;
        }

        async function loadOrders() {
            ordersBox.innerHTML = '<p class="acc-empty">Chargement…</p>';
            try {
                const data = await api('/admin/orders', { method: 'GET' });
                const orders = data.orders || [];
                ordersBox.innerHTML = orders.length
                    ? orders.map(orderRow).join('')
                    : '<p class="acc-empty">Aucune commande.</p>';
            } catch (e) { ordersBox.innerHTML = '<p class="acc-empty">' + esc(e.message) + '</p>'; }
        }

        // Validation : enregistrer le prix / envoyer la demande de fonds Stripe
        ordersBox.addEventListener('click', async (e) => {
            const btn = e.target.closest('.adm-mini-btn');
            if (!btn) return;
            const row = btn.closest('.adm-row-order');
            const oid = row.getAttribute('data-oid');
            const act = btn.getAttribute('data-act');
            const priceInput = row.querySelector('.adm-price-input');
            const noteInput = row.querySelector('.adm-note-input');
            clearMsg();
            btn.disabled = true;
            try {
                const pricePayload = JSON.stringify({
                    quotedAmount: Number(priceInput.value),
                    adminNote: noteInput.value.trim() || null,
                });
                if (act === 'save-price') {
                    await api('/admin/orders/' + oid + '/price', { method: 'PATCH', body: pricePayload });
                    showSuccess('Prix définitif enregistré pour la commande #' + oid + '.');
                    loadOrders();
                } else if (act === 'send-payment') {
                    // On enregistre d'abord le prix affiché, puis on génère le lien.
                    await api('/admin/orders/' + oid + '/price', { method: 'PATCH', body: pricePayload });
                    const data = await api('/admin/orders/' + oid + '/payment-link', { method: 'POST' });
                    showSuccess('Demande de paiement envoyée au client (commande #' + oid + ').');
                    if (data.paymentUrl) window.open(data.paymentUrl, '_blank', 'noopener');
                    loadOrders();
                }
            } catch (err) {
                showError(err.message);
            } finally {
                btn.disabled = false;
            }
        });

        ordersBox.addEventListener('change', async (e) => {
            const sel = e.target.closest('.adm-status-select');
            if (!sel) return;
            const oid = sel.closest('.adm-row').getAttribute('data-oid');
            clearMsg();
            try {
                await api('/admin/orders/' + oid + '/status', {
                    method: 'PATCH',
                    body: JSON.stringify({ status: sel.value }),
                });
                showSuccess('Commande #' + oid + ' → ' + STATUS_FR[sel.value] + '.');
            } catch (err) { showError(err.message); loadOrders(); }
        });
    });
})();
