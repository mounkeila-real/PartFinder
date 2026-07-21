/**
 * Tunnel d'achat — collecte l'adresse de livraison puis redirige vers la page
 * de paiement Stripe. Le paiement est confirmé côté serveur (webhook).
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    document.addEventListener('DOMContentLoaded', () => {
        const overlay = $('checkout-overlay');
        if (!overlay) return;
        const form = $('checkout-form');
        const errorBox = $('checkout-error');
        const summary = $('checkout-summary');
        const totalSpan = $('co-total');
        const payBtn = $('co-pay');

        let items = [];

        function total() { return items.reduce((s, i) => s + Number(i.priceSold) * Number(i.quantity || 1), 0); }

        // Ouvre le tunnel avec les articles du panier (appelé par app.js).
        window.pfCheckout = function (cartItems) {
            items = cartItems || [];
            errorBox.classList.add('display-none');
            summary.innerHTML = items.map(i =>
                `<div class="co-line"><span>${esc(i.partName)} × ${i.quantity || 1}</span><span>${(i.priceSold * (i.quantity || 1)).toFixed(2)} €</span></div>`
            ).join('') + `<div class="co-line co-line-total"><span>Total TTC</span><strong>${total().toFixed(2)} €</strong></div>`;
            totalSpan.textContent = '';
            payBtn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i> Envoyer ma demande';
            overlay.classList.remove('display-none');
        };

        function close() { overlay.classList.add('display-none'); }
        $('checkout-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorBox.classList.add('display-none');
            const address = $('co-address').value.trim();
            if (!address) { errorBox.textContent = 'Adresse de livraison requise.'; errorBox.classList.remove('display-none'); return; }

            payBtn.disabled = true;
            payBtn.innerHTML = '<i class="ph ph-circle-notch"></i> Envoi…';
            try {
                // Demande de commande : le montant définitif est arrêté après vérification.
                const res = await fetch(API_BASE_URL + '/checkout/request', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader ? window.pfAuthHeader() : {}),
                    body: JSON.stringify({ items, shippingAddress: address, poReference: $('co-poref').value.trim() }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Impossible d\'envoyer la demande.');
                close();
                showBanner('success',
                    'Demande n°' + data.orderId + ' envoyée. Nous vérifions la disponibilité et l\'acheminement, '
                    + 'puis vous recevrez le montant définitif à régler (sous 24 h ouvrées). Aucun débit avant votre accord.');
                if (window.pfClearCart) window.pfClearCart();
            } catch (err) {
                errorBox.textContent = err.message;
                errorBox.classList.remove('display-none');
            } finally {
                payBtn.disabled = false;
                payBtn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i> Envoyer ma demande';
            }
        });

        // ── Retour de Stripe ─────────────────────────────────────────
        const params = new URLSearchParams(location.search);
        if (params.get('paid') === '1') {
            showBanner('success', '✓ Paiement reçu — votre commande #' + (params.get('order') || '') + ' est confirmée. Retrouvez-la dans « Mon compte ».');
            cleanUrl();
        } else if (params.get('canceled') === '1') {
            showBanner('info', 'Paiement annulé. Votre commande #' + (params.get('order') || '') + ' est en attente ; vous pouvez la régler depuis « Mon compte ».');
            cleanUrl();
        }

        function cleanUrl() { history.replaceState({}, '', location.pathname); }

        function showBanner(kind, msg) {
            const b = document.createElement('div');
            b.className = 'pf-banner pf-banner-' + kind;
            b.innerHTML = '<span>' + esc(msg) + '</span><button aria-label="Fermer">✕</button>';
            document.body.appendChild(b);
            b.querySelector('button').addEventListener('click', () => b.remove());
            setTimeout(() => b.remove(), 12000);
        }
    });
})();
