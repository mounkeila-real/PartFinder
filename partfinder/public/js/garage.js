/**
 * Mon garage — enregistrer un véhicule identifié et retrouver ceux du compte.
 * Lit/écrit les champs véhicule du DOM (pas d'accès à l'état interne d'app.js).
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const $ = (id) => document.getElementById(id);
    const val = (id) => { const el = $(id); return el ? el.value.trim() : ''; };
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    document.addEventListener('DOMContentLoaded', () => {
        const overlay = $('garage-overlay');
        const listBox = $('garage-list');
        const errorBox = $('garage-error');
        const navGarage = $('nav-garage');
        const btnSave = $('btn-save-vehicle');
        if (!overlay) return;

        async function api(path, options) {
            const res = await fetch(API_BASE_URL + path, Object.assign({}, options, {
                headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader(), (options && options.headers) || {}),
            }));
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
            return data;
        }

        function requireLogin() {
            if (window.pfIsLoggedIn && window.pfIsLoggedIn()) return true;
            if (window.pfOpenAuth) window.pfOpenAuth('login');
            return false;
        }

        // ── Enregistrer le véhicule courant ──────────────────────────
        function currentVehicle() {
            return {
                vin: val('vin'),
                plate: '',
                make: val('make'),
                model: (($('model') || {}).value || '').trim(),
                year: val('year'),
                engine: val('engine'),
            };
        }

        btnSave.addEventListener('click', async () => {
            if (!requireLogin()) return;
            const v = currentVehicle();
            if (!v.vin && !v.make) {
                alert('Identifiez d\'abord un véhicule (VIN ou marque/modèle) avant de l\'enregistrer.');
                return;
            }
            btnSave.disabled = true;
            try {
                await api('/garage', { method: 'POST', body: JSON.stringify(v) });
                btnSave.innerHTML = '<i class="ph ph-check"></i> Enregistré';
                setTimeout(() => { btnSave.innerHTML = '<i class="ph ph-garage"></i> Enregistrer'; }, 1800);
            } catch (e) {
                alert(e.message);
            } finally {
                btnSave.disabled = false;
            }
        });

        // ── Panneau garage ───────────────────────────────────────────
        function label(v) {
            return v.nickname || [v.make, v.model, v.year].filter(Boolean).join(' ') || v.vin || v.plate || 'Véhicule';
        }

        function row(v) {
            const meta = [v.vin ? 'VIN ' + esc(v.vin) : '', v.engine ? esc(v.engine) : ''].filter(Boolean).join(' · ');
            return `<div class="garage-row" data-id="${v.id}">
                <div class="garage-main" data-act="use">
                    <i class="ph ph-car-profile"></i>
                    <div>
                        <strong>${esc(label(v))}</strong>
                        ${meta ? `<div class="adm-row-meta">${meta}</div>` : ''}
                    </div>
                </div>
                <button class="adm-btn adm-btn-danger" data-act="del" title="Retirer du garage"><i class="ph ph-trash"></i></button>
            </div>`;
        }

        async function load() {
            listBox.innerHTML = '<p class="acc-empty">Chargement…</p>';
            errorBox.classList.add('display-none');
            try {
                const data = await api('/garage', { method: 'GET' });
                const list = data.vehicles || [];
                listBox.innerHTML = list.length
                    ? list.map(row).join('')
                    : '<p class="acc-empty">Aucun véhicule enregistré. Identifiez un véhicule puis cliquez « Enregistrer ».</p>';
            } catch (e) {
                errorBox.textContent = e.message; errorBox.classList.remove('display-none');
                listBox.innerHTML = '';
            }
        }

        function open() {
            if (!requireLogin()) return;
            overlay.classList.remove('display-none');
            load();
        }
        function close() { overlay.classList.add('display-none'); }

        navGarage.addEventListener('click', (e) => { e.preventDefault(); open(); });
        $('garage-close').addEventListener('click', close);
        window.pfCloseOnBackdrop(overlay, close);

        // Pré-remplir la recherche depuis un véhicule / supprimer
        listBox.addEventListener('click', async (e) => {
            const rowEl = e.target.closest('.garage-row');
            if (!rowEl) return;
            const id = rowEl.getAttribute('data-id');
            const delBtn = e.target.closest('[data-act="del"]');

            if (delBtn) {
                if (!confirm('Retirer ce véhicule de votre garage ?')) return;
                try { await api('/garage/' + id, { method: 'DELETE' }); load(); }
                catch (err) { alert(err.message); }
                return;
            }
            // Sinon : réutiliser ce véhicule dans la recherche
            const data = await api('/garage', { method: 'GET' }).catch(() => ({ vehicles: [] }));
            const v = (data.vehicles || []).find(x => String(x.id) === id);
            if (v) prefillSearch(v);
            close();
        });

        function prefillSearch(v) {
            const vinEl = $('vin');
            if (v.vin && vinEl) {
                // Onglet VIN + déclenche le décodage existant
                const vinTab = document.querySelector('.veh-tab[data-veh-tab="vin"]');
                if (vinTab) vinTab.click();
                vinEl.value = v.vin;
                vinEl.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // Onglet Modèle + remplit les champs manuels
                const modelTab = document.querySelector('.veh-tab[data-veh-tab="model"]');
                if (modelTab) modelTab.click();
                if ($('make')) { $('make').value = v.make || ''; $('make').dispatchEvent(new Event('change', { bubbles: true })); }
                setTimeout(() => {
                    if ($('year')) $('year').value = v.year || '';
                    if ($('engine')) $('engine').value = v.engine || '';
                }, 400);
            }
        }
    });
})();
