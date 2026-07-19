import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { AuthService } from './services/auth.service';

const prisma = new PrismaClient();
const BACKEND_URL = 'http://localhost:3001';

async function testResetFlow() {
    console.log('--- STARTING PASSWORD RESET INTEGRATION TEST ---');

    const email = 'test-pro@garage.fr';
    const oldPassword = 'password123';
    const newPassword = 'newPassword456';

    try {
        // 1. Reset user in database
        console.log(`[1] Cleaning up and creating user ${email} in database...`);
        await prisma.user.deleteMany({ where: { email } });
        const oldHash = await AuthService.hashPassword(oldPassword);
        await prisma.user.create({
            data: {
                email,
                passwordHash: oldHash,
                companyName: 'Garage Test S.A.S.',
                contactName: 'Test Contact',
                phone: '0600000000',
                vatNumber: 'FR12345678901',
                role: 'CUSTOMER',
                status: 'ACTIVE',
            }
        });
        console.log('✅ User created.');

        // 2. Call forgot-password endpoint
        console.log(`[2] Calling forgot-password endpoint for ${email}...`);
        const forgotResponse = await axios.post(`${BACKEND_URL}/api/auth/forgot-password`, { email });
        console.log('Response:', forgotResponse.data);
        if (!forgotResponse.data.message.includes('lien de réinitialisation a été envoyé')) {
            throw new Error('Unexpected forgot-password response');
        }
        console.log('✅ Forgot password link requested.');

        // 3. Inspect database to retrieve the token
        console.log('[3] Retrieving reset token from database...');
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.resetToken || !user.resetTokenExpiry) {
            throw new Error('Reset token was not saved to the user record in database!');
        }
        const token = user.resetToken;
        console.log(`✅ Token found in database: ${token}`);
        console.log(`Expiry: ${user.resetTokenExpiry}`);

        // 4. Call reset-password endpoint with the token
        console.log('[4] Calling reset-password endpoint with the retrieved token...');
        const resetResponse = await axios.post(`${BACKEND_URL}/api/auth/reset-password`, {
            token,
            newPassword
        });
        console.log('Response:', resetResponse.data);
        if (!resetResponse.data.message.includes('réinitialisé avec succès')) {
            throw new Error('Unexpected reset-password response');
        }
        console.log('✅ Password reset request completed.');

        // 5. Verify database status
        console.log('[5] Verifying database fields are cleared...');
        const updatedUser = await prisma.user.findUnique({ where: { email } });
        if (updatedUser?.resetToken || updatedUser?.resetTokenExpiry) {
            throw new Error('Database resetToken or resetTokenExpiry fields were not cleared after reset!');
        }
        console.log('✅ Database reset fields cleared.');

        // 6. Test logging in with the new password
        console.log('[6] Testing login with new password...');
        const loginResponse = await axios.post(`${BACKEND_URL}/api/auth/login`, {
            email,
            password: newPassword
        });
        console.log('Login Response token:', !!loginResponse.data.token);
        console.log('Login Response user company:', loginResponse.data.user.companyName);
        console.log('✅ Login successful with new password!');
        
        console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! End-to-end B2B Password Reset is fully operational.');
    } catch (error: any) {
        console.error('❌ TEST FAILED:', error.response?.data || error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

testResetFlow();
