import axios from 'axios';

/**
 * Détermination de la pièce détachée par IA.
 *
 * À partir des infos véhicule (marque, modèle, année, moteur, VIN) et de la
 * demande du client (texte libre et/ou référence OEM), produit :
 *   - une pièce structurée (nom FR/EN, position, OEM éventuel)
 *   - une requête eBay optimisée avec la terminologie attendue par eBay.
 *
 * Utilise l'API Anthropic si ANTHROPIC_API_KEY est présente, sinon un
 * constructeur heuristique de requête (dégradé mais fonctionnel).
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

export interface VehicleContext {
    vin?: string | null;
    make?: string | null;
    model?: string | null;
    year?: string | number | null;
    engine?: string | null;
}

export interface PartRequest {
    /** Demande en langage naturel : "plaquettes de frein avant", "phare droit"... */
    description?: string;
    /** Référence OEM/constructeur si fournie par le client. */
    oem?: string;
}

export interface DeterminedPart {
    partName: string;         // Nom de la pièce en français
    partNameEn: string;       // Nom de la pièce en anglais (terminologie eBay)
    oem: string | null;       // Référence OEM si connue/déduite
    position: string | null;  // avant/arrière, gauche/droite, etc.
    category: string | null;  // famille (freinage, filtration, éclairage...)
    keywords: string[];       // mots-clés pertinents
    ebayQuery: string;        // requête eBay finale optimisée
    source: 'ai' | 'heuristic';
}

export class PartAiService {

    static isConfigured(): boolean {
        return Boolean(ANTHROPIC_API_KEY);
    }

    static async determinePart(vehicle: VehicleContext, request: PartRequest): Promise<DeterminedPart> {
        if (this.isConfigured()) {
            try {
                return await this.determineWithAI(vehicle, request);
            } catch (err: any) {
                console.error('[PartAI] Échec IA, repli heuristique:', err.response?.data || err.message);
            }
        }
        return this.determineHeuristic(vehicle, request);
    }

    private static async determineWithAI(vehicle: VehicleContext, request: PartRequest): Promise<DeterminedPart> {
        const vehicleStr = [
            vehicle.make, vehicle.model, vehicle.year, vehicle.engine,
        ].filter(Boolean).join(' ');

        const system = `Tu es un expert en pièces détachées automobiles et en recherche sur eBay.
À partir d'un véhicule et d'une demande client, tu identifies la pièce exacte et tu construis
la meilleure requête de recherche eBay possible en utilisant la terminologie attendue par eBay
(nom de pièce précis, position, marque/OEM si pertinent, véhicule).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, au format :
{
  "partName": "nom de la pièce en français",
  "partNameEn": "part name in English",
  "oem": "référence OEM si connue sinon null",
  "position": "avant/arrière/gauche/droite si pertinent sinon null",
  "category": "famille de pièce (ex: freinage, filtration, éclairage) sinon null",
  "keywords": ["mot-clé", "..."],
  "ebayQuery": "requête eBay optimale, concise, ~4 à 8 termes clés"
}
La ebayQuery doit combiner: type de pièce + position + marque/modèle + motorisation + OEM si dispo.`;

        const user = `Véhicule: ${vehicleStr || 'inconnu'}
VIN: ${vehicle.vin || 'inconnu'}
Demande client: ${request.description || '(non précisée)'}
Référence OEM fournie: ${request.oem || 'aucune'}`;

        const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
                model: ANTHROPIC_MODEL,
                max_tokens: 700,
                system,
                messages: [{ role: 'user', content: user }],
            },
            {
                headers: {
                    'x-api-key': ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                timeout: 30000,
            }
        );

        const text: string = response.data?.content?.[0]?.text || '';
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/({[\s\S]*})/);
        const jsonString = jsonMatch ? jsonMatch[1] : text;
        const parsed = JSON.parse(jsonString);

        return {
            partName: parsed.partName || request.description || 'Pièce',
            partNameEn: parsed.partNameEn || '',
            oem: parsed.oem || request.oem || null,
            position: parsed.position || null,
            category: parsed.category || null,
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
            ebayQuery: parsed.ebayQuery || this.buildHeuristicQuery(vehicle, request),
            source: 'ai',
        };
    }

    private static determineHeuristic(vehicle: VehicleContext, request: PartRequest): DeterminedPart {
        const partName = request.description || 'Pièce détachée';
        return {
            partName,
            partNameEn: '',
            oem: request.oem || null,
            position: null,
            category: null,
            keywords: [vehicle.make, vehicle.model, request.description].filter(Boolean) as string[],
            ebayQuery: this.buildHeuristicQuery(vehicle, request),
            source: 'heuristic',
        };
    }

    private static buildHeuristicQuery(vehicle: VehicleContext, request: PartRequest): string {
        const parts = [
            request.oem,
            request.description,
            vehicle.make,
            vehicle.model,
            vehicle.engine,
        ].filter(Boolean);
        return parts.join(' ').trim() || 'pièce détachée auto';
    }
}
