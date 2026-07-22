import axios from 'axios';
import crypto from 'crypto';
import { decodeVinLocal } from '../utils/vin_decoder';
import { prisma } from '../lib/prisma';


const RAPID_API_KEY = process.env.RAPID_API_KEY;

export class VehicleService {

    /**
     * Identifies a vehicle by its License Plate (Registration Number) 
     * using the Global Automotives Cloud API.
     */
    static async getInfoByLicensePlate(plate: string, country: string = 'fr') {
        // Attempt 1: Global Automotives Cloud
        try {
            const options1 = {
                method: 'GET',
                url: 'https://global-automotives-cloud.p.rapidapi.com/vehicle',
                params: { country_code: country, registration_no: plate },
                headers: {
                    'x-rapidapi-key': RAPID_API_KEY,
                    'x-rapidapi-host': 'global-automotives-cloud.p.rapidapi.com'
                }
            };
            const response1 = await axios.request(options1);
            return response1.data;
        } catch (e1) {
            console.log("Global Automotives API failed, trying fallback...");
        }

        // Attempt 2: global-vehicle-list-k-type-hsn-tsn-data-api-for-car-pats
        // NOTE: The user's provided curl had a hardcoded endpoint (/motorcyclelist/bikes/epid/219692771). 
        // This is currently a mock parameter integration to show structure.
        try {
            const options2 = {
                method: 'GET',
                url: `https://global-vehicle-list-k-type-hsn-tsn-data-api-for-car-pats.p.rapidapi.com/motorcyclelist/bikes/epid/${plate}`,
                headers: {
                    'x-rapidapi-host': 'global-vehicle-list-k-type-hsn-tsn-data-api-for-car-pats.p.rapidapi.com',
                    'x-rapidapi-key': RAPID_API_KEY
                }
            };
            const response2 = await axios.request(options2);
            return response2.data;
        } catch (e2: any) {
            console.error('Error fetching by plate (via fallback):', e2.message);
            throw new Error('Failed to fetch vehicle information by license plate on all APIs.');
        }
    }

    static async getInfoByVin(vin: string) {
        const upperVin = vin.toUpperCase();
        console.log(`Starting VIN lookup for ${upperVin}...`);

        // Check local cache first
        try {
            const cachedVehicle = await prisma.vehicle.findUnique({
                where: { vin: upperVin }
            });
            if (cachedVehicle && cachedVehicle.make && cachedVehicle.make !== 'Inconnu') {
                console.log(`Found cached vehicle specifications for VIN: ${upperVin}`);
                return {
                    vin: cachedVehicle.vin,
                    make: cachedVehicle.make,
                    model: cachedVehicle.model,
                    modelYear: cachedVehicle.year,
                    engine: cachedVehicle.engine,
                    source: "Local Cache",
                    specifications: JSON.parse(cachedVehicle.specifications)
                };
            }
        } catch (error: any) {
            console.warn("Failed to read from local Vehicle cache:", error.message);
        }

        // Attempt Vincario decode
        try {
            const vincarioData = await this.decodeWithVincario(upperVin);
            if (vincarioData && !vincarioData.error) {
                // Vincario 3.2 renvoie les donnees dans un tableau `decode` [{label, value}].
                // On l'aplatit en un objet propre { label: value }.
                const specs: any = {};
                if (Array.isArray(vincarioData.decode)) {
                    for (const item of vincarioData.decode) {
                        if (item && item.label != null) specs[item.label] = item.value;
                    }
                } else if (vincarioData && typeof vincarioData === 'object') {
                    for (const [k, v] of Object.entries(vincarioData)) {
                        if (typeof v !== 'object') specs[k] = v;
                    }
                }

                const pick = (...keys: string[]) => {
                    for (const k of keys) if (specs[k] != null && specs[k] !== '') return specs[k];
                    return null;
                };

                const make = pick('Make', 'Marque', 'Manufacturer');
                const model = pick('Model', 'Modèle');
                const yearVal = pick('Model Year', 'Année modèle', 'Year');
                const disp = pick('Engine Displacement (ccm)', 'Cylindrée (cm³)', 'Engine Displacement');
                const fuel = pick('Fuel Type - Primary', 'Fuel Type', 'Carburant');
                const powerKw = pick('Engine Power (kW)', 'Puissance moteur');
                const engine = [disp ? disp + ' cm³' : null, fuel, powerKw ? powerKw + ' kW' : null]
                    .filter(Boolean).join(' ') || null;

                // Cache successful API result (specs a plat)
                try {
                    const vehData = {
                        make: make || "Inconnu",
                        model: model || "Inconnu",
                        year: yearVal ? parseInt(String(yearVal), 10) : null,
                        engine: engine,
                        specifications: JSON.stringify(specs)
                    };
                    await prisma.vehicle.upsert({
                        where: { vin: upperVin },
                        update: vehData,
                        create: { vin: upperVin, ...vehData }
                    });
                    console.log(`Cached vehicle details for VIN: ${upperVin}`);
                } catch (cacheError: any) {
                    console.warn("Failed to write to vehicle cache:", cacheError.message);
                }

                return {
                    vin: upperVin,
                    make,
                    model,
                    modelYear: yearVal ? parseInt(String(yearVal), 10) : null,
                    engine,
                    source: "Vincario API",
                    specifications: specs
                };
            }
        } catch (error: any) {
            console.warn("Vincario API failed. Proceeding with local fallback.", error.message);
        }

        console.log("Vincario API failed or empty. Falling back to local WMI decode.");
        const localData = await decodeVinLocal(upperVin);
        return {
            vin: upperVin,
            make: localData.manufacturer.name,
            model: null,
            modelYear: localData.modelYear,
            engine: null,
            source: "Local WMI Database (Fallback)",
            specifications: null
        };
    }

