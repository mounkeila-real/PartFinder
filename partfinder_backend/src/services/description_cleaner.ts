/**
 * Nettoyage des descriptions d'annonces.
 *
 * Isolé du fichier de routes pour être testable : ces règles décident de
 * ce que le client lit sur l'état réel d'une pièce d'occasion, et une
 * coupe trop large lui retirerait de l'information utile.
 */

/**
 * Retire d'un texte tout ce qui désigne la source d'approvisionnement.
 *
 * Les descriptions d'annonces sont rédigées par les vendeurs : elles citent
 * la marketplace et renvoient vers leur boutique. Comme cet extrait est
 * AFFICHÉ sur chaque carte de résultat, le nom du fournisseur se retrouvait
 * sous les yeux du client.
 */
export function neutralizeSource(text: string): string {
    if (!text) return '';
    return String(text)
        // Liens vendeur / boutique (contiennent le domaine de la marketplace).
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\bwww\.\S+/gi, ' ')
        // Noms de marketplaces, avec ou sans extension de domaine.
        .replace(/\b(e-?bay|ali-?express|alibaba|paypal|leboncoin)(\.[a-z]{2,3}(\.[a-z]{2,3})?)?\b/gi, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Nettoie une description HTML eBay : retire le CSS/scripts/boilerplate vendeur, garde le texte utile.
export function cleanEbayDescription(html: string): string {
    if (!html) return '';
    let t = String(html);
    t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    t = t.replace(/<!--[\s\S]*?-->/g, ' ');
    t = t.replace(/<\s*br\s*\/?>/gi, '\n');
    t = t.replace(/<\/\s*(p|div|li|tr|h[1-6]|ul|ol|table|section)\s*>/gi, '\n');
    t = t.replace(/<[^>]+>/g, ' ');
    const entities: Record<string, string> = {
        '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
        '&eacute;': 'é', '&egrave;': 'è', '&agrave;': 'à', '&ccedil;': 'ç', '&ocirc;': 'ô',
        '&ldquo;': '"', '&rdquo;': '"', '&rsquo;': "'"
    };
    t = t.replace(/&[a-z#0-9]+;/gi, (m) => entities[m.toLowerCase()] ?? ' ');
    // Retire les lignes de CSS residuel
    t = t.split('\n').map(l => l.trim())
        .filter(l => l && !/[{}]/.test(l) && !/^[.#@][\w-]/.test(l))
        .join('\n');
    // Coupe au premier marqueur de GABARIT VENDEUR (menu de boutique, pied de
    // page). Ces blocs représentent souvent l'essentiel du texte : des dizaines
    // de catégories sans rapport avec la pièce, qui noient la description — et
    // qu'on paie ensuite à traduire.
    //
    // Marqueurs dans la LANGUE D'ORIGINE : la coupe a lieu ici, avant que le
    // client ne traduise. Des marqueurs français seuls seraient inutiles sur
    // une annonce allemande — et réciproquement, d'où les quatre langues.
    const markers = [
        // Menu / navigation de boutique
        'shop-kategorien', 'shop kategorien', 'shop-startseite', 'zur shop-startseite',
        'neue angebote', 'endet bald', 'zu favoriten', 'als favorit',
        'catégories de boutique', 'accueil boutique', 'nouvelles offres',
        'se termine bientôt', 'ajouter aux favoris',
        'shop categories', 'shop home', 'ending soon', 'add to favou', 'add to favor',
        'categorías de la tienda', 'categorias de la tienda', 'inicio de la tienda',
        // Pied de page / mentions légales
        'zahlungsarten', 'zahlungsmöglichkeiten', 'widerrufsrecht', 'impressum',
        'procédure d', 'modes de paiement', 'conditions générales',
        'tous droits réservés', 'droit de rétractation',
        'payment methods', 'terms and conditions', 'all rights reserved',
        '© 20',
        // Mention de traduction automatique ajoutée par le vendeur
        'automatisch übersetzt', 'automatiquement traduite', 'automatically translated',
    ];
    const low = t.toLowerCase();
    let cut = t.length;
    // i > 60 : ne pas amputer une description qui s'ouvrirait sur un de ces
    // mots (« Conditions générales de garantie » en première ligne).
    for (const m of markers) { const i = low.indexOf(m); if (i > 60 && i < cut) cut = i; }
    t = t.slice(0, cut);

    // Filet de sécurité quand aucun marqueur ne correspond : une longue suite
    // de libellés courts SANS CHIFFRE est un menu de catégories.
    //
    // La condition « sans chiffre » protège le contenu utile : une liste de
    // modèles compatibles (« W169 A 150 », « E90 320d ») ou de références
    // contient des chiffres et doit être conservée — c'est justement ce que
    // le client vient vérifier. Seuil élevé (10) pour la même raison.
    const lignes = t.split('\n');
    let serie = 0;
    for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i];
        const libelleNu = l.length > 0 && l.length < 32 && !/\d/.test(l) && !/[.!?:;]$/.test(l);
        serie = libelleNu ? serie + 1 : 0;
        if (serie >= 10) { t = lignes.slice(0, i - serie + 1).join('\n'); break; }
    }

    t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    // Plafond inchangé : tronquer une vraie description coûte plus cher que
    // de traduire quelques caractères de trop.
    if (t.length > 1600) t = t.slice(0, 1600).replace(/\s+\S*$/, '') + '…';
    return neutralizeSource(t);
}

