/**
 * Écran entrepôt (opérateur) — réception, pesée, consolidation.
 * Pensé pour un usage au téléphone, un colis dans les mains : gros champs,
 * peu d'étapes, photo prise directement depuis l'appareil.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const STATUT_FR = {
        EXPECTED: 'Attendu', RECEIVED: 'Reçu', WEIGHED: 'Pesé',
        ISSUE: 'Litige', CONSOLIDATED: 'Consolidé', SHIPPED: 'Expédié',
    };

    document.addEventListener('DOMContentLoaded', () => {
        const panel = document.querySelector('[data-adm-panel="warehouse"]');
        if (!panel) return;

        const listBox = $('wh-parcels');
        const weighPanel = $('wh-weigh-panel');
        let statut = 'EXPECTED';
        let selection = new Set();
        let currentParcel = null;
        let photos = []; // base64 compressées

        async function api(path, options) {
            const res = await fetch(API_BASE_URL + path, Object.assign({}, options, {
                headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader(), (options && options.headers) || {}),
            }));
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
            return data;
        }

        // Exposé pour l'onglet admin.
        window.pfLoadWarehouse = loadParcels;

        // ── Liste ────────────────────────────────────────────────────
        function parcelRow(p) {
            const who = p.user ? (p.user.companyName || p.user.email) : '—';
            const date = p.receivedAt ? new Date(p.receivedAt).toLocaleDateString('fr-FR') : '';
            const selectable = p.statut === 'WEIGHED';
            return `<div class="wh-parcel" data-pid="${p.id}">
                ${selectable ? `<input type="checkbox" class="wh-select" ${selection.has(p.id) ? 'checked' : ''}>` : '<span class="wh-spacer"></span>'}
                <div class="wh-parcel-main">
                    <strong>${esc(p.trackingNumber || 'sans suivi')}</strong>
                    <span class="acc-status ${p.statut === 'ISSUE' ? 'st-cancel' : p.statut === 'WEIGHED' ? 'st-done' : 'st-pending'}">${STATUT_FR[p.statut] || p.statut}</span>
                    ${!p.annonce ? '<span class="acc-status st-pending">Non annoncé</span>' : ''}
                    <div class="adm-row-meta">${esc(who)}${p.orderId ? ` · commande #${p.orderId}` : ''}${date ? ` · reçu le ${date}` : ''}${p.poidsReelKg ? ` · ${Number(p.poidsReelKg)} kg` : ''}</div>
                </div>
                ${p.statut === 'RECEIVED' || p.statut === 'EXPECTED'
                    ? '<button class="wh-btn wh-btn-sm" data-act="weigh">Peser</button>' : ''}
            </div>`;
        }

        async function loadParcels() {
            listBox.innerHTML = '<p class="acc-empty">Chargement…</p>';
            const q = $('wh-search').value.trim();
            try {
                const data = await api(`/warehouse/parcels?statut=${statut}${q ? '&q=' + encodeURIComponent(q) : ''}`, { method: 'GET' });
                const list = data.parcels || [];
                listBox.innerHTML = list.length ? list.map(parcelRow).join('')
                    : '<p class="acc-empty">Aucun colis dans cette catégorie.</p>';
                refreshConsolidateBar();
            } catch (e) { listBox.innerHTML = `<p class="acc-empty">${esc(e.message)}</p>`; }
        }

        panel.querySelectorAll('.wh-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                panel.querySelectorAll('.wh-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                statut = chip.getAttribute('data-wh-statut');
                selection.clear();
                loadParcels();
            });
        });
        let searchTimer;
        $('wh-search').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadParcels, 350);
        });

        // ── Réception ────────────────────────────────────────────────
        $('wh-receive').addEventListener('click', async () => {
            const box = $('wh-receive-result');
            const tracking = $('wh-tracking').value.trim();
            if (!tracking) return;
            box.innerHTML = '<p class="acc-empty">Recherche…</p>';
            try {
                const data = await api('/warehouse/receive', { method: 'POST', body: JSON.stringify({ tracking }) });
                box.innerHTML = `<div class="wh-ok">✓ Colis reçu — ${esc(data.parcel.user?.companyName || '')}
                    ${data.nonAnnonce ? '<strong> (non annoncé : supplément appliqué)</strong>' : ''}</div>`;
                $('wh-tracking').value = '';
                openWeigh(data.parcel);
                loadParcels();
            } catch (e) {
                // Colis inconnu : il faut désigner le client.
                box.innerHTML = `<div class="wh-warn">${esc(e.message)}</div>`;
            }
        });

        // ── Pesée ────────────────────────────────────────────────────
        listBox.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-act="weigh"]');
            if (btn) {
                const pid = Number(btn.closest('.wh-parcel').getAttribute('data-pid'));
                const data = await api(`/warehouse/parcels?statut=${statut}`, { method: 'GET' });
                const p = (data.parcels || []).find(x => x.id === pid);
                if (p) openWeigh(p);
                return;
            }
            const cb = e.target.closest('.wh-select');
            if (cb) {
                const pid = Number(cb.closest('.wh-parcel').getAttribute('data-pid'));
                if (cb.checked) selection.add(pid); else selection.delete(pid);
                refreshConsolidateBar();
            }
        });

        function openWeigh(parcel) {
            currentParcel = parcel;
            photos = [];
            $('wh-weigh-title').textContent = 'Pesée — ' + (parcel.trackingNumber || 'colis #' + parcel.id);
            $('wh-poids').value = '';
            ['wh-l', 'wh-w', 'wh-h', 'wh-notes'].forEach(id => { $(id).value = ''; });
            $('wh-photo-preview').innerHTML = '';
            $('wh-weigh-error').classList.add('display-none');
            weighPanel.classList.remove('display-none');
        }
        $('wh-weigh-back').addEventListener('click', () => weighPanel.classList.add('display-none'));

        /**
         * Compression avant envoi : une photo brute de téléphone pèse plusieurs Mo.
         * Redimensionnée à 1000 px / JPEG 0.7, elle tombe à ~150 Ko — indispensable
         * puisqu'elle est stockée en base (pas de stockage objet configuré).
         */
        function compress(file) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const max = 1000;
                    const ratio = Math.min(1, max / Math.max(img.width, img.height));
                    const c = document.createElement('canvas');
                    c.width = Math.round(img.width * ratio);
                    c.height = Math.round(img.height * ratio);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', 0.7));
                };
                img.onerror = reject;
                img.src = URL.createObjectURL(file);
            });
        }

        $('wh-photos').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []).slice(0, 4);
            const box = $('wh-photo-preview');
            box.innerHTML = '<p class="acc-empty">Compression…</p>';
            try {
                photos = await Promise.all(files.map(compress));
                box.innerHTML = photos.map(p => `<img src="${p}" alt="">`).join('');
            } catch { box.innerHTML = '<p class="acc-empty">Échec du traitement des photos.</p>'; }
        });

        $('wh-weigh-submit').addEventListener('click', async () => {
            const err = $('wh-weigh-error');
            err.classList.add('display-none');
            const poids = Number($('wh-poids').value);
            if (!(poids > 0)) { err.textContent = 'Saisissez le poids réel.'; err.classList.remove('display-none'); return; }
            if (photos.length < 1) { err.textContent = 'Au moins une photo est requise.'; err.classList.remove('display-none'); return; }

            const btn = $('wh-weigh-submit');
            btn.disabled = true;
            try {
                const data = await api(`/warehouse/parcels/${currentParcel.id}/weigh`, {
                    method: 'POST',
                    body: JSON.stringify({
                        poidsReelKg: poids,
                        longueurCm: $('wh-l').value || null,
                        largeurCm: $('wh-w').value || null,
                        hauteurCm: $('wh-h').value || null,
                        photos,
                        notes: $('wh-notes').value.trim() || null,
                    }),
                });
                weighPanel.classList.add('display-none');
                const box = $('wh-receive-result');
                if (data.horsNormes) {
                    box.innerHTML = `<div class="wh-warn"><strong>Colis hors normes</strong><br>${esc(data.raison || '')}<br>${esc(data.message || '')}</div>`;
                } else if (data.paymentRequest) {
                    box.innerHTML = `<div class="wh-warn"><strong>Écart significatif</strong><br>
                        Complément de ${Number(data.paymentRequest.montantEur).toFixed(2)} € demandé au client.<br>
                        ${esc(data.message || '')}</div>`;
                } else {
                    box.innerHTML = `<div class="wh-ok">✓ ${esc(data.message || 'Colis pesé.')}</div>`;
                }
                loadParcels();
            } catch (e) {
                err.textContent = e.message; err.classList.remove('display-none');
            } finally { btn.disabled = false; }
        });

        // ── Consolidation ────────────────────────────────────────────
        function refreshConsolidateBar() {
            const bar = $('wh-consolidate-bar');
            if (selection.size >= 2) {
                $('wh-selected-count').textContent = `${selection.size} colis sélectionnés`;
                bar.classList.remove('display-none');
            } else bar.classList.add('display-none');
        }

        $('wh-consolidate').addEventListener('click', async () => {
            const box = $('wh-receive-result');
            try {
                const data = await api('/warehouse/consolidate', {
                    method: 'POST', body: JSON.stringify({ parcelIds: [...selection] }),
                });
                box.innerHTML = `<div class="wh-ok">✓ Consolidation créée — ${data.poidsConsolide} kg (emballage inclus),
                    acheminement ${Number(data.portEur).toFixed(2)} € + forfait ${Number(data.forfaitConsolidationEur).toFixed(2)} €</div>`;
                selection.clear();
                loadParcels();
            } catch (e) {
                box.innerHTML = `<div class="wh-warn">${esc(e.message)}</div>`;
            }
        });
    });
})();