    /**
     * Performs a direct call to the Vincario VIN Lookup API.
     */
    static async decodeWithVincario(vin: string) {
        const apiKey = process.env.VINCARIO_API_KEY;
        const secretKey = process.env.VINCARIO_SECRET_KEY;
        
        if (!apiKey || !secretKey) {
            console.log("Vincario API keys missing. Skipping Vincario decode.");
            return null;
        }

        const upperVin = vin.toUpperCase();
        const id = "decode";
        const inputStr = `${upperVin}|${id}|${apiKey}|${secretKey}`;
        const hash = crypto.createHash('sha1').update(inputStr).digest('hex');
        const controlSum = hash.substring(0, 10);

        const url = `https://api.vindecoder.eu/3.2/${apiKey}/${controlSum}/${id}/${upperVin}.json`;
        console.log("Querying Vincario API URL:", url);

        try {
            // Disable TLS reject during test if needed
            const rejectUnauthorized = process.env.NODE_ENV === 'production';
            const response = await axios.get(url, { 
                timeout: 5000,
                // If NODE_TLS_REJECT_UNAUTHORIZED environment variable is used, it handles it,
                // otherwise we can set rejectUnauthorized locally to allow local testing
            });
            console.log("Vincario API response status:", response.status);
            return response.data;
        } catch (error: any) {
            console.warn("Vincario API request failed:", error.response?.status, error.response?.data || error.message);
            return null;
        }
    }

    // --- NEW CATALOG ENDPOINTS ---

    /** Helper for standard GET requests to the global-vehicle-list API */
    private static async _fetchCatalog(endpoint: string) {
        const options = {
            method: 'GET',
            url: `https://global-vehicle-list-k-type-hsn-tsn-data-api-for-car-pats.p.rapidapi.com${endpoint}`,
            headers: {
                'x-rapidapi-host': 'global-vehicle-list-k-type-hsn-tsn-data-api-for-car-pats.p.rapidapi.com',
                'x-rapidapi-key': RAPID_API_KEY
            }
        };

        try {
            const response = await axios.request(options);
            return response.data;
        } catch (error: any) {
            console.error(`Error fetching ${endpoint}:`, error.message);
            throw new Error(`Failed to fetch data from catalog API: ${endpoint}`);
        }
    }

    static async getVehicles() {
        return this._fetchCatalog('/vehicles');
    }

    static async getMakes() {
        return this._fetchCatalog('/vehicles/makes');
    }

    static async getModels(make: string) {
        return this._fetchCatalog(`/vehicles/models/${encodeURIComponent(make)}`);
    }

    static async getTypes(make: string, model: string) {
        return this._fetchCatalog(`/vehicles/types/${encodeURIComponent(make)}/${encodeURIComponent(model)}`);
    }

    static async getPlatforms(make: string, model: string, type: string) {
        return this._fetchCatalog(`/vehicles/platforms/${encodeURIComponent(make)}/${encodeURIComponent(model)}/${encodeURIComponent(type)}`);
    }

    static async getYears(make: string, model: string, type: string, platform: string) {
        return this._fetchCatalog(`/vehicles/years/${encodeURIComponent(make)}/${encodeURIComponent(model)}/${encodeURIComponent(type)}/${encodeURIComponent(platform)}`);
    }

    static async getEngines(make: string, model: string, type: string, platform: string, production_period: string) {
        return this._fetchCatalog(`/vehicles/engines/${encodeURIComponent(make)}/${encodeURIComponent(model)}/${encodeURIComponent(type)}/${encodeURIComponent(platform)}/${encodeURIComponent(production_period)}`);
    }

    static async getDetails(make: string, model: string, type: string, platform: string, production_period: string, engine: string) {
        return this._fetchCatalog(`/vehicles/details/${encodeURIComponent(make)}/${encodeURIComponent(model)}/${encodeURIComponent(type)}/${encodeURIComponent(platform)}/${encodeURIComponent(production_period)}/${encodeURIComponent(engine)}`);
    }

    static async getHsnTsn(hsn: string, tsn: string) {
        return this._fetchCatalog(`/vehicles/hsntsn/${encodeURIComponent(hsn)}/${encodeURIComponent(tsn)}`);
    }

    static async getKtype(id: string) {
        return this._fetchCatalog(`/vehicles/ktype/${encodeURIComponent(id)}`);
    }
}
