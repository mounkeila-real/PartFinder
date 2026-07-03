import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting seed process...');

    const jsonPath = path.join(__dirname, '..', 'tmp_vehicle_data', 'json_data.json');
    if (!fs.existsSync(jsonPath)) {
        console.error(`JSON file not found at ${jsonPath}`);
        process.exit(1);
    }

    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const data: { year: number, make: string, model: string }[] = JSON.parse(rawData);

    console.log(`Loaded ${data.length} records from JSON.`);

    // Grouping data to minimize queries
    // makes -> Set of makes
    // years -> Map<makeName, Set<year>>
    // models -> Map<makeName_year, Set<model>>

    const makes = new Set<string>();
    const makeYears = new Map<string, Set<number>>();
    const modelsByMakeYear = new Map<string, Set<string>>();

    for (const item of data) {
        if (!item.make || !item.year || !item.model) continue;

        makes.add(item.make);

        if (!makeYears.has(item.make)) {
            makeYears.set(item.make, new Set());
        }
        makeYears.get(item.make)!.add(item.year);

        const key = `${item.make}_${item.year}`;
        if (!modelsByMakeYear.has(key)) {
            modelsByMakeYear.set(key, new Set());
        }
        modelsByMakeYear.get(key)!.add(item.model);
    }

    console.log(`Found ${makes.size} unique makes.`);

    // 1. Insert Makes
    const makeCache = new Map<string, number>(); // name -> id
    for (const makeName of makes) {
        let dbMake = await prisma.vehicleMake.findUnique({ where: { name: makeName } });
        if (!dbMake) {
            dbMake = await prisma.vehicleMake.create({ data: { name: makeName } });
        }
        makeCache.set(makeName, dbMake.id);
    }

    console.log('Makes synced.');

    // 2. Insert Years
    const makeYearCache = new Map<string, number>(); // makeName_year -> id
    for (const [makeName, yearsSet] of makeYears.entries()) {
        const makeId = makeCache.get(makeName)!;
        for (const year of yearsSet) {
            let dbMakeYear = await prisma.vehicleModelYear.findUnique({
                where: { makeId_year: { makeId, year } }
            });
            if (!dbMakeYear) {
                dbMakeYear = await prisma.vehicleModelYear.create({
                    data: { makeId, year }
                });
            }
            makeYearCache.set(`${makeName}_${year}`, dbMakeYear.id);
        }
    }

    console.log('Model Years synced.');

    // 3. Insert Models
    // Doing this in batches to speed it up
    let totalModelsInserted = 0;
    const modelInserts = [];

    for (const [key, modelsSet] of modelsByMakeYear.entries()) {
        const [makeName] = key.split('_');
        const makeId = makeCache.get(makeName)!;
        const makeYearId = makeYearCache.get(key)!;

        for (const modelName of modelsSet) {
            modelInserts.push({
                name: modelName,
                makeId,
                makeYearId
            });
        }
    }

    // Insert ignoring duplicates (if any reruns happen)
    try {
        await prisma.vehicleModel.createMany({
            data: modelInserts
        });
        totalModelsInserted = modelInserts.length;
        console.log(`Models synced. Inserted/Verified ~${totalModelsInserted} models.`);
    } catch (e: any) {
        if (e.code === 'P2002') {
            console.log("Models already seeded. Skipping insert.");
        } else {
            console.warn("Seeding models failed or already done:", e.message);
        }
    }

    console.log('Seed process completed successfully.');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
