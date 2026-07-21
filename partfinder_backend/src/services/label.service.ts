/**
 * Génération d'étiquettes d'expédition.
 *
 * L'API Colissimo Entreprise (étiquette + tracking automatiques) exige un
 * contrat. En attendant, `ManualLabelProvider` produit les données CN23 à
 * recopier dans l'interface La Poste, et l'opérateur saisit le numéro de suivi.
 * Le jour du contrat, seul `ColissimoApiProvider` reste à implémenter : le
 * reste du parcours ne bouge pas.
 */

export interface Cn23Line {
    designation: string;
    quantite: number;
    poidsNetKg: number;
    valeurEur: number;
    codeSH: string;
    origine: string;
}

export interface Cn23Data {
    expediteur: {
        nom: string; adresse: string; codePostal: string; ville: string; pays: string;
    };
    destinataire: {
        nom: string; adresse: string; codePostal: string; ville: string; territoire: string; telephone?: string | null;
    };
    lignes: Cn23Line[];
    poidsTotalKg: number;
    valeurTotaleEur: number;
    nature: string;
    /** Mention obligatoire : les taxes locales restent dues par le destinataire. */
    mentions: string;
}

export interface LabelResult {
    /** Numéro de suivi si le fournisseur l'a généré, sinon null (saisie manuelle). */
    tracking: string | null;
    /** Étiquette encodée (PDF base64) si disponible. */
    labelBase64: string | null;
    /** Données à recopier quand aucune étiquette n'est générée. */
    cn23: Cn23Data;
    provider: string;
    manuel: boolean;
}

export interface LabelProvider {
    readonly name: string;
    isConfigured(): boolean;
    createLabel(cn23: Cn23Data): Promise<LabelResult>;
}

// Adresse de l'entrepôt (expéditeur).
export const EXPEDITEUR = {
    nom: process.env.WAREHOUSE_NAME || 'PartFinder',
    adresse: process.env.WAREHOUSE_ADDRESS || '92 rue d\'Eich',
    codePostal: process.env.WAREHOUSE_ZIP || '57430',
    ville: process.env.WAREHOUSE_CITY || 'Sarralbe',
    pays: 'France',
};

/** Code SH par défaut : parties et accessoires de véhicules automobiles. */
export const DEFAULT_CODE_SH = process.env.DEFAULT_CODE_SH || '8708.99';

export const ManualLabelProvider: LabelProvider = {
    name: 'manuel',
    isConfigured: () => true,
    async createLabel(cn23: Cn23Data): Promise<LabelResult> {
        return { tracking: null, labelBase64: null, cn23, provider: 'manuel', manuel: true };
    },
};

/**
 * À implémenter avec un contrat Colissimo Entreprise.
 * Variables attendues : COLISSIMO_CONTRACT_NUMBER, COLISSIMO_PASSWORD.
 */
export const ColissimoApiProvider: LabelProvider = {
    name: 'colissimo-entreprise',
    isConfigured: () => !!(process.env.COLISSIMO_CONTRACT_NUMBER && process.env.COLISSIMO_PASSWORD),
    async createLabel(): Promise<LabelResult> {
        throw new Error(
            "Génération d'étiquette Colissimo non implémentée : nécessite un contrat Entreprise " +
            '(COLISSIMO_CONTRACT_NUMBER / COLISSIMO_PASSWORD).'
        );
    },
};

export function activeLabelProvider(): LabelProvider {
    return ColissimoApiProvider.isConfigured() ? ColissimoApiProvider : ManualLabelProvider;
}

/** Construit la déclaration CN23 à partir d'une expédition. */
export function buildCn23(params: {
    destinataire: Cn23Data['destinataire'];
    lignes: Cn23Line[];
    poidsTotalKg: number;
}): Cn23Data {
    const valeurTotaleEur = params.lignes.reduce((s, l) => s + l.valeurEur * l.quantite, 0);
    return {
        expediteur: EXPEDITEUR,
        destinataire: params.destinataire,
        lignes: params.lignes,
        poidsTotalKg: Math.round(params.poidsTotalKg * 100) / 100,
        valeurTotaleEur: Math.round(valeurTotaleEur * 100) / 100,
        nature: 'Marchandises',
        mentions:
            "Pièces détachées automobiles d'occasion. Octroi de mer et taxes locales " +
            'à la charge du destinataire.',
    };
}
