import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const specifications = {
    "VIN": "WDD2462421N227311",
    "ID Véhicule": "2987",
    "Marque": "Mercedes-Benz",
    "Modèle": "B 180",
    "Année modèle": "2017",
    "Type de produit": "Voiture",
    "Carrosserie": "Break (Wagon)",
    "Série": "W246 (2011-)",
    "Transmission": "Traction avant",
    "Cylindrée (cm³)": "1595",
    "Puissance moteur": "90 kW / 121 ch",
    "Carburant": "Essence",
    "Code moteur": "270910",
    "Fabricant": "DAIMLER AG, D-70546 Stuttgart",
    "Adresse fabricant": "Mercedesstrasse 137, D-70546 Stuttgart, Allemagne",
    "Pays de fabrication": "Allemagne",
    "Régime moteur (RPM)": "5000",
    "Couple moteur (RPM)": "5000",
    "Type moteur": "4 temps / 4 cyl. / Row-T-DI",
    "Émission CO2 moyenne": "133,92 g/km",
    "Nombre de roues": "4",
    "Nombre d'essieux": "2",
    "Nombre de portes": "5",
    "Nombre de places": "5",
    "Freins avant": "Disque",
    "Système de freinage": "Hydraulique",
    "Suspension": "Silentbloc / Vis",
    "Direction": "Direction électrique",
    "Taille de roues": "205/55R16 * 225/40R18 XL * 225/45R17",
    "Empattement": "2699 mm",
    "Hauteur": "1572 mm",
    "Longueur": "4439 mm",
    "Largeur": "1786 mm",
    "Voie avant": "1555 mm",
    "Voie arrière": "1545 mm",
    "Vitesse max": "200 km/h",
    "Poids à vide": "1350 kg",
    "Poids max": "1960 kg",
    "Charge max toit": "75 kg",
    "Charge max remorque sans freins": "710 kg",
    "ABS": "Oui (1)",
    "Chiffre de contrôle": "2",
    "Numéro séquentiel": "227311"
};

async function main() {
    console.log("Seeding VIN cache table for WDD2462421N227311...");

    const vin = "WDD2462421N227311".toUpperCase();

    await prisma.vehicle.upsert({
        where: { vin },
        update: {
            make: "Mercedes-Benz",
            model: "B 180",
            year: 2017,
            engine: "1.6 Benzine 90 kW",
            specifications: JSON.stringify(specifications)
        },
        create: {
            vin,
            make: "Mercedes-Benz",
            model: "B 180",
            year: 2017,
            engine: "1.6 Benzine 90 kW",
            specifications: JSON.stringify(specifications)
        }
    });

    console.log("VIN WDD2462421N227311 cached successfully!");
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
