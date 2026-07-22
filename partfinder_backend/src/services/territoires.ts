/**
 * Territoires d'outre-mer desservis — RÉFÉRENTIEL CANONIQUE.
 *
 * La zone (OM1/OM2) commande tout le tarif d'acheminement : une erreur ici se
 * paie directement en marge. Elle est donc TOUJOURS dérivée du territoire côté
 * serveur, jamais reprise de ce que déclare le navigateur.
 */

export type Zone = 'OM1' | 'OM2';

export interface Territoire {
    code: string;
    label: string;
    zone: Zone;
    /** Préfixes de code postal (5 chiffres) permettant la détection auto. */
    prefixes: string[];
}

export const TERRITOIRES: Territoire[] = [
    { code: 'GUADELOUPE', label: 'Guadeloupe', zone: 'OM1', prefixes: ['971'] },
    { code: 'MARTINIQUE', label: 'Martinique', zone: 'OM1', prefixes: ['972'] },
    { code: 'GUYANE', label: 'Guyane', zone: 'OM1', prefixes: ['973'] },
    { code: 'REUNION', label: 'La Réunion', zone: 'OM1', prefixes: ['974'] },
    { code: 'SAINT_PIERRE_MIQUELON', label: 'Saint-Pierre-et-Miquelon', zone: 'OM1', prefixes: ['975'] },
    { code: 'MAYOTTE', label: 'Mayotte', zone: 'OM1', prefixes: ['976'] },
    { code: 'SAINT_BARTHELEMY', label: 'Saint-Barthélemy', zone: 'OM1', prefixes: ['977'] },
    { code: 'SAINT_MARTIN', label: 'Saint-Martin', zone: 'OM1', prefixes: ['978'] },
    { code: 'WALLIS_FUTUNA', label: 'Wallis-et-Futuna', zone: 'OM2', prefixes: ['986'] },
    { code: 'POLYNESIE', label: 'Polynésie française', zone: 'OM2', prefixes: ['987'] },
    { code: 'NOUVELLE_CALEDONIE', label: 'Nouvelle-Calédonie', zone: 'OM2', prefixes: ['988'] },
];

const PAR_CODE = new Map(TERRITOIRES.map((t) => [t.code, t]));

export function findTerritoire(code: unknown): Territoire | null {
    if (typeof code !== 'string') return null;
    return PAR_CODE.get(code.trim().toUpperCase()) ?? null;
}

/** Zone d'un territoire. OM1 par défaut serait un choix dangereux : on exige un territoire connu. */
export function zoneDeTerritoire(code: unknown): Zone | null {
    return findTerritoire(code)?.zone ?? null;
}

/** Devine le territoire à partir du code postal (confort de saisie + garde-fou). */
export function territoireDepuisCodePostal(cp: unknown): Territoire | null {
    const s = String(cp ?? '').replace(/\s/g, '');
    if (!/^\d{5}$/.test(s)) return null;
    return TERRITOIRES.find((t) => t.prefixes.some((p) => s.startsWith(p))) ?? null;
}

export interface AdresseSaisie {
    destinataire: string;
    ligne1: string;
    ligne2?: string | null;
    codePostal: string;
    ville: string;
    territoire: string;
    telephone?: string | null;
}

export interface ValidationAdresse {
    ok: boolean;
    erreurs: string[];
    /** Adresse nettoyée + zone dérivée côté serveur. */
    valeur: (AdresseSaisie & { zone: Zone; territoireLabel: string }) | null;
}

/**
 * Valide et normalise une adresse de livraison.
 * Le téléphone est OBLIGATOIRE : Colissimo Outre-mer s'en sert pour prévenir
 * le destinataire, et sans lui les colis restent en instance.
 */
export function validerAdresse(a: any): ValidationAdresse {
    const erreurs: string[] = [];
    const txt = (v: any) => String(v ?? '').trim();

    const destinataire = txt(a?.destinataire);
    const ligne1 = txt(a?.ligne1);
    const ligne2 = txt(a?.ligne2) || null;
    const codePostal = txt(a?.codePostal).replace(/\s/g, '');
    const ville = txt(a?.ville);
    const telephone = txt(a?.telephone) || null;

    if (destinataire.length < 2) erreurs.push('Nom du destinataire requis.');
    if (ligne1.length < 4) erreurs.push('Adresse (rue) requise.');
    if (!/^\d{5}$/.test(codePostal)) erreurs.push('Code postal invalide (5 chiffres attendus).');
    if (ville.length < 2) erreurs.push('Ville requise.');
    if (!telephone) erreurs.push('Téléphone requis (obligatoire pour la livraison outre-mer).');
    else if (!/^[\d +().-]{6,20}$/.test(telephone)) erreurs.push('Téléphone invalide.');

    const terr = findTerritoire(a?.territoire);
    if (!terr) {
        erreurs.push('Territoire de livraison requis.');
    } else if (/^\d{5}$/.test(codePostal)) {
        // Incohérence code postal / territoire : bloquer plutôt que deviner.
        // Un mauvais territoire = mauvaise zone = tarif d'acheminement faux.
        const devine = territoireDepuisCodePostal(codePostal);
        if (devine && devine.code !== terr.code) {
            erreurs.push(
                `Le code postal ${codePostal} correspond à ${devine.label}, pas à ${terr.label}.`
            );
        }
    }

    if (erreurs.length || !terr) return { ok: false, erreurs, valeur: null };

    return {
        ok: true,
        erreurs: [],
        valeur: {
            destinataire, ligne1, ligne2, codePostal, ville, telephone,
            territoire: terr.code,
            territoireLabel: terr.label,
            zone: terr.zone,
        },
    };
}

/** Représentation texte (conservée sur la commande, imprimée sur les documents). */
export function formatAdresse(a: AdresseSaisie & { territoireLabel?: string }): string {
    const terr = a.territoireLabel || findTerritoire(a.territoire)?.label || a.territoire;
    return [
        a.destinataire,
        a.ligne1,
        a.ligne2 || null,
        `${a.codePostal} ${a.ville}`,
        terr,
        a.telephone ? `Tél. ${a.telephone}` : null,
    ].filter(Boolean).join('\n');
}
