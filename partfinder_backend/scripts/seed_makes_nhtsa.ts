import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const acronyms = new Set(['BMW', 'BYD', 'GMC', 'AMG', 'DS']);

function formatMakeName(name: string): string {
    const uppercased = name.toUpperCase().trim();
    if (acronyms.has(uppercased)) {
        return uppercased;
    }
    if (uppercased === 'MERCEDES-BENZ') return 'Mercedes-Benz';
    
    return uppercased
        .toLowerCase()
        .split(/([\s\-])/)
        .map(part => {
            if (part === ' ' || part === '-') return part;
            return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join('');
}

async function main() {
    console.log("Fetching passenger car makes from NHTSA vPIC API...");
    const url = 'https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json';
    
    try {
        const response = await axios.get(url, { timeout: 15000 });
        const results = response.data.Results || [];
        console.log(`Found ${results.length} makes in NHTSA dataset.`);

        // Format and clean names
        const formattedMakes = Array.from(
            new Set(results.map((r: any) => formatMakeName(r.MakeName)).filter(Boolean))
        ) as string[];

        console.log(`Normalized to ${formattedMakes.length} unique makes. Inserting into SQLite database...`);

        let insertedCount = 0;
        for (const makeName of formattedMakes) {
            try {
                await prisma.vehicleMake.upsert({
                    where: { name: makeName },
                    update: {},
                    create: { name: makeName }
                });
                insertedCount++;
            } catch (err) {
                // Ignore duplicates
            }
        }

        console.log(`Success! Pre-seeded ${insertedCount} car makes in the database.`);
    } catch (error: any) {
        console.error("Failed to seed makes from NHTSA:", error.message);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
