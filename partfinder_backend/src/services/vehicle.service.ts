import axios from 'axios';

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

    /**
     * Decodes a VIN using the vin-decoder19 API.
     */
    static async getInfoByVin(vin: string) {
        const options = {
            method: 'GET',
            url: 'https://vin-decoder19.p.rapidapi.com/vin_decoder_standard',
            params: { vin },
            headers: {
                'x-rapidapi-key': RAPID_API_KEY,
                'x-rapidapi-host': 'vin-decoder19.p.rapidapi.com'
            }
        };

        try {
            const response = await axios.request(options);
            return response.data;
        } catch (error: any) {
            console.error('Error fetching by VIN:', error.message);
            throw new Error('Failed to decode VIN.');
        }
    }
}
