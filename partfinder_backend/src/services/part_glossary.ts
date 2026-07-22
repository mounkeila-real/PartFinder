/**
 * Glossaire multilingue des pièces automobiles — TRADUCTION DÉTERMINISTE.
 *
 * Le vocabulaire de la pièce détachée est un ensemble fermé et petit : une
 * table figée est instantanée, gratuite et reproductible, là où un appel IA
 * par recherche coûterait des jetons pour un résultat variable.
 *
 * Objectif : atteindre les annonces étrangères. Une BMW d'occasion est
 * massivement listée en Allemagne — « Bremsbeläge » ouvre un catalogue que
 * « plaquettes de frein » ne touchera jamais.
 *
 * Clés alignées sur les codes de PartCategory (voir scripts/seed_pricing.ts).
 */

export type Lang = 'fr' | 'de' | 'es' | 'it' | 'en';

interface Entry {
    /** Formes françaises reconnues dans la requête (sans accent, minuscules). */
    fr: string[];
    de: string;
    es: string;
    it: string;
    en: string;
}

// Termes les plus recherchés en pièce d'occasion. Les traductions retenues
// sont celles réellement employées dans les TITRES d'annonces locales, pas la
// traduction littérale (ex. « Bremsbeläge », pas « Bremskissen »).
const GLOSSARY: Entry[] = [
    { fr: ['plaquettes de frein', 'plaquette de frein', 'plaquettes', 'plaquette'], de: 'Bremsbeläge', es: 'pastillas de freno', it: 'pastiglie freno', en: 'brake pads' },
    { fr: ['disque de frein', 'disques de frein', 'disques', 'disque'], de: 'Bremsscheiben', es: 'discos de freno', it: 'dischi freno', en: 'brake discs' },
    { fr: ['etrier de frein', 'etrier'], de: 'Bremssattel', es: 'pinza de freno', it: 'pinza freno', en: 'brake caliper' },
    { fr: ['alternateur'], de: 'Lichtmaschine', es: 'alternador', it: 'alternatore', en: 'alternator' },
    { fr: ['demarreur'], de: 'Anlasser', es: 'motor de arranque', it: 'motorino avviamento', en: 'starter motor' },
    { fr: ['turbo', 'turbocompresseur'], de: 'Turbolader', es: 'turbocompresor', it: 'turbocompressore', en: 'turbocharger' },
    { fr: ['calculateur moteur', 'calculateur', 'ecu'], de: 'Steuergerät', es: 'centralita motor', it: 'centralina motore', en: 'ECU engine control unit' },
    { fr: ['pompe a injection', 'pompe injection'], de: 'Einspritzpumpe', es: 'bomba de inyección', it: 'pompa iniezione', en: 'injection pump' },
    { fr: ['injecteur', 'injecteurs'], de: 'Einspritzdüse', es: 'inyector', it: 'iniettore', en: 'fuel injector' },
    { fr: ['radiateur'], de: 'Kühler', es: 'radiador', it: 'radiatore', en: 'radiator' },
    { fr: ['condenseur de climatisation', 'condenseur clim', 'condenseur'], de: 'Klimakondensator', es: 'condensador aire acondicionado', it: 'condensatore climatizzatore', en: 'AC condenser' },
    { fr: ['compresseur de climatisation', 'compresseur clim'], de: 'Klimakompressor', es: 'compresor aire acondicionado', it: 'compressore climatizzatore', en: 'AC compressor' },
    { fr: ['boite de vitesses', 'boite vitesses'], de: 'Getriebe', es: 'caja de cambios', it: 'cambio', en: 'gearbox transmission' },
    { fr: ['culasse'], de: 'Zylinderkopf', es: 'culata', it: 'testata', en: 'cylinder head' },
    { fr: ['vanne egr', 'egr'], de: 'AGR Ventil', es: 'válvula EGR', it: 'valvola EGR', en: 'EGR valve' },
    { fr: ['debitmetre'], de: 'Luftmassenmesser', es: 'caudalímetro', it: 'debimetro', en: 'mass air flow sensor' },
    { fr: ['cardan', 'arbre de transmission'], de: 'Antriebswelle', es: 'palier transmisión', it: 'semiasse', en: 'drive shaft' },
    { fr: ['triangle de suspension', 'bras de suspension', 'triangle'], de: 'Querlenker', es: 'brazo suspensión', it: 'braccio sospensione', en: 'control arm' },
    { fr: ['amortisseur', 'amortisseurs'], de: 'Stoßdämpfer', es: 'amortiguador', it: 'ammortizzatore', en: 'shock absorber' },
    { fr: ['colonne de direction'], de: 'Lenksäule', es: 'columna de dirección', it: 'piantone sterzo', en: 'steering column' },
    { fr: ['cremaillere de direction', 'cremaillere'], de: 'Lenkgetriebe', es: 'cremallera dirección', it: 'scatola sterzo', en: 'steering rack' },
    { fr: ['pompe de direction assistee', 'pompe de direction'], de: 'Servopumpe', es: 'bomba dirección asistida', it: 'pompa servosterzo', en: 'power steering pump' },
    { fr: ['bobine d allumage', 'bobine allumage', 'bobine'], de: 'Zündspule', es: 'bobina de encendido', it: 'bobina accensione', en: 'ignition coil' },
    { fr: ['pompe a eau', 'pompe eau'], de: 'Wasserpumpe', es: 'bomba de agua', it: 'pompa acqua', en: 'water pump' },
    { fr: ['pompe a carburant', 'pompe carburant', 'pompe essence'], de: 'Kraftstoffpumpe', es: 'bomba de combustible', it: 'pompa carburante', en: 'fuel pump' },
    { fr: ['sonde lambda', 'sonde o2'], de: 'Lambdasonde', es: 'sonda lambda', it: 'sonda lambda', en: 'oxygen sensor' },
    { fr: ['phare', 'optique avant', 'projecteur'], de: 'Scheinwerfer', es: 'faro', it: 'faro', en: 'headlight' },
    { fr: ['feu arriere', 'optique arriere'], de: 'Rückleuchte', es: 'piloto trasero', it: 'fanale posteriore', en: 'tail light' },
    { fr: ['retroviseur interieur'], de: 'Innenspiegel', es: 'retrovisor interior', it: 'specchietto interno', en: 'rear view mirror' },
    { fr: ['retroviseur'], de: 'Außenspiegel', es: 'retrovisor', it: 'specchietto retrovisore', en: 'wing mirror' },
    { fr: ['poignee de porte', 'poignee'], de: 'Türgriff', es: 'manilla de puerta', it: 'maniglia porta', en: 'door handle' },
    { fr: ['leve vitre', 'leve-vitre'], de: 'Fensterheber', es: 'elevalunas', it: 'alzacristalli', en: 'window regulator' },
    { fr: ['moteur d essuie glace', 'moteur essuie glace', 'essuie glace'], de: 'Scheibenwischermotor', es: 'motor limpiaparabrisas', it: 'motorino tergicristallo', en: 'wiper motor' },
    { fr: ['neiman', 'antivol de direction'], de: 'Zündschloss', es: 'clausor', it: 'blocchetto accensione', en: 'ignition lock' },
    { fr: ['compteur', 'combine d instruments', 'tableau de bord'], de: 'Kombiinstrument Tacho', es: 'cuadro de instrumentos', it: 'quadro strumenti', en: 'instrument cluster' },
    { fr: ['airbag de volant', 'airbag volant', 'airbag'], de: 'Airbag Lenkrad', es: 'airbag volante', it: 'airbag volante', en: 'steering wheel airbag' },
    { fr: ['ceinture de securite', 'ceinture'], de: 'Sicherheitsgurt', es: 'cinturón de seguridad', it: 'cintura sicurezza', en: 'seat belt' },
    { fr: ['silencieux', 'pot d echappement', 'pot echappement'], de: 'Auspuff Schalldämpfer', es: 'silenciador escape', it: 'silenziatore scarico', en: 'exhaust muffler' },
    { fr: ['catalyseur', 'pot catalytique'], de: 'Katalysator', es: 'catalizador', it: 'catalizzatore', en: 'catalytic converter' },
    { fr: ['volant moteur'], de: 'Schwungrad', es: 'volante motor', it: 'volano', en: 'flywheel' },
    { fr: ['kit d embrayage', 'kit embrayage', 'embrayage'], de: 'Kupplungssatz', es: 'kit de embrague', it: 'kit frizione', en: 'clutch kit' },
    { fr: ['boitier papillon', 'papillon'], de: 'Drosselklappe', es: 'cuerpo mariposa', it: 'corpo farfallato', en: 'throttle body' },
    { fr: ['support moteur', 'silent bloc'], de: 'Motorlager', es: 'soporte motor', it: 'supporto motore', en: 'engine mount' },
    { fr: ['capot moteur', 'capot'], de: 'Motorhaube', es: 'capó', it: 'cofano', en: 'bonnet hood' },
    { fr: ['portiere', 'porte'], de: 'Tür', es: 'puerta', it: 'portiera', en: 'car door' },
    { fr: ['pare chocs', 'pare choc'], de: 'Stoßstange', es: 'parachoques', it: 'paraurti', en: 'bumper' },
    { fr: ['pare brise'], de: 'Windschutzscheibe', es: 'parabrisas', it: 'parabrezza', en: 'windscreen' },
    { fr: ['aile avant', 'aile'], de: 'Kotflügel', es: 'aleta', it: 'parafango', en: 'fender wing' },
    { fr: ['hayon', 'coffre'], de: 'Heckklappe', es: 'portón trasero', it: 'portellone', en: 'tailgate' },
    { fr: ['siege', 'sieges'], de: 'Sitz', es: 'asiento', it: 'sedile', en: 'car seat' },
    { fr: ['turbine', 'ventilateur'], de: 'Lüfter', es: 'ventilador', it: 'ventola', en: 'radiator fan' },
    { fr: ['courroie de distribution', 'distribution'], de: 'Zahnriemen', es: 'correa distribución', it: 'cinghia distribuzione', en: 'timing belt' },
    { fr: ['filtre a particules', 'fap'], de: 'Rußpartikelfilter', es: 'filtro de partículas', it: 'filtro antiparticolato', en: 'diesel particulate filter' },
    { fr: ['debitmetre d air'], de: 'Luftmassenmesser', es: 'medidor de masa de aire', it: 'misuratore massa aria', en: 'air flow meter' },
    { fr: ['moteur complet', 'moteur'], de: 'Motor', es: 'motor', it: 'motore', en: 'engine' },
    { fr: ['roulement de roue', 'roulement'], de: 'Radlager', es: 'rodamiento rueda', it: 'cuscinetto ruota', en: 'wheel bearing' },
    { fr: ['moyeu'], de: 'Radnabe', es: 'buje', it: 'mozzo', en: 'wheel hub' },
    { fr: ['jante', 'jantes'], de: 'Felge', es: 'llanta', it: 'cerchio', en: 'alloy wheel' },

    // Électronique et accessoires : catégories où le neuf importé est
    // nettement moins cher qu'en Europe. La traduction anglaise sert
    // directement la recherche AliExpress.
    { fr: ['autoradio android', 'autoradio', 'poste radio', 'auto radio'], de: 'Autoradio Android', es: 'radio de coche Android', it: 'autoradio Android', en: 'Android car stereo head unit' },
    { fr: ['camera de recul', 'camera recul'], de: 'Rückfahrkamera', es: 'cámara de marcha atrás', it: 'telecamera retromarcia', en: 'reversing camera' },
    { fr: ['radar de recul', 'capteur de stationnement', 'capteurs de recul'], de: 'Einparkhilfe Sensor', es: 'sensor de aparcamiento', it: 'sensore parcheggio', en: 'parking sensor' },
    { fr: ['ampoules led', 'ampoule led', 'kit led'], de: 'LED Lampen', es: 'bombillas LED', it: 'lampadine LED', en: 'LED headlight bulbs' },
    { fr: ['kit mains libres', 'bluetooth'], de: 'Freisprecheinrichtung', es: 'manos libres', it: 'vivavoce', en: 'hands-free car kit' },
    { fr: ['tapis de sol', 'tapis'], de: 'Fußmatten', es: 'alfombrillas', it: 'tappetini', en: 'car floor mats' },
    { fr: ['housse de siege', 'housses de sieges'], de: 'Sitzbezüge', es: 'fundas de asiento', it: 'coprisedili', en: 'car seat covers' },
    { fr: ['valise diagnostic', 'outil diagnostic', 'obd'], de: 'Diagnosegerät OBD', es: 'escáner diagnóstico OBD', it: 'diagnosi OBD', en: 'OBD2 diagnostic scanner' },
    { fr: ['support telephone', 'support smartphone'], de: 'Handyhalterung', es: 'soporte de móvil', it: 'supporto telefono', en: 'car phone holder' },
    { fr: ['chargeur allume cigare', 'chargeur usb'], de: 'KFZ Ladegerät', es: 'cargador de coche', it: 'caricabatterie auto', en: 'car USB charger' },
    { fr: ['barre de toit', 'barres de toit'], de: 'Dachträger', es: 'barras de techo', it: 'barre portatutto', en: 'roof rack bars' },
    { fr: ['attelage', 'crochet remorque'], de: 'Anhängerkupplung', es: 'enganche de remolque', it: 'gancio traino', en: 'tow bar' },
];

