import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import vehicleRoutes from './routes/vehicle.routes';
import partRoutes from './routes/part.routes';
import orderRoutes from './routes/order.routes';
import ebayNotificationRoutes from './routes/ebay_notifications.routes';
import aliexpressRoutes from './routes/aliexpress.routes';
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import garageRoutes from './routes/garage.routes';
import checkoutRoutes, { stripeWebhookHandler } from './routes/checkout.routes';
import warehouseRoutes from './routes/warehouse.routes';
import paymentRequestRoutes from './routes/payment_requests.routes';
import { startScheduler } from './jobs/scheduler';
import { termesValides } from './services/glossary_learning.service';
import { chargerTermesAppris } from './services/part_glossary';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Webhook Stripe : nécessite le corps BRUT (signature) -> AVANT express.json.
app.post('/api/checkout/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json());

// Routes
app.use('/api/vehicle', vehicleRoutes);
app.use('/api/parts', partRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ebay', ebayNotificationRoutes);
app.use('/api/aliexpress', aliexpressRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/garage', garageRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/payment-requests', paymentRequestRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'PartFinder API is running' });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    startScheduler();

    // Termes de glossaire validés par un opérateur : ils étendent le
    // glossaire statique, pour l'affichage comme pour les requêtes envoyées
    // aux marchés étrangers. Échec sans conséquence : on garde le statique.
    termesValides()
        .then((t) => {
            chargerTermesAppris(t);
            if (t.length) console.log(`[glossaire] ${t.length} terme(s) appris chargé(s)`);
        })
        .catch((e) => console.error('[glossaire] chargement des termes appris:', e.message));
});
