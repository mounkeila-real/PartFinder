import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import vehicleRoutes from './routes/vehicle.routes';
import partRoutes from './routes/part.routes';
import orderRoutes from './routes/order.routes';
import ebayNotificationRoutes from './routes/ebay_notifications.routes';
import aliexpressRoutes from './routes/aliexpress.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/vehicle', vehicleRoutes);
app.use('/api/parts', partRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ebay', ebayNotificationRoutes);
app.use('/api/aliexpress', aliexpressRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'PartFinder API is running' });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