/** Mots-outils français à retirer d'une requête traduite (bruit dans un titre étranger). */
const STOPWORDS_FR = new Set(['de', 'du', 'la', 'le', 'les', 'des', 'a', 'au', 'aux', 'pour', 'et', 'un', 'une', 'd']);

/** Position : les annonces étrangères l'expriment dans leur langue. */
const POSITIONS: Record<string, Record<Lang, string>> = {
    avant: { fr: 'avant', de: 'vorne', es: 'delantero', it: 'anteriore', en: 'front' },
    arriere: { fr: 'arrière', de: 'hinten', es: 'trasero', it: 'posteriore', en: 'rear' },
    gauche: { fr: 'gauche', de: 'links', es: 'izquierdo', it: 'sinistro', en: 'left' },
    droit: { fr: 'droit', de: 'rechts', es: 'derecho', it: 'destro', en: 'right' },
    droite: { fr: 'droite', de: 'rechts', es: 'derecho', it: 'destro', en: 'right' },
};

/** Normalise pour la comparaison : minuscules, sans accents ni ponctuation. */
export function normalize(s: string): string {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Entrées APPRISES puis validées par un opérateur, injectées au démarrage.
 * Le glossaire statique reste la référence ; celles-ci l'étendent.
 */
let APPRIS: Entry[] = [];

/** Index des formes françaises, reconstruit à chaque ajout d'entrées apprises. */
let INDEX: { form: string; entry: Entry }[] = [];

function reconstruireIndex(): void {
    // Les plus longues d'abord : « plaquettes de frein » doit primer sur
    // « frein » seul, sinon la traduction serait tronquée.
    INDEX = [...GLOSSARY, ...APPRIS]
        .flatMap((entry) => entry.fr.map((form) => ({ form: normalize(form), entry })))
        .sort((a, b) => b.form.length - a.form.length);
}
reconstruireIndex();

/**
 * Injecte les termes validés en base. Appelé au démarrage et après chaque
 * validation, pour que l'enrichissement prenne effet sans redéploiement.
 */
export function chargerTermesAppris(entrees: Entry[]): void {
    APPRIS = entrees;
    reconstruireIndex();
    reconstruireIndexInverse();
}

export interface TranslationResult {
    /** Requête dans la langue cible. */
    query: string;
    /** Un terme de pièce a-t-il été reconnu ? Sinon, traduire n'apporte rien. */
    matched: boolean;
    /** Terme traduit (diagnostic). */
    term: string | null;
}

/**
 * Traduit une requête française vers `lang`.
 *
 * Conserve tels quels marque, modèle et référence OEM : ils sont universels et
 * constituent la meilleure clé de recherche transfrontalière. Seul le nom de
 * la pièce et sa position sont traduits.
 */
export function translateQuery(query: string, lang: Lang): TranslationResult {
    const norm = normalize(query);
    if (!norm) return { query: '', matched: false, term: null };
    if (lang === 'fr') return { query, matched: true, term: null };

    const hit = INDEX.find((i) => norm.includes(i.form));
    if (!hit) return { query, matched: false, term: null };

    const translated = hit.entry[lang];

    // Reste de la requête = marque, modèle, motorisation, OEM : on garde.
    const reste = norm.replace(hit.form, ' ')
        .split(' ')
        .filter((w) => w && !STOPWORDS_FR.has(w))
        .map((w) => {
            const pos = POSITIONS[w];
            return pos ? pos[lang] : w;
        });

    return {
        query: [translated, ...reste].join(' ').replace(/\s+/g, ' ').trim(),
        matched: true,
        term: translated,
    };
}

/**
 * Marchés eBay interrogés, avec la langue de leurs titres.
 *
 * UNIQUEMENT la zone euro / union douanière. eBay UK (EBAY_GB) est
 * volontairement EXCLU malgré son gros catalogue de pièces :
 *  - les prix y sont en livres, et le module de tarification raisonne en
 *    euros — une annonce à 50 GBP serait facturée comme 50 € (~15 % de perte) ;
 *  - depuis le Brexit, un achat UK -> France implique dédouanement et TVA à
 *    l'import, que le prix « tout compris » ne modélise pas du tout.
 * L'anglais reste dans le glossaire : utile si un marché anglophone de la
 * zone euro est ajouté (EBAY_IE), ou pour les titres anglais des vendeurs.
 */
export const MARKETPLACES: { id: string; lang: Lang; pays: string }[] = [
    { id: 'EBAY_FR', lang: 'fr', pays: 'France' },
    { id: 'EBAY_DE', lang: 'de', pays: 'Allemagne' },
    { id: 'EBAY_IT', lang: 'it', pays: 'Italie' },
    { id: 'EBAY_ES', lang: 'es', pays: 'Espagne' },
];

export const GLOSSARY_SIZE = GLOSSARY.length;

/* ── Traduction INVERSE : titre étranger → français ──────────────────
 * Les annonces étrangères remontent avec un titre allemand ou italien.
 * Le glossaire sert déjà FR→XX ; le lire à l'envers rend les titres
 * compréhensibles sans aucun appel réseau ni jeton d'IA.
 *
 * On ne traduit PAS la phrase entière : marques, modèles et codes moteur
 * (E90, F20, 1.6 HDi) doivent rester intacts — ce sont eux qui permettent
 * au client de reconnaître sa pièce.
 */

/** Mots courants des titres d'annonces, hors vocabulaire pièces. */
const MODIFICATEURS: Record<string, string> = {
    // Allemand
    vorne: 'avant', vorn: 'avant', vorderer: 'avant', vordere: 'avant',
    hinten: 'arrière', hinterer: 'arrière', hintere: 'arrière',
    links: 'gauche', linke: 'gauche', rechts: 'droite', rechte: 'droite',
    satz: 'jeu', paar: 'paire', neu: 'neuf', gebraucht: 'occasion',
    für: 'pour', fur: 'pour', und: 'et', mit: 'avec',
    // Italien
    anteriore: 'avant', posteriore: 'arrière', sinistro: 'gauche', destro: 'droite',
    coppia: 'paire', nuovo: 'neuf', usato: 'occasion', per: 'pour', con: 'avec',
    // Espagnol
    delantero: 'avant', trasero: 'arrière', izquierdo: 'gauche', derecho: 'droite',
    juego: 'jeu', par: 'paire', nuevo: 'neuf', usado: 'occasion', para: 'pour',
    // Anglais
    front: 'avant', rear: 'arrière', left: 'gauche', right: 'droite',
    set: 'jeu', pair: 'paire', new: 'neuf', used: 'occasion', for: 'pour', with: 'avec',
};

/** Index inverse : forme étrangère normalisée → libellé français. */
let INDEX_INVERSE: { forme: string; fr: string }[] = [];

function reconstruireIndexInverse(): void {
    const out: { forme: string; fr: string }[] = [];
    for (const e of [...GLOSSARY, ...APPRIS]) {
        // Première forme française = libellé de référence, majuscule initiale.
        const fr = e.fr[0].charAt(0).toUpperCase() + e.fr[0].slice(1);
        for (const lang of ['de', 'es', 'it', 'en'] as const) {
            const forme = normalize(e[lang]);
            if (forme) out.push({ forme, fr });
        }
    }
    // Les plus longues d'abord : « Bremsscheiben » ne doit pas être coupé
    // par une entrée plus courte qui en serait un préfixe.
    INDEX_INVERSE = out.sort((a, b) => b.forme.length - a.forme.length);
}
reconstruireIndexInverse();

/**
 * Rend un TITRE d'annonce étrangère lisible en français.
 *
 * ⚠️ RÉSERVÉ AUX TITRES. Ne jamais appliquer à une description : ce sont des
 * titres formulaires (marque + pièce + position + codes) où la substitution
 * terme à terme fonctionne. Sur de la prose — état réel de la pièce, réserves
 * du vendeur, conditions de garantie — elle produirait un texte qui RESSEMBLE
 * à une traduction tout en étant faux, ce qui est pire que l'original : le
 * client achèterait sur une compréhension erronée de l'état du bien.
 * Les descriptions passent par un moteur de traduction réel (translation.service).
 *
 * Renvoie null si rien n'a été reconnu — inutile d'afficher une variante
 * identique à l'original.
 */
export function frenchifyTitle(titre: string): string | null {
    if (!titre || !titre.trim()) return null;

    let restant = normalize(titre);
    let touche = false;

    // 1) Termes de pièces (plusieurs mots possibles).
    for (const { forme, fr } of INDEX_INVERSE) {
        if (restant.includes(forme)) {
            restant = restant.split(forme).join(`  ${fr}  `);
            touche = true;
        }
    }

    // 2) Mots courants, sur les mots isolés uniquement.
    const mots = restant.split(/\s+/).map((m) => {
        if (m.startsWith(' ')) return m;
        const t = MODIFICATEURS[m];
        if (t) { touche = true; return t; }
        return m;
    });

    if (!touche) return null;

    const sortie = mots.join(' ').replace(/ /g, '').replace(/\s+/g, ' ').trim();
    if (!sortie) return null;
    return sortie.charAt(0).toUpperCase() + sortie.slice(1);
}
