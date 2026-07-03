const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');
const path = require('path');

// Load .env
dotenv.config();

const VINCARIO_API_KEY = process.env.VINCARIO_API_KEY;
const VINCARIO_SECRET_KEY = process.env.VINCARIO_SECRET_KEY;

async function testVincarioInfo() {
    if (!VINCARIO_API_KEY || !VINCARIO_SECRET_KEY) {
        console.error("Vincario API keys are missing in .env");
        return;
    }

    const vin = "WDD2462421N227311".toUpperCase();
    const id = "info"; // Test with info
    
    const inputStr = `${vin}|${id}|${VINCARIO_API_KEY}|${VINCARIO_SECRET_KEY}`;
    const hash = crypto.createHash('sha1').update(inputStr).digest('hex');
    const controlSum = hash.substring(0, 10);

    const url = `https://api.vindecoder.eu/3.2/${VINCARIO_API_KEY}/${controlSum}/${id}/${vin}.json`;
    console.log("Querying Info URL:", url);

    try {
        const response = await axios.get(url);
        console.log("Status:", response.status);
        console.log("Response Data:", JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Request failed:", error.response?.status, error.response?.data || error.message);
    }
}

testVincarioInfo();
