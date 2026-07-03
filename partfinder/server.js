require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Config
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' })); // For base64 or large json
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Set up memory storage for Multer
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Configure Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Routes
app.post('/api/extract-carte-grise', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image provided" });
        if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "API Key missing" });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Voici une photo d'une carte grise de véhicule (certificat d'immatriculation français ou européen).
        Tu dois UNIQUEMENT extraire les informations suivantes et répondre au format JSON strict. 
        Ne fournis aucune explication ou texte avant ou après le JSON.
        Si une information est illisible ou manquante, met null.
        Format attendu :
        {
          "vin": "Numéro d'identification (case E)",
          "marque": "Marque (case D.1)",
          "modele": "Modèle (case D.3)",
          "annee": "Année de première immatriculation (case B, format YYYY)",
          "moteur": "Cylindrée et/ou énergie (case P.1 et P.3)"
        }`;

        const image = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype
            }
        };

        const result = await model.generateContent([prompt, image]);
        const responseText = result.response.text();

        // Nettoyer la réponse pour s'assurer que c'est du JSON valide
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/({[\s\S]*})/);
        const jsonString = jsonMatch ? jsonMatch[1] : responseText;

        const data = JSON.parse(jsonString);
        res.json(data);
    } catch (error) {
        console.error("Error carte grise:", error);
        res.status(500).json({ error: "Erreur lors de l'extraction." });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { text, context } = req.body;
        if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "API Key missing" });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        const prompt = `Tu es l'assistant de PartFinder, un outil pro pour trouver des pièces auto.
        L'utilisateur a écrit ce message : "${text}"
        Le contexte actuel est : ${JSON.stringify(context || {})}
        
        Objectif : Extraire les informations du véhicule et de la pièce mentionnée.
        Réponds UNIQUEMENT au format JSON strict, avec les champs mis à jour s'ils ont été trouvés dans le message de l'utilisateur.
        
        Format :
        {
            "marque": "...",
            "modele": "...",
            "annee": "...",
            "moteur": "...",
            "piece": "...",
            "partNumber": "...",
            "reponseAgent": "Message court et professionnel en français pour l'utilisateur, ex: 'J'ai noté que vous cherchez un turbo pour Audi A3, il me manque l'année.'"
        }`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/({[\s\S]*})/);
        const data = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);

        res.json(data);
    } catch (error) {
        console.error("Error chat:", error);
        res.status(500).json({ error: "Erreur lors de l'analyse du message." });
    }
});

// ─── WMI → Marque (ISO 3780) ─────────────────────────────────────────────────
const wmiMap = {
    'WDD': 'Mercedes-Benz', 'WDB': 'Mercedes-Benz', 'WDC': 'Mercedes-Benz', 'WMX': 'Mercedes-Benz',
    'WBA': 'BMW', 'WBS': 'BMW', 'WBY': 'BMW', 'WBX': 'BMW',
    'WAU': 'Audi', 'WA1': 'Audi', 'TRU': 'Audi',
    'VF7': 'Citroën', 'VF8': 'Citroën',
    'VF3': 'Peugeot', 'VF6': 'Peugeot',
    'VF1': 'Renault', 'VF2': 'Renault',
    'WP0': 'Porsche', 'WP1': 'Porsche',
    'ZFA': 'Fiat', 'ZFF': 'Ferrari', 'ZAR': 'Alfa Romeo', 'ZLD': 'Lancia',
    'YV1': 'Volvo', 'YV2': 'Volvo',
    'WVW': 'Volkswagen', 'WV1': 'Volkswagen', 'WV2': 'Volkswagen', 'WV3': 'Volkswagen',
    'VSS': 'SEAT', 'VSK': 'SEAT', 'VNK': 'Toyota (Europe)', 'SB1': 'Toyota (UK)',
    'SAJ': 'Jaguar', 'SAL': 'Land Rover', 'SCC': 'Lotus', 'SCF': 'Aston Martin',
    'WMW': 'MINI', 'ADN': 'Opel', 'W0L': 'Opel', 'W08': 'Opel',
    'VF0': 'Renault', 'VF4': 'Renault', 'VF5': 'Renault',
    '1HG': 'Honda', '1FA': 'Ford', 'JHM': 'Honda', 'JN1': 'Nissan', 'JT2': 'Toyota',
};

// ─── Local European VIN Model Decoder ────────────────────────────────────────
// Most European manufacturers encode the platform/model family in chars 4-6 of the VIN.
// This covers the most common models for French, German, Italian, Swedish cars.
const euVinModels = {
    // Mercedes-Benz — WDDxxxxx: chars 4-6 = platform code
    'WDD': {
        '246': { modele: 'Classe B (W246)', annees: '2011-2018' },
        '247': { modele: 'Classe B (W247)', annees: '2018-' },
        '204': { modele: 'Classe C (W204)', annees: '2007-2014' },
        '205': { modele: 'Classe C (W205)', annees: '2014-2021' },
        '206': { modele: 'Classe C (W206)', annees: '2021-' },
        '169': { modele: 'Classe A (W169)', annees: '2004-2012' },
        '176': { modele: 'Classe A (W176)', annees: '2012-2018' },
        '177': { modele: 'Classe A (W177)', annees: '2018-' },
        '212': { modele: 'Classe E (W212)', annees: '2009-2016' },
        '213': { modele: 'Classe E (W213)', annees: '2016-2023' },
        '220': { modele: 'Classe S (W220)', annees: '1998-2005' },
        '221': { modele: 'Classe S (W221)', annees: '2005-2013' },
        '222': { modele: 'Classe S (W222)', annees: '2013-2021' },
        '164': { modele: 'ML/GLE (W164)', annees: '2005-2011' },
        '166': { modele: 'ML/GLE (W166)', annees: '2011-2019' },
        '167': { modele: 'GLE (W167)', annees: '2019-' },
        '245': { modele: 'Classe B (W245)', annees: '2005-2011' },
        '639': { modele: 'Vito (W639)', annees: '2003-2014' },
        '447': { modele: 'Vito/V-Class (W447)', annees: '2014-' },
        '253': { modele: 'GLC (X253)', annees: '2015-' },
        '117': { modele: 'CLA (C117)', annees: '2013-2019' },
        '118': { modele: 'CLA (C118)', annees: '2019-' },
        '156': { modele: 'GLA (X156)', annees: '2013-2020' },
        '247': { modele: 'GLB (X247)', annees: '2019-' },
    },
    'WDB': {
        '204': { modele: 'Classe C (W204)', annees: '2007-2014' },
        '205': { modele: 'Classe C (W205)', annees: '2014-2021' },
        '212': { modele: 'Classe E (W212)', annees: '2009-2016' },
        '213': { modele: 'Classe E (W213)', annees: '2016-' },
        '463': { modele: 'Classe G (W463)', annees: '2018-' },
    },
    // BMW — WBAxxxxx: chars 4-6 vary (F and G series codes)
    'WBA': {
        'LA7': { modele: 'Série 1 (F20/F21)', annees: '2011-2019' },
        '1J7': { modele: 'Série 1 (F20)', annees: '2011-2019' },
        '3A7': { modele: 'Série 3 (F30)', annees: '2012-2018' },
        '3A5': { modele: 'Série 3 (F30)', annees: '2012-2018' },
        '8E7': { modele: 'Série 3 (G20)', annees: '2019-' },
        '5E7': { modele: 'Série 5 (G30)', annees: '2017-' },
        '4A7': { modele: 'Série 5 (F10)', annees: '2010-2017' },
        '6C9': { modele: 'Série 6 (F12/F13)', annees: '2011-2018' },
        '7E0': { modele: 'Série 7 (G11/G12)', annees: '2015-' },
        '4E5': { modele: 'Série 4 (F32)', annees: '2013-2020' },
        '2E7': { modele: 'Série 2 (F22/F45)', annees: '2014-' },
    },
    // Volkswagen
    'WVW': {
        'ZZZ': { modele: 'Golf', annees: '1998-' },
        'AUZ': { modele: 'Golf', annees: '2012-' },
        'AAZ': { modele: 'Polo', annees: '2009-' },
        'BGT': { modele: 'Passat', annees: '2015-' },
        'HZZ': { modele: 'Tiguan', annees: '2007-' },
    },
    // Renault
    'VF1': {
        'RJM': { modele: 'Mégane', annees: '2008-' },
        'FA7': { modele: 'Clio', annees: '2012-' },
        'FB0': { modele: 'Zoe', annees: '2012-' },
        'RJ0': { modele: 'Megane', annees: '2016-' },
        'AG0': { modele: 'Laguna', annees: '2007-2012' },
        'JB0': { modele: 'Kangoo', annees: '2007-' },
    },
    // Peugeot
    'VF3': {
        'C28': { modele: '208', annees: '2012-' },
        'A9H': { modele: '3008', annees: '2016-' },
        'FB8': { modele: '308', annees: '2013-' },
        'Y6W': { modele: '2008', annees: '2013-' },
    },
    // Citroën
    'VF7': {
        'UA9': { modele: 'Berlingo', annees: '2008-' },
        'SC2': { modele: 'C3', annees: '2009-' },
        'SB': { modele: 'C4', annees: '2010-' },
    },
    // Fiat
    'ZFA': {
        '198': { modele: 'Grande Punto / Punto Evo', annees: '2005-2018' },
        '199': { modele: 'Fiat 500', annees: '2007-' },
        '263': { modele: 'Freemont', annees: '2011-2016' },
        '312': { modele: 'Panda', annees: '2011-' },
    },
};

/**
 * Decode a European VIN locally using platform/model codes in the VDS.
 * Returns { modele, annees } or null.
 */
function decodeEuropeanVinModel(vin) {
    const wmi = vin.substring(0, 3);
    const vds = vin.substring(3, 9); // positions 4-9
    const platformCode = vds.substring(0, 3); // chars 4-6 most relevant for model

    const brandModels = euVinModels[wmi];
    if (!brandModels) return null;

    // Try exact 3-char match first (chars 4-6)
    if (brandModels[platformCode]) return brandModels[platformCode];

    // Try 2-char match (chars 4-5) — less specific
    const twoChar = vds.substring(0, 2);
    const twoCharMatch = Object.entries(brandModels).find(([k]) => k.startsWith(twoChar));
    if (twoCharMatch) return twoCharMatch[1];

    return null;
}

// North American VIN year decode (SAE/NHTSA standard — position 10)
// NOT applicable to European VINs.
function decodeVinYear(vin) {
    if (!vin || vin.length < 10) return null;
    const northAmericanPrefixes = ['1','2','3','4','5','6','7'];
    if (!northAmericanPrefixes.includes(vin[0])) return null;
    const code = vin[9].toUpperCase();
    const yearCandidates = {
        'A':[1980,2010],'B':[1981,2011],'C':[1982,2012],'D':[1983,2013],'E':[1984,2014],
        'F':[1985,2015],'G':[1986,2016],'H':[1987,2017],'J':[1988,2018],'K':[1989,2019],
        'L':[1990,2020],'M':[1991,2021],'N':[1992,2022],'P':[1993,2023],'R':[1994,2024],
        'S':[1995,2025],'T':[1996,2026],'V':[1997],'W':[1998],'X':[1999],'Y':[2000],
        '1':[2001],'2':[2002],'3':[2003],'4':[2004],'5':[2005],
        '6':[2006],'7':[2007],'8':[2008],'9':[2009],
    };
    const candidates = yearCandidates[code];
    if (!candidates) return null;
    const now = new Date().getFullYear();
    return candidates.filter(y => y <= now + 1).pop() || candidates[0];
}

// Generic proxy helper to route API calls to the backend on port 3001
const proxyToBackend = async (req, res) => {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const targetUrl = `${backendUrl}${req.baseUrl}${req.url}`;
    try {
        const headers = {};
        if (req.headers['content-type']) {
            headers['content-type'] = req.headers['content-type'];
        }
        if (req.headers['authorization']) {
            headers['authorization'] = req.headers['authorization'];
        }

        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            params: req.query,
            headers
        });
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error(`Proxy error for ${targetUrl}:`, error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: "Backend communication failed" });
    }
};

app.use('/api/vehicle', proxyToBackend);
app.use('/api/parts', proxyToBackend);
app.use('/api/orders', proxyToBackend);

app.get('/api/decode-vin/:vin', async (req, res) => {
    try {
        const vin = req.params.vin.toUpperCase();
        if (vin.length < 3) return res.status(400).json({ error: "VIN trop court" });

        const wmi = vin.substring(0, 3);
        const localBrand = wmiMap[wmi] || null;

        // 1. Local European model decode (instant, no API, based on VDS platform code)
        const localModel = decodeEuropeanVinModel(vin);
        const localYear  = decodeVinYear(vin); // only works for North American VINs

        // 2. If local model decode is complete, return immediately — no API needed
        if (localModel) {
            // Still try backend in background enrichment for engine data
            const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
            try {
                const apiResp = await axios.get(`${backendUrl}/api/vehicle/vin/${vin}`, { timeout: 4000 });
                const d = apiResp.data;
                const result = {
                    marque:  d.make  || d.Make  || localBrand  || 'Inconnu',
                    modele:  d.model || d.Model || localModel.modele,
                    annee:   d.modelYear || d.model_year || localYear || localModel.annees || null,
                    moteur:  d.engine || d.Engine || d.engineDisplacement || null,
                    platform: d.specifications ? d.specifications['Série'] : (localModel ? localModel.modele : null),
                    version: d.specifications ? d.specifications['Modèle'] : (d.model || null)
                };
                return res.json({
                    ...result,
                    make: result.marque,
                    model: result.modele,
                    modelYear: result.annee,
                    engine: result.moteur,
                    specifications: d.specifications || null
                });
            } catch {
                // API failed — local data is enough
                const result = {
                    marque:  localBrand || 'Inconnu',
                    modele:  localModel.modele,
                    annee:   localYear || localModel.annees || null,
                    moteur:  null,
                    platform: localModel.modele,
                    version: localModel.modele
                };
                return res.json({
                    ...result,
                    make: result.marque,
                    model: result.modele,
                    modelYear: result.annee,
                    engine: result.moteur,
                    specifications: null
                });
            }
        }

        // 3. No local model — rely entirely on backend API
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
        try {
            const response = await axios.get(`${backendUrl}/api/vehicle/vin/${vin}`, { timeout: 5000 });
            const d = response.data;
            const result = {
                marque:  d.make  || d.Make  || localBrand  || 'Inconnu',
                modele:  d.model || d.Model || null,
                annee:   d.modelYear || d.model_year || d['Model Year'] || localYear,
                moteur:  d.engine || d.Engine || d.engineDisplacement || null,
                platform: d.specifications ? d.specifications['Série'] : null,
                version: d.specifications ? d.specifications['Modèle'] : (d.model || null)
            };
            res.json({
                ...result,
                make: result.marque,
                model: result.modele,
                modelYear: result.annee,
                engine: result.moteur,
                specifications: d.specifications || null
            });
        } catch (apiError) {
            console.warn("Backend VIN API failed:", apiError.message);
            const result = { marque: localBrand || 'Inconnu', modele: null, annee: localYear, moteur: null, platform: null, version: null };
            res.json({
                ...result,
                make: result.marque,
                model: result.modele,
                modelYear: result.annee,
                engine: result.moteur,
                specifications: null
            });
        }
    } catch (error) {
        res.status(500).json({ error: "Erreur de décodage VIN" });
    }
});

// Mock search function
app.post('/api/search', async (req, res) => {
    // In a real app, you would contact eBay, Amazon, Aliexpress APIs here.
    // For now, we return mocked data based on the requested part and car.
    const { piece, marque, modele } = req.body;

    setTimeout(() => {
        const mockResults = [
            {
                id: "1",
                nom: `${piece || 'Pièce'} OEM d'origine`,
                reference: "OEM-839201",
                description: `Spécifique pour ${marque || 'Véhicule'} ${modele || ''}`,
                sourcePrix: 120.50, // This source price is invisible to the frontend
                prixPublic: (120.50 * 1.33).toFixed(2), // +33% margin
                etat: "Neuf",
                photos: [
                    "https://images.unsplash.com/photo-1616056586616-e570a2569ba2?auto=format&fit=crop&q=80&w=400",
                    "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&q=80&w=400"
                ]
            },
            {
                id: "2",
                nom: `${piece || 'Composant'} Compatible Bosch`,
                reference: "BOSCH-394X",
                description: "Qualité premium, garantie 2 ans",
                sourcePrix: 75.00,
                prixPublic: (75.00 * 1.33).toFixed(2),
                etat: "Reconditionné",
                photos: [
                    "https://images.unsplash.com/photo-1621258013317-0639ea135e0e?auto=format&fit=crop&q=80&w=400"
                ]
            },
            {
                id: "3",
                nom: `${piece || 'Pièce'} Import (Générique)`,
                reference: "GEN-0029",
                description: "Bon rapport qualité/prix",
                sourcePrix: 35.00,
                prixPublic: (35.00 * 1.33).toFixed(2),
                etat: "Neuf",
                photos: [
                    "https://images.unsplash.com/photo-1542282088-fe8426682b8f?auto=format&fit=crop&q=80&w=400",
                    "https://images.unsplash.com/photo-1590412200984-b0dcc52c92e9?auto=format&fit=crop&q=80&w=400"
                ]
            }
        ];
        res.json(mockResults);
    }, 1500); // Simulate network delay
});

app.listen(port, () => {
    console.log(`✅ PartFinder Server running on http://localhost:${port}`);
});
