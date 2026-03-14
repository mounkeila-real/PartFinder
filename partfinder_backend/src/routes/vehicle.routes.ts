import express from 'express';
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

router.get('/all', async (req: express.Request, res: express.Response) => {
    try {
        const data = await VehicleService.getVehicles();
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/makes', async (req: express.Request, res: express.Response) => {
    try {
        const data = await VehicleService.getMakes();
        res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/models/:make', async (req: express.Request, res: express.Response) => {
    try {
        const data = await VehicleService.getModels(req.params.make as string);
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

export default router;
