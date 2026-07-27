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
        let territoires = [];

        function total() { return items.reduce((s, i) => s + Number(i.priceSold) * Number(i.quantity || 1), 0); }

        // ── Territoires ──────────────────────────────────────────────
        // Référentiel chargé depuis le backend : le dupliquer ici finirait par
        // diverger de celui qui sert au calcul du tarif d'acheminement.
        async function loadTerritoires() {
            if (territoires.length) return;
            try {
                const r = await fetch(API_BASE_URL + '/parts/territoires');
                const d = await r.json();
                territoires = d.territoires || [];
                const sel = $('co-territoire');
                sel.innerHTML = '<option value="">— Sélectionner —</option>' +
                    territoires.map(t => `<option value="${esc(t.code)}">${esc(t.label)}</option>`).join('');
            } catch { /* le champ reste vide : la validation serveur bloquera */ }
        }

        // Déduit le territoire du code postal (971xx → Guadeloupe…).
        function autoTerritoire() {
            const cp = $('co-cp').value.replace(/\s/g, '');
            if (!/^\d{5}$/.test(cp)) return;
            const t = territoires.find(x => (x.prefixes || []).some(p => cp.startsWith(p)));
            if (t) { $('co-territoire').value = t.code; showZone(); }
        }

        function showZone() {
            const code = $('co-territoire').value;
            const t = territoires.find(x => x.code === code);
            $('co-zone-hint').textContent = t
                ? `Acheminement zone ${t.zone}` : '';
        }

        // ── Adresses enregistrées ────────────────────────────────────
        async function loadSaved() {
            const box = $('co-saved');
            const sel = $('co-saved-select');
            box.classList.add('display-none');
            if (!window.pfAuthHeader) return;
            try {
                const r = await fetch(API_BASE_URL + '/orders/my-addresses', { headers: window.pfAuthHeader() });
                if (!r.ok) return;
                const d = await r.json();
                const list = d.addresses || [];
                if (!list.length) return;
                sel.innerHTML = '<option value="">— Nouvelle adresse —</option>' +
                    list.map(a => `<option value="${a.id}">${esc(a.destinataire)} — ${esc(a.ville)} (${esc(a.codePostal)})</option>`).join('');
                sel.onchange = () => {
                    const a = list.find(x => String(x.id) === sel.value);
                    if (!a) return;
                    $('co-destinataire').value = a.destinataire || '';
                    $('co-ligne1').value = a.ligne1 || '';
                    $('co-ligne2').value = a.ligne2 || '';
                    $('co-cp').value = a.codePostal || '';
                    $('co-ville').value = a.ville || '';
                    $('co-territoire').value = a.territoire || '';
                    $('co-tel').value = a.telephone || '';
                    showZone();
                };
                box.classList.remove('display-none');
                // Pré-remplit avec l'adresse par défaut.
                sel.value = String(list[0].id);
                sel.onchange();
            } catch { /* sans adresse enregistrée, le formulaire reste vierge */ }
        }

        $('co-cp').addEventListener('blur', autoTerritoire);
        $('co-cp').addEventListener('input', () => { if ($('co-cp').value.length === 5) autoTerritoire(); });
        $('co-territoire').addEventListener('change', showZone);

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
            loadTerritoires().then(loadSaved);
        };

        function close() { overlay.classList.add('display-none'); }
        $('checkout-close').addEventListener('click', close);
        window.pfCloseOnBackdrop(overlay, close);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorBox.classList.add('display-none');

            const address = {
                destinataire: $('co-destinataire').value.trim(),
                ligne1: $('co-ligne1').value.trim(),
                ligne2: $('co-ligne2').value.trim() || null,
                codePostal: $('co-cp').value.replace(/\s/g, ''),
                ville: $('co-ville').value.trim(),
                territoire: $('co-territoire').value,
                telephone: $('co-tel').value.trim(),
            };
            if (!address.territoire) {
                errorBox.textContent = 'Sélectionnez le territoire de livraison.';
                errorBox.classList.remove('display-none');
                return;
            }

            payBtn.disabled = true;
            payBtn.innerHTML = '<i class="ph ph-circle-notch"></i> Envoi…';
            try {
                // Demande de commande : le montant définitif est arrêté après vérification.
                const res = await fetch(API_BASE_URL + '/checkout/request', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader ? window.pfAuthHeader() : {}),
                    body: JSON.stringify({ items, address, poReference: $('co-poref').value.trim() }),
                });
                const data = await res.json();
                if (!res.ok) {
                    // Le serveur renvoie le détail par champ (code postal
                    // incohérent avec le territoire, téléphone manquant…).
                    throw new Error((data.erreurs && data.erreurs.join(' ')) || data.error || 'Impossible d\'envoyer la demande.');
                }
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
