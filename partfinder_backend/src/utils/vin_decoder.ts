import { EU_WMI_EXTRA } from './wmi_extra';
import { prisma } from '../lib/prisma';


const MODEL_YEAR_MAP: Record<string, number> = {
    "A": 2010, "B": 2011, "C": 2012, "D": 2013, "E": 2014,
    "F": 2015, "G": 2016, "H": 2017, "J": 2018, "K": 2019,
    "L": 2020, "M": 2021, "N": 2022, "P": 2023, "R": 2024,
    "S": 2025,
    "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005,
    "6": 2006, "7": 2007, "8": 2008, "9": 2009,
    // (Older ones A-Y 1980-2000 are skipped or conflict with 2010+, 
    // we use modern mapping by default for EU cars)
};

const REGION_MAP: Record<string, string> = {
    "S": "Royaume-Uni",
    "T": "Suisse / République tchèque / Hongrie",
    "U": "Danemark / Finlande / Irlande / Roumanie",
    "V": "Autriche / France / Espagne / Serbie / Croatie",
    "W": "Allemagne",
    "X": "Bulgarie / Grèce / Pays-Bas / Russie / Ukraine",
    "Y": "Belgique / Finlande / Suède",
    "Z": "Italie / Slovénie",
    "1": "États-Unis", "4": "États-Unis", "5": "États-Unis",
    "2": "Canada",
    "3": "Mexique",
    "J": "Japon", "K": "Corée du Sud"
};

export async function decodeVinLocal(vin: string) {
    if (vin.length !== 17) {
        throw new Error(`VIN invalide: doit faire 17 caractères (reçu ${vin.length})`);
    }

    const wmi = vin.substring(0, 3).toUpperCase();
    const vds = vin.substring(3, 9).toUpperCase();
    const vis = vin.substring(9).toUpperCase();
    const regionChar = vin.charAt(0).toUpperCase();
    const yearChar = vin.charAt(9).toUpperCase();

    let manufacturer = "Inconnu";
    let country = REGION_MAP[regionChar] || "Inconnu";
    let city = "Inconnu";
    const region = "Europe"; // Assumption for this local decoder context

    // Check WMI extra
    const extra = EU_WMI_EXTRA[wmi];
    if (extra) {
        manufacturer = extra.manufacturer;
        country = extra.country || country;
        city = extra.city || city;
    }

    // Attempt Model Year (10th character)
    let modelYear = MODEL_YEAR_MAP[yearChar] || null;

    // Look up local DB for models matching this manufacturer
    let modelsFound: string[] = [];
    if (manufacturer !== "Inconnu") {
        const makeFromDb = await prisma.vehicleMake.findUnique({
            where: { name: manufacturer },
            include: { models: { take: 20 } }
        });

        if (makeFromDb) {
            modelsFound = makeFromDb.models.map(m => m.name);
        } else {
            // Fallback: try first word (e.g "BMW M" -> "BMW")
            const shortName = manufacturer.split(' ')[0];
            const fallbackMake = await prisma.vehicleMake.findUnique({
                where: { name: shortName },
                include: { models: { take: 20 } }
            });
            if (fallbackMake) {
                modelsFound = fallbackMake.models.map(m => m.name);
            }
        }
    }

    return {
        vin,
        structure: {
            wmi,
            vds,
            vis
        },
        manufacturer: {
            name: manufacturer,
            country,
            city,
            wmi_code: wmi
        },
        modelYear,
        catalog: {
            source: "Local DB (vehicle-make-model-data)",
            models_found: modelsFound.length,
            models: modelsFound,
            note: "Aperçu des modèles de ce constructeur existants en base"
        },
        warnings: [
            "Le décodage détaillé du VDS (positions 4 à 9) est un format protégé par les constructeurs européens. La base locale aide par corrélation WMI.",
            "Checksum ISO 3779 position 9 non calculé car souvent invalide en EU."
        ]
    };
}
