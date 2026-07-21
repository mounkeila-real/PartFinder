/**
 * Espace client (Phase 2) — panneau Mon compte :
 * commandes (en cours + historique), profil, mot de passe, suppression RGPD.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const STATUS_LABELS = {
        PENDING_VALIDATION: ['En cours de validation', 'st-pending'],
        AWAITING_PAYMENT: ['À régler', 'st-pending'],
        PENDING: ['En attente', 'st-pending'],
        CONFIRMED: ['Confirmée', 'st-progress'],
        PROCESSING: ['En traitement', 'st-progress'],
        SHIPPED: ['Expédiée', 'st-progress'],
        DELIVERED: ['Livrée', 'st-done'],
        CANCELLED: ['Annulée', 'st-cancel'],
    };
    const OPEN_STATUSES = ['PENDING_VALIDATION', 'AWAITING_PAYMENT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'];

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
            if (name === 'parcels') loadParcels();
            if (name === 'payments') loadPayments();
        }

        // ── Paiements en attente (appels de fonds) ───────────────────
        async function loadPayments() {
            const box = document.getElementById('acc-payments');
            box.innerHTML = '<p class="acc-empty">Chargement…</p>';
            try {
                const data = await api('/payment-requests/mine', { method: 'GET' });
                const all = data.requests || [];
                updatePayBadge(all);

                if (!all.length) {
                    box.innerHTML = '<p class="acc-empty">Aucun paiement complémentaire.</p>';
                    return;
                }

                const pending = all.filter(r => r.statut === 'PENDING');
                const others = all.filter(r => r.statut !== 'PENDING');
                const STATUT_FR = { PAID: 'Réglé', CANCELLED: 'Annulé', REFUSED: 'Contesté' };

                const card = (r) => {
                    const date = new Date(r.createdAt).toLocaleDateString('fr-FR');
                    const photos = (r.photos || []).length
                        ? `<div class="pk-photos">${r.photos.map(u => `<img src="${u}" alt="Photo du colis">`).join('')}</div>` : '';
                    const actions = r.statut === 'PENDING' ? `
                        <button class="acc-pay-btn" data-pr-pay="${r.id}">
                            <i class="ph ph-lock-simple"></i> Régler ${r.montantEur.toFixed(2)} €
                        </button>
                        ${r.refusable ? `<button class="pr-refuse" data-pr-refuse="${r.id}">Contester ce complément</button>` : ''}` : '';
                    return `<div class="acc-order">
                        <div class="acc-order-head">
                            <strong>${esc(r.motifLabel)}${r.orderId ? ` — commande #${r.orderId}` : ''}</strong>
                            <span class="acc-status ${r.statut === 'PENDING' ? 'st-pending' : r.statut === 'PAID' ? 'st-done' : 'st-cancel'}">
                                ${r.statut === 'PENDING' ? 'À régler' : (STATUT_FR[r.statut] || r.statut)}</span>
                        </div>
                        <div class="acc-order-meta">${date}</div>
                        ${r.detail ? `<p class="acc-order-notice">${esc(r.detail)}</p>` : ''}
                        ${photos}
                        <div class="acc-order-total"><span>Montant</span><strong>${r.montantEur.toFixed(2)} €</strong></div>
                        ${actions}
                    </div>`;
                };

                box.innerHTML =
                    (pending.length ? `<h3 class="acc-sub">À régler (${pending.length})</h3>` + pending.map(card).join('') : '')
                    + (others.length ? `<h3 class="acc-sub">Historique</h3>` + others.map(card).join('') : '');
            } catch (e) {
                box.innerHTML = `<p class="acc-empty">${esc(e.message)}</p>`;
            }
        }

        function updatePayBadge(requests) {
            const badge = document.getElementById('acc-pay-badge');
            if (!badge) return;
            const n = (requests || []).filter(r => r.statut === 'PENDING').length;
            badge.textContent = n;
            badge.classList.toggle('display-none', n === 0);
        }

        document.getElementById('acc-payments').addEventListener('click', async (e) => {
            const payBtn = e.target.closest('[data-pr-pay]');
            const refuseBtn = e.target.closest('[data-pr-refuse]');
            clearMsg();
            try {
                if (payBtn) {
                    payBtn.disabled = true;
                    const data = await api('/payment-requests/' + payBtn.getAttribute('data-pr-pay') + '/pay', {
                        method: 'POST', body: JSON.stringify({}),
                    });
                    if (data.url) window.location.href = data.url; // page de paiement sécurisée
                } else if (refuseBtn) {
                    if (!confirm('Contester ce complément ?\nVotre commande passera en traitement manuel : notre équipe vous contactera pour un retour ou un remboursement partiel.')) return;
                    refuseBtn.disabled = true;
                    const data = await api('/payment-requests/' + refuseBtn.getAttribute('data-pr-refuse') + '/refuse', {
                        method: 'POST', body: JSON.stringify({}),
                    });
                    showSuccess(data.message || 'Refus enregistré.');
                    loadPayments();
                }
            } catch (err) {
                showError(err.message);
                if (payBtn) payBtn.disabled = false;
                if (refuseBtn) refuseBtn.disabled = false;
            }
        });

        // ── Suivi des colis (vocabulaire neutre) ─────────────────────
        const ETAPE_FR = {
            EXPECTED: 'En attente de réception',
            RECEIVED: 'Reçu à notre entrepôt',
            WEIGHED: 'Contrôlé et pesé',
            CONSOLIDATED: 'Regroupé pour expédition',
            SHIPPED: 'Expédié',
            ISSUE: 'En cours de traitement',
        };

        async function loadParcels() {
            const box = document.getElementById('acc-parcels');
            box.innerHTML = '<p class="acc-empty">Chargement…</p>';
            try {
                const data = await api('/orders/my-parcels', { method: 'GET' });
                const parcels = data.parcels || [];
                const shipments = data.shipments || [];

                if (!parcels.length && !shipments.length) {
                    box.innerHTML = '<p class="acc-empty">Aucun colis en cours.</p>';
                    return;
                }

                const etapes = (p) => {
                    const done = (ok) => ok ? '✓' : '○';
                    return `<div class="pk-steps">
                        <span class="${p.recuLe ? 'pk-done' : ''}">${done(!!p.recuLe)} Reçu</span>
                        <span class="${p.peseLe ? 'pk-done' : ''}">${done(!!p.peseLe)} Contrôlé</span>
                        <span class="${p.etape === 'SHIPPED' ? 'pk-done' : ''}">${done(p.etape === 'SHIPPED')} Expédié</span>
                    </div>`;
                };

                const photos = (p) => (p.photos || []).length
                    ? `<div class="pk-photos">${p.photos.map(u => `<img src="${u}" alt="Photo du colis">`).join('')}</div>`
                    : '';

                const parcelsHtml = parcels.map(p => `
                    <div class="acc-order">
                        <div class="acc-order-head">
                            <strong>Colis ${p.orderId ? `— commande #${p.orderId}` : `#${p.id}`}</strong>
                            <span class="acc-status ${p.etape === 'SHIPPED' ? 'st-done' : p.etape === 'ISSUE' ? 'st-cancel' : 'st-progress'}">${ETAPE_FR[p.etape] || p.etape}</span>
                        </div>
                        ${etapes(p)}
                        ${p.poidsKg ? `<div class="acc-order-meta">Poids constaté : ${p.poidsKg} kg</div>` : ''}
                        ${photos(p)}
                    </div>`).join('');

                const shipHtml = shipments.filter(s => s.tracking).map(s => `
                    <div class="acc-order">
                        <div class="acc-order-head">
                            <strong>Expédition ${s.orderId ? `— commande #${s.orderId}` : `#${s.id}`}</strong>
                            <span class="acc-status st-done">Expédiée</span>
                        </div>
                        <div class="acc-order-meta">${s.expedieLe ? new Date(s.expedieLe).toLocaleDateString('fr-FR') : ''} · ${s.poidsKg || '—'} kg</div>
                        <a class="acc-pay-btn" href="https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(s.tracking)}" target="_blank" rel="noopener">
                            <i class="ph ph-truck"></i> Suivre mon colis (${esc(s.tracking)})
                        </a>
                    </div>`).join('');

                box.innerHTML = (shipHtml ? `<h3 class="acc-sub">Expéditions</h3>${shipHtml}` : '')
                    + (parcelsHtml ? `<h3 class="acc-sub">À l'entrepôt</h3>${parcelsHtml}` : '');
            } catch (e) {
                box.innerHTML = `<p class="acc-empty">${esc(e.message)}</p>`;
            }
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
            // Badge « paiements en attente » visible dès l'ouverture.
            api('/payment-requests/mine', { method: 'GET' })
                .then(d => updatePayBadge(d.requests))
                .catch(() => {});
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
            const amount = Number(o.quotedAmount != null ? o.quotedAmount : o.totalAmount);
            const isValidation = o.status === 'PENDING_VALIDATION';
            const toPay = o.status === 'AWAITING_PAYMENT' && o.paymentUrl;

            const noticeHtml = isValidation
                ? `<p class="acc-order-notice">Nous vérifions la disponibilité et l'acheminement. Vous recevrez le montant définitif à régler sous 24 h ouvrées — aucun débit sans votre accord.</p>`
                : '';
            const noteHtml = o.adminNote ? `<p class="acc-order-notice">${esc(o.adminNote)}</p>` : '';
            const payHtml = toPay
                ? `<a class="acc-pay-btn" href="${o.paymentUrl}" target="_blank" rel="noopener"><i class="ph ph-lock-simple"></i> Régler ${amount.toFixed(2)} €</a>`
                : '';

            return `<div class="acc-order">
                <div class="acc-order-head">
                    <strong>Commande #${o.id}</strong>
                    <span class="acc-status ${cls}">${esc(label)}</span>
                </div>
                <div class="acc-order-meta">${date}</div>
                ${items}
                <div class="acc-order-total">
                    <span>${isValidation ? 'Montant indicatif' : 'Total TTC'}</span>
                    <strong>${amount.toFixed(2)} €</strong>
                </div>
                ${noteHtml}
                ${noticeHtml}
                ${payHtml}
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
