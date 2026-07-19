import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth.middleware';

/**
 * Mon garage — véhicules enregistrés d'un compte (toutes routes requireAuth).
 */

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

/** GET /api/garage — liste des véhicules du compte. */
router.get('/', async (req: AuthedRequest, res: express.Response) => {
    try {
        const vehicles = await prisma.savedVehicle.findMany({
            where: { userId: req.user!.userId },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ vehicles });
    } catch (e: any) {
        console.error('[garage] list:', e.message);
        res.status(500).json({ error: 'Erreur lors du chargement du garage.' });
    }
});

/** POST /api/garage — enregistre un véhicule. body: { vin?, plate?, make?, model?, year?, engine?, nickname? } */
router.post('/', async (req: AuthedRequest, res: express.Response) => {
    try {
        const { vin, plate, make, model, year, engine, nickname } = req.body || {};
        if (!vin && !plate && !make) {
            return res.status(400).json({ error: 'Renseignez au moins un VIN, une plaque ou une marque.' });
        }
        // Anti-doublon simple : même VIN déjà enregistré pour ce compte.
        if (vin) {
            const existing = await prisma.savedVehicle.findFirst({
                where: { userId: req.user!.userId, vin: String(vin) },
            });
            if (existing) return res.status(409).json({ error: 'Ce véhicule est déjà dans votre garage.', vehicle: existing });
        }
        const vehicle = await prisma.savedVehicle.create({
            data: {
                userId: req.user!.userId,
                vin: vin ? String(vin) : null,
                plate: plate ? String(plate) : null,
                make: make ? String(make) : null,
                model: model ? String(model) : null,
                year: year ? Number(year) || null : null,
                engine: engine ? String(engine) : null,
                nickname: nickname ? String(nickname) : null,
            },
        });
        res.status(201).json({ vehicle });
    } catch (e: any) {
        console.error('[garage] create:', e.message);
        res.status(500).json({ error: 'Erreur lors de l\'enregistrement.' });
    }
});

/** DELETE /api/garage/:id — supprime un véhicule du garage (du compte connecté). */
router.delete('/:id', async (req: AuthedRequest, res: express.Response) => {
    try {
        const id = Number(req.params.id);
        const v = await prisma.savedVehicle.findUnique({ where: { id } });
        if (!v || v.userId !== req.user!.userId) {
            return res.status(404).json({ error: 'Véhicule introuvable.' });
        }
        await prisma.savedVehicle.delete({ where: { id } });
        res.json({ ok: true });
    } catch (e: any) {
        console.error('[garage] delete:', e.message);
        res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }
});

export default router;
