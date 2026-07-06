import express from 'express';
import axios from 'axios';
import { VehicleService } from '../services/vehicle.service';

const router = express.Router();

// Lookup vehicle by license plate (registration number)
router.get('/plate/:plate', async (req: express.Request, res: express.Response) => {
    try {
        const plate = req.params.plate as string;
        const country = req.query.country as string || 'fr';

        const data = await VehicleService.getInfoByLicensePlate(plate, country);
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Decode VIN
router.get('/vin/:vin', async (req: express.Request, res: express.Response) => {
    try {
        const vin = req.params.vin as string;
        // In a full implementation, we would query the local WMI DB here first.

        const data = await VehicleService.getInfoByVin(vin);
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- CATALOG ENDPOINTS ---
// Proxy methods to external catalog 
router.get('/all', async (req: express.Request, res: express.Response) => {
    try {
        const data = await VehicleService.getVehicles();
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/types/:make/:model', async (req: express.Request, res: express.Response) => {
    try {
        const make = req.params.make as string;
        const model = req.params.model as string;
        const data = await VehicleService.getTypes(make, model);
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/platforms/:make/:model/:type', async (req: express.Request, res: express.Response) => {
    try {
        const make = req.params.make as string;
        const model = req.params.model as string;
        const type = req.params.type as string;
        const data = await VehicleService.getPlatforms(make, model, type);
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/years/:make/:model/:type/:platform', async (req: express.Request, res: express.Response) => {
    try {
        const make = req.params.make as string;
        const model = req.params.model as string;
        const type = req.params.type as string;
        const platform = req.params.platform as string;
        const data = await VehicleService.getYears(make, model, type, platform);
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/engines/:make/:model/:type/:platform/:production_period', async (req: express.Request, res: express.Response) => {
    try {
        const make = req.params.make as string;
        const model = req.params.model as string;
        const type = req.params.type as string;
        const platform = req.params.platform as string;
        const production_period = req.params.production_period as string;
        const data = await VehicleService.getEngines(make, model, type, platform, production_period);
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/details/:make/:model/:type/:platform/:production_period/:engine', async (req: express.Request, res: express.Response) => {
    try {
        const make = req.params.make as string;
        const model = req.params.model as string;
        const type = req.params.type as string;
        const platform = req.params.platform as string;
        const production_period = req.params.production_period as string;
        const engine = req.params.engine as string;
        const data = await VehicleService.getDetails(make, model, type, platform, production_period, engine);
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/hsntsn/:hsn/:tsn', async (req: express.Request, res: express.Response) => {
    try {
        const hsn = req.params.hsn as string;
        const tsn = req.params.tsn as string;
        const data = await VehicleService.getHsnTsn(hsn, tsn);
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/ktype/:id', async (req: express.Request, res: express.Response) => {
    try {
        const data = await VehicleService.getKtype(req.params.id as string);
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// --- LOCAL DB ENDPOINTS ---

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get all makes (auto-remplissage depuis NHTSA si la table est quasi vide)
router.get('/makes', async (req: express.Request, res: express.Response) => {
    try {
        let makes = await prisma.vehicleMake.findMany({ orderBy: { name: 'asc' } });

        if (makes.length < 20) {
            console.log('Table des marques quasi vide. Chargement depuis NHTSA...');
            try {
                const url = 'https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json';
                const response = await axios.get(url, { timeout: 15000 });
                const results = response.data.Results || [];
                const acronyms = new Set(['BMW', 'BYD', 'GMC', 'AMG', 'DS']);
                const format = (name: string): string => {
                    const up = String(name).toUpperCase().trim();
                    if (acronyms.has(up)) return up;
                    if (up === 'MERCEDES-BENZ') return 'Mercedes-Benz';
                    return up.toLowerCase().split(/([\s\-])/)
                        .map(part => (part === ' ' || part === '-') ? part : part.charAt(0).toUpperCase() + part.slice(1))
                        .join('');
                };
                const names = Array.from(
                    new Set(results.map((r: any) => format(r.MakeName)).filter(Boolean))
                ) as string[];
                if (names.length) {
                    await prisma.vehicleMake.createMany({
                        data: names.map(name => ({ name })),
                        skipDuplicates: true
                    });
                    makes = await prisma.vehicleMake.findMany({ orderBy: { name: 'asc' } });
                }
            } catch (seedErr: any) {
                console.warn('Auto-seed des marques echoue:', seedErr.message);
            }
        }

        res.json(makes);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get years for a make
router.get('/makes/:makeId/years', async (req: express.Request, res: express.Response) => {
    try {
        const makeId = parseInt(req.params.makeId as string, 10);
        const years = await prisma.vehicleModelYear.findMany({
            where: { makeId },
            orderBy: { year: 'desc' }
        });
        res.json(years);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get models for a make and year
router.get('/makes/:makeId/years/:makeYearId/models', async (req: express.Request, res: express.Response) => {
    try {
        const makeId = parseInt(req.params.makeId as string, 10);
        const makeYearId = parseInt(req.params.makeYearId as string, 10);
        const models = await prisma.vehicleModel.findMany({
            where: { makeId, makeYearId },
            orderBy: { name: 'asc' }
        });
        res.json(models);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get all models for a make by make name
router.get('/models/:makeName', async (req: express.Request, res: express.Response) => {
    try {
        const makeName = req.params.makeName as string;
        const makes = await prisma.vehicleMake.findMany();
        let makeObj = makes.find(m => m.name.toLowerCase() === makeName.toLowerCase());

        if (!makeObj) {
            console.log(`Make "${makeName}" not found in DB. Fetching from NHTSA...`);
            const nhtsaUrl = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(makeName)}?format=json`;
            try {
                const response = await axios.get(nhtsaUrl, { timeout: 8000 });
                const results = response.data.Results || [];
                if (results.length > 0) {
                    const officialMakeName = results[0].Make_Name || makeName;
                    
                    // Double check in memory to prevent duplicate create on different capitalization
                    makeObj = makes.find(m => m.name.toLowerCase() === officialMakeName.toLowerCase());
                    
                    if (!makeObj) {
                        // Create Make in DB
                        makeObj = await prisma.vehicleMake.create({
                            data: { name: officialMakeName }
                        });
                    }

                    // Create a default Model Year (2020) for relation constraints
                    let defaultYear = await prisma.vehicleModelYear.findFirst({
                        where: { makeId: makeObj.id, year: 2020 }
                    });
                    if (!defaultYear) {
                        defaultYear = await prisma.vehicleModelYear.create({
                            data: {
                                makeId: makeObj.id,
                                year: 2020
                            }
                        });
                    }

                    // Insert models in bulk
                    const modelNames = Array.from(new Set(results.map((r: any) => r.Model_Name).filter(Boolean)));
                    const modelInserts = modelNames.map((name: any) => ({
                        name,
                        makeId: makeObj!.id,
                        makeYearId: defaultYear!.id
                    }));

                    try {
                        await prisma.vehicleModel.createMany({
                            data: modelInserts
                        });
                    } catch (dbErr) {
                        // Ignore duplicate key errors on SQLite
                    }
                    console.log(`Cached ${modelNames.length} models for "${officialMakeName}" from NHTSA in SQLite DB.`);
                }
            } catch (apiError: any) {
                console.error("NHTSA API fetch failed:", apiError.message);
            }
        }

        // Return models if brand exists
        if (makeObj) {
            const models = await prisma.vehicleModel.findMany({
                where: { makeId: makeObj.id },
                select: { name: true },
                distinct: ['name'],
                orderBy: { name: 'asc' }
            });
            return res.json(models.map(m => m.name));
        }

        res.json([]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

