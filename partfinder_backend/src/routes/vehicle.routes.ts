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

export default router;
