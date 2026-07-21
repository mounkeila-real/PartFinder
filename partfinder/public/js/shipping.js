/**
 * Écran Expéditions (opérateur) — file d'attente, CN23 imprimable, tracking.
 * Tant qu'aucun contrat Colissimo n'est configuré, la CN23 est affichée pour
 * être recopiée dans l'interface La Poste, puis l'opérateur saisit le suivi.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const eur = (n) => Number(n || 0).toFixed(2).replace('.', ',') + ' €';

    const STATUT_FR = {
        PREPARING: 'À préparer', LABEL_READY: 'Étiquette prête',
        SHIPPED: 'Expédiée', DELIVERED: 'Livrée',
    };

    document.addEventListener('DOMContentLoaded', () => {
        const panel = document.querySelector('[data-adm-panel="shipping"]');
        if (!panel) return;
        const listBox = $('sh-list');
        const resultBox = $('sh-result');
        let statut = 'PREPARING';

        async function api(path, options) {
            const res = await fetch(API_BASE_URL + path, Object.assign({}, options, {
                headers: Object.assign({ 'Content-Type': 'application/json' }, window.pfAuthHeader(), (options && options.headers) || {}),
            }));
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
            return data;
        }

        window.pfLoadShipping = load;

        function row(s) {
            const who = s.user ? (s.user.companyName || s.user.email) : '—';
            const dest = s.address
                ? `${esc(s.address.ville)} (${esc(s.address.territoire)})`
                : s.zone;
            return `<div class="adm-row adm-row-order" data-sid="${s.id}">
                <div class="adm-order-head">
                    <div class="adm-row-main">
                        <strong>Expédition #${s.id}</strong> · ${esc(who)}
                        <span class="acc-status ${s.statut === 'SHIPPED' ? 'st-done' : 'st-progress'}">${STATUT_FR[s.statut] || s.statut}</span>
                        ${s.bloque ? `<span class="acc-status st-cancel">Bloquée · ${eur(s.montantDuEur)} dû</span>` : ''}
                        <div class="adm-row-meta">
                            ${dest} · ${Number(s.poidsFactureKg || 0)} kg · acheminement ${eur(s.portEur)}
                            ${s.trackingColissimo ? ` · suivi ${esc(s.trackingColissimo)}` : ''}
                        </div>
                    </div>
                </div>
                ${s.statut !== 'SHIPPED' ? `
                <div class="adm-validate">
                    <div class="adm-validate-actions">
                        ${s.bloque
                            ? '<span class="pr-hint">Réglez l\'appel de fonds avant d\'expédier.</span>'
                            : `<button class="adm-mini-btn" data-act="label">Préparer la CN23</button>
                               <input type="text" class="sh-tracking" placeholder="N° de suivi Colissimo">
                               <button class="adm-mini-btn adm-mini-primary" data-act="ship">Marquer expédiée</button>`}
                    </div>
                </div>` : ''}
            </div>`;
        }

        async function load() {
            listBox.innerHTML = '<p class="acc-empty">Chargement…</p>';
            try {
                const data = await api(`/warehouse/shipments?statut=${statut}`, { method: 'GET' });
                const list = data.shipments || [];
                listBox.innerHTML = list.length ? list.map(row).join('')
                    : '<p class="acc-empty">Aucune expédition dans cette catégorie.</p>';
            } catch (e) { listBox.innerHTML = `<p class="acc-empty">${esc(e.message)}</p>`; }
        }

        panel.querySelectorAll('.sh-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                panel.querySelectorAll('.sh-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                statut = chip.getAttribute('data-sh-statut');
                load();
            });
        });

        listBox.addEventListener('click', async (e) => {
            const btn = e.target.closest('.adm-mini-btn');
            if (!btn) return;
            const rowEl = btn.closest('[data-sid]');
            const sid = rowEl.getAttribute('data-sid');
            const act = btn.getAttribute('data-act');
            btn.disabled = true;
            resultBox.innerHTML = '';
            try {
                if (act === 'label') {
                    const data = await api(`/warehouse/shipments/${sid}/label`, { method: 'POST', body: JSON.stringify({}) });
                    renderCn23(data.label);
                    load();
                } else if (act === 'ship') {
                    const tracking = rowEl.querySelector('.sh-tracking').value.trim();
                    if (!tracking) { resultBox.innerHTML = '<div class="wh-warn">Saisissez le numéro de suivi.</div>'; return; }
                    await api(`/warehouse/shipments/${sid}/ship`, { method: 'POST', body: JSON.stringify({ tracking }) });
                    resultBox.innerHTML = '<div class="wh-ok">✓ Expédition enregistrée — le client a été notifié avec son suivi.</div>';
                    load();
                }
            } catch (err) {
                resultBox.innerHTML = `<div class="wh-warn">${esc(err.message)}</div>`;
            } finally { btn.disabled = false; }
        });

        /** CN23 imprimable : données à recopier dans l'interface La Poste. */
        function renderCn23(label) {
            const c = label.cn23;
            const lignes = c.lignes.map(l => `
                <tr><td>${esc(l.designation)}</td><td>${l.quantite}</td>
                <td>${l.poidsNetKg} kg</td><td>${eur(l.valeurEur)}</td><td>${esc(l.codeSH)}</td><td>${esc(l.origine)}</td></tr>`).join('');
            resultBox.innerHTML = `
                <div class="cn23">
                    <div class="cn23-head">
                        <strong>Déclaration douanière CN23</strong>
                        ${label.manuel ? '<span class="pr-hint">À recopier dans l\'interface La Poste (aucun contrat Colissimo configuré).</span>' : ''}
                        <button class="adm-mini-btn" onclick="window.print()">Imprimer</button>
                    </div>
                    <div class="cn23-cols">
                        <div><h4>Expéditeur</h4>
                            ${esc(c.expediteur.nom)}<br>${esc(c.expediteur.adresse)}<br>
                            ${esc(c.expediteur.codePostal)} ${esc(c.expediteur.ville)}<br>${esc(c.expediteur.pays)}</div>
                        <div><h4>Destinataire</h4>
                            ${esc(c.destinataire.nom)}<br>${esc(c.destinataire.adresse)}<br>
                            ${esc(c.destinataire.codePostal)} ${esc(c.destinataire.ville)}<br>
                            ${esc(c.destinataire.territoire)}${c.destinataire.telephone ? '<br>' + esc(c.destinataire.telephone) : ''}</div>
                    </div>
                    <table class="cn23-table">
                        <thead><tr><th>Désignation</th><th>Qté</th><th>Poids net</th><th>Valeur</th><th>Code SH</th><th>Origine</th></tr></thead>
                        <tbody>${lignes}</tbody>
                    </table>
                    <div class="cn23-foot">
                        Poids total : <strong>${c.poidsTotalKg} kg</strong> ·
                        Valeur totale : <strong>${eur(c.valeurTotaleEur)}</strong> ·
                        Nature : ${esc(c.nature)}
                        <p class="pr-hint">${esc(c.mentions)}</p>
                    </div>
                </div>`;
        }
    });
})();
