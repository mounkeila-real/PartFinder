/**
 * Explication des frais d'acheminement outre-mer (vue client).
 * Ouverte depuis le « ? » affiché à côté d'un prix « + frais de port ».
 * Vocabulaire neutre : aucune source d'approvisionnement n'est mentionnée.
 */
(function () {
    const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';

    const ZONE_KEY = 'pf_zone';
    const $ = (id) => document.getElementById(id);
    const eur = (n) => Number(n).toFixed(2).replace('.', ',') + ' €';

    document.addEventListener('DOMContentLoaded', () => {
        const overlay = $('shipping-info-overlay');
        if (!overlay) return;
        const gridBox = $('ship-grid');
        const limitsBox = $('ship-limits');
        const zoneSel = $('ship-zone');

        // Zone mémorisée : sert aussi au calcul des prix à la recherche.
        const saved = localStorage.getItem(ZONE_KEY);
        if (saved) zoneSel.value = saved;
        window.pfGetZone = () => localStorage.getItem(ZONE_KEY) || 'OM1';

        async function load() {
            const zone = zoneSel.value;
            localStorage.setItem(ZONE_KEY, zone);
            gridBox.innerHTML = '<p class="acc-empty">Chargement…</p>';
            try {
                const res = await fetch(`${API_BASE_URL}/parts/shipping-info?zone=${encodeURIComponent(zone)}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Indisponible.');

                const rows = (data.tranches || []).map(t =>
                    `<div class="ship-line"><span>Jusqu'à ${t.jusquAKg} kg</span><span>${eur(t.prixEur)}</span></div>`
                ).join('');
                gridBox.innerHTML = rows
                    ? `<h3 class="acc-sub">Tarifs d'acheminement — ${zone}</h3>${rows}`
                    : '<p class="acc-empty">Grille indisponible.</p>';

                const l = data.limites || {};
                limitsBox.innerHTML = `Colis acceptés jusqu'à <strong>${l.poidsMaxKg} kg</strong>,
                    longueur maximale ${l.longueurMaxCm} cm, somme des dimensions
                    (L + l + h) ${l.sommeDimsStandardCm} cm — au-delà, un supplément s'applique
                    jusqu'à ${l.sommeDimsMaxCm} cm. Les pièces hors de ces limites ne peuvent pas
                    être expédiées : nous vous proposons alors une solution alternative.`;
            } catch (e) {
                gridBox.innerHTML = `<p class="acc-empty">${e.message}</p>`;
                limitsBox.textContent = '';
            }
        }

        zoneSel.addEventListener('change', load);
        $('shipping-info-close').addEventListener('click', () => overlay.classList.add('display-none'));
        window.pfCloseOnBackdrop(overlay, () => overlay.classList.add('display-none'));

        // Délégation : les cartes de résultats sont rendues dynamiquement.
        document.addEventListener('click', (e) => {
            if (!e.target.closest('[data-shipping-info]')) return;
            e.preventDefault();
            overlay.classList.remove('display-none');
            load();
        });
    });
})();
