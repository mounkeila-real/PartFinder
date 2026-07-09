/**
 * Bascule des onglets d'identification véhicule (VIN / Carte grise / Modèle).
 * Purement présentationnel : affiche/masque les panneaux, ne touche à aucune
 * logique métier de app.js (les champs restent dans le DOM en permanence,
 * seul leur affichage change — le décodage VIN continue de remplir les champs
 * du panneau « Modèle » même s'il est masqué).
 */
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        var tabs = document.querySelectorAll('.veh-tab');
        var panels = document.querySelectorAll('.veh-panel');
        if (!tabs.length) return;

        function activate(name) {
            tabs.forEach(function (t) {
                t.classList.toggle('active', t.getAttribute('data-veh-tab') === name);
            });
            panels.forEach(function (p) {
                p.classList.toggle('display-none', p.getAttribute('data-veh-panel') !== name);
            });
        }

        tabs.forEach(function (t) {
            t.addEventListener('click', function () {
                activate(t.getAttribute('data-veh-tab'));
            });
        });
    });
})();
