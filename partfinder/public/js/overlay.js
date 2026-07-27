/**
 * Fermeture des fenêtres en surimpression par clic sur le fond.
 *
 * Un simple listener "click" sur l'overlay ne suffit pas : le navigateur émet
 * le click sur l'ANCÊTRE COMMUN du mousedown et du mouseup. Sélectionner un
 * montant dans la fenêtre puis relâcher la souris sur le fond visait donc
 * l'overlay lui-même, et la fenêtre se fermait en pleine sélection.
 *
 * On n'accepte la fermeture que si le geste a COMMENCÉ sur le fond.
 */
(function () {
    // pointerdown couvre souris + tactile + stylet ; repli mousedown si besoin.
    const DOWN_EVENT = (typeof window.PointerEvent !== 'undefined') ? 'pointerdown' : 'mousedown';

    window.pfCloseOnBackdrop = function (overlay, onClose) {
        if (!overlay || typeof onClose !== 'function') return;

        let startedOnBackdrop = false;

        overlay.addEventListener(DOWN_EVENT, function (e) {
            startedOnBackdrop = (e.target === overlay);
        });

        overlay.addEventListener('click', function (e) {
            const fromBackdrop = startedOnBackdrop;
            startedOnBackdrop = false;
            if (e.target === overlay && fromBackdrop) onClose();
        });
    };
})();
