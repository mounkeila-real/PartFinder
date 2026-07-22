/**
 * Importe un glossaire CSV vers un module TypeScript.
 *
 *   node scripts/import_glossaire_csv.js <fichier.csv>
 *
 * Colonnes attendues : Catégorie, Français, Anglais, Allemand, Espagnol
 * (l'italien est facultatif — voir plus bas).
 *
 * Le résultat est ÉCRIT DANS LE CODE, pas en base : c'est une donnée de
 * référence, elle doit être relue en revue et versionnée comme le reste.
 */
const fs = require('fs');
const path = require('path');

const SORTIE = path.join(__dirname, '..', 'src', 'services', 'part_glossary_data.ts');

/** Analyse CSV minimale mais correcte : gère les champs entre guillemets. */
function parseCsv(texte) {
    const lignes = [];
    let champ = '';
    let ligne = [];
    let dansGuillemets = false;

    for (let i = 0; i < texte.length; i++) {
        const c = texte[i];
        if (dansGuillemets) {
            if (c === '"') {
                if (texte[i + 1] === '"') { champ += '"'; i++; }  // guillemet échappé
                else dansGuillemets = false;
            } else champ += c;
        } else if (c === '"') {
            dansGuillemets = true;
        } else if (c === ',') {
            ligne.push(champ); champ = '';
        } else if (c === '\n') {
            ligne.push(champ); champ = '';
            if (ligne.some((x) => x.trim())) lignes.push(ligne);
            ligne = [];
        } else if (c !== '\r') {
            champ += c;
        }
    }
    ligne.push(champ);
    if (ligne.some((x) => x.trim())) lignes.push(ligne);
    return lignes;
}

const fichier = process.argv[2];
if (!fichier) {
    console.error('Usage : node scripts/import_glossaire_csv.js <fichier.csv>');
    process.exit(1);
}

const lignes = parseCsv(fs.readFileSync(fichier, 'utf8'));
const entete = lignes.shift().map((h) => h.trim().toLowerCase());

const col = (nom) => entete.findIndex((h) => h.startsWith(nom));
const iFr = col('fran');
const iEn = col('angl');
const iDe = col('allem');
const iEs = col('espagn');
const iIt = col('itali');   // -1 si absent
const iCat = col('cat');

if (iFr < 0) { console.error('Colonne « Français » introuvable.'); process.exit(1); }

const propre = (v) => (v == null ? '' : String(v).trim());
const echapper = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const vus = new Set();
const entrees = [];
let sansItalien = 0;

for (const l of lignes) {
    const fr = propre(l[iFr]);
    if (!fr) continue;

    // Doublon de libellé français : la première occurrence fait foi.
    const cle = fr.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);

    const it = iIt >= 0 ? propre(l[iIt]) : '';
    if (!it) sansItalien++;

    entrees.push({
        categorie: iCat >= 0 ? propre(l[iCat]) : '',
        fr,
        de: iDe >= 0 ? propre(l[iDe]) : '',
        es: iEs >= 0 ? propre(l[iEs]) : '',
        it,
        en: iEn >= 0 ? propre(l[iEn]) : '',
    });
}

const champ = (v) => (v ? `'${echapper(v)}'` : 'null');

const contenu = `import type { Entry } from './part_glossary';

/**
 * Glossaire importé — GÉNÉRÉ, ne pas modifier à la main.
 *
 * Source  : ${path.basename(fichier)}
 * Régénérer : node scripts/import_glossaire_csv.js <fichier.csv>
 *
 * ${entrees.length} termes.${sansItalien ? `\n * ⚠️ ${sansItalien} sans traduction italienne : pour ces termes, le marché
 * italien n'est PAS interrogé (une requête « undefined … » serait pire qu'une
 * absence de résultat). Compléter la colonne italienne du CSV les activera.` : ''}
 */
export const GLOSSAIRE_IMPORTE: Entry[] = [
${entrees.map((e) => `    // ${e.categorie}\n    { fr: [${champ(e.fr)}], de: ${champ(e.de)}, es: ${champ(e.es)}, it: ${champ(e.it)}, en: ${champ(e.en)} },`).join('\n')}
];
`;

fs.writeFileSync(SORTIE, contenu, 'utf8');
console.log(`${entrees.length} termes écrits dans ${path.relative(process.cwd(), SORTIE)}`);
if (sansItalien) console.log(`⚠ ${sansItalien} terme(s) sans italien — marché italien non interrogé pour ceux-ci.`);
