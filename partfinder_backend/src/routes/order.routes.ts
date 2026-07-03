import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Receive an order from the frontend cart
router.post('/', async (req: express.Request, res: express.Response) => {
    try {
        const { contactInfo, items } = req.body;
        // Items should be an array of: { partOem, partName, quantity, priceSold }

        if (!items || items.length === 0) {
            return res.status(400).json({ error: "Order must contain items" });
        }

        const totalAmount = items.reduce((sum: number, item: any) => sum + (item.priceSold * item.quantity), 0);

        // Save order and order items in a transaction using Prisma
        const order = await prisma.order.create({
            data: {
                contactInfo,
                totalAmount,
                items: {
                    create: items.map((i: any) => ({
                        partOem: i.partOem,
                        partName: i.partName,
                        quantity: i.quantity,
                        priceSold: i.priceSold
                    }))
                }
            },
            include: {
                items: true
            }
        });

        res.status(201).json({ message: "Order successfully placed for processing.", order });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
