import { describe, it, expect } from 'vitest';
import {
    validerAdresse, territoireDepuisCodePostal, zoneDeTerritoire,
    formatAdresse, TERRITOIRES,
} from './territoires';

const BASE = {
    destinataire: 'Garage Martin',
    ligne1: '12 rue des Cocotiers',
    codePostal: '97400',
    ville: 'Saint-Denis',
    territoire: 'REUNION',
    telephone: '0692123456',
};

describe('territoires — la zone commande tout le tarif', () => {
    it('dérive la zone du territoire, jamais du client', () => {
        expect(zoneDeTerritoire('REUNION')).toBe('OM1');
        expect(zoneDeTerritoire('NOUVELLE_CALEDONIE')).toBe('OM2');
        expect(zoneDeTerritoire('POLYNESIE')).toBe('OM2');
    });

    it('refuse un territoire inconnu au lieu de retomber sur OM1', () => {
        // Retomber silencieusement sur OM1 ferait facturer un envoi Pacifique
        // au tarif Antilles — vente à perte.
        expect(zoneDeTerritoire('ATLANTIDE')).toBeNull();
        expect(zoneDeTerritoire(null)).toBeNull();
        expect(validerAdresse({ ...BASE, territoire: 'ATLANTIDE' }).ok).toBe(false);
    });

    it('devine le territoire depuis le code postal', () => {
        expect(territoireDepuisCodePostal('97400')?.code).toBe('REUNION');
        expect(territoireDepuisCodePostal('98800')?.code).toBe('NOUVELLE_CALEDONIE');
        expect(territoireDepuisCodePostal('97100')?.code).toBe('GUADELOUPE');
        expect(territoireDepuisCodePostal('75001')).toBeNull(); // métropole
        expect(territoireDepuisCodePostal('abc')).toBeNull();
    });

    it('BLOQUE une incohérence code postal / territoire', () => {
        // Cas critique : code postal Réunion (OM1) avec territoire
        // Nouvelle-Calédonie (OM2). Deviner ferait un tarif faux.
        const r = validerAdresse({ ...BASE, codePostal: '97400', territoire: 'NOUVELLE_CALEDONIE' });
        expect(r.ok).toBe(false);
        expect(r.erreurs.join(' ')).toContain('La Réunion');
    });

    it('accepte une adresse complète et cohérente', () => {
        const r = validerAdresse(BASE);
        expect(r.ok).toBe(true);
        expect(r.valeur?.zone).toBe('OM1');
        expect(r.valeur?.territoireLabel).toBe('La Réunion');
    });

    it('exige le téléphone (sinon le colis reste en instance)', () => {
        const r = validerAdresse({ ...BASE, telephone: '' });
        expect(r.ok).toBe(false);
        expect(r.erreurs.join(' ')).toMatch(/[Tt]éléphone/);
    });

    it('valide le format du code postal', () => {
        expect(validerAdresse({ ...BASE, codePostal: '974' }).ok).toBe(false);
        expect(validerAdresse({ ...BASE, codePostal: 'AB400' }).ok).toBe(false);
    });

    it('remonte tous les champs manquants d\'un coup', () => {
        const r = validerAdresse({});
        expect(r.ok).toBe(false);
        expect(r.erreurs.length).toBeGreaterThanOrEqual(5);
    });

    it('nettoie les espaces du code postal', () => {
        const r = validerAdresse({ ...BASE, codePostal: '974 00' });
        expect(r.ok).toBe(true);
        expect(r.valeur?.codePostal).toBe('97400');
    });

    it('formate une adresse lisible pour les documents', () => {
        const txt = formatAdresse(validerAdresse(BASE).valeur!);
        expect(txt).toContain('Garage Martin');
        expect(txt).toContain('97400 Saint-Denis');
        expect(txt).toContain('La Réunion');
    });

    it('couvre les territoires annoncés dans les CGV', () => {
        const codes = TERRITOIRES.map(t => t.code);
        for (const c of ['GUADELOUPE', 'MARTINIQUE', 'GUYANE', 'REUNION', 'MAYOTTE',
            'SAINT_PIERRE_MIQUELON', 'SAINT_MARTIN', 'SAINT_BARTHELEMY',
            'NOUVELLE_CALEDONIE', 'POLYNESIE', 'WALLIS_FUTUNA']) {
            expect(codes).toContain(c);
        }
        // Aucun préfixe de code postal partagé : la détection auto serait ambiguë.
        const prefixes = TERRITOIRES.flatMap(t => t.prefixes);
        expect(new Set(prefixes).size).toBe(prefixes.length);
    });
});
