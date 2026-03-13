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

// WMI → Marque (ISO 3780)
const wmiMap = {
    'WDD': 'Mercedes-Benz', 'WDB': 'Mercedes-Benz', 'WDC': 'Mercedes-Benz',
    'WBA': 'BMW', 'WBS': 'BMW', 'WBY': 'BMW',
    'WAU': 'Audi', 'WA1': 'Audi',
    'VF7': 'Citroën', 'VF8': 'Citroën',
    'VF3': 'Peugeot', 'VF6': 'Peugeot',
    'VF1': 'Renault', 'VF2': 'Renault',
    'WP0': 'Porsche', 'WP1': 'Porsche',
    'ZFA': 'Fiat', 'ZFF': 'Ferrari',
    'YV1': 'Volvo', 'YV2': 'Volvo',
    'WVW': 'Volkswagen', 'WV1': 'Volkswagen', 'WV2': 'Volkswagen',
    'TRU': 'Audi', 'VSS': 'SEAT', 'VSK': 'SEAT',
    'VNK': 'Toyota (Europe)', 'SB1': 'Toyota (UK)',
    'SAJ': 'Jaguar', 'SAL': 'Land Rover', 'SCC': 'Lotus',
    'BYD': 'BYD', '1HG': 'Honda', '1FA': 'Ford',
    'JHM': 'Honda', 'JN1': 'Nissan', 'JT2': 'Toyota',
};

// Decode model year from VIN position 10 (ISO 3779 standard — no API needed)
const vinYearMap = {
    'A':1980,'B':1981,'C':1982,'D':1983,'E':1984,'F':1985,'G':1986,'H':1987,
    'J':1988,'K':1989,'L':1990,'M':1991,'N':1992,'P':1993,'R':1994,'S':1995,
    'T':1996,'V':1997,'W':1998,'X':1999,'Y':2000,'1':2001,'2':2002,'3':2003,
    '4':2004,'5':2005,'6':2006,'7':2007,'8':2008,'9':2009,
    // Second cycle (2010+)
    'A':2010,'B':2011,'C':2012,'D':2013,'E':2014,'F':2015,'G':2016,'H':2017,
    'J':2018,'K':2019,'L':2020,'M':2021,'N':2022,'P':2023,'R':2024,'S':2025,'T':2026
};
function decodeVinYear(vin) {
    if (!vin || vin.length < 10) return null;
    const code = vin[9].toUpperCase();
    // Position 10 is model year; for ambiguous letters (pre/post 2010)
    // we pick the most recent plausible year based on current date
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
    // Pick the most recent year that is <= current year
    return candidates.filter(y => y <= now + 1).pop() || candidates[0];
}

app.get('/api/decode-vin/:vin', async (req, res) => {
    try {
        const vin = req.params.vin.toUpperCase();
        if (vin.length < 3) return res.status(400).json({ error: "VIN trop court" });

        const wmi = vin.substring(0, 3);
        const localBrand = wmiMap[wmi] || null;

        // Decode year locally from VIN position 10 (always works, no API)
        const localYear = decodeVinYear(vin);

        // Call the TypeScript backend (vin-decoder19 via RapidAPI — European coverage)
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
        try {
            const response = await axios.get(`${backendUrl}/api/vehicle/vin/${vin}`, { timeout: 5000 });
            const d = response.data;

            res.json({
                marque: d.make || d.Make || localBrand || 'Inconnu',
                modele: d.model || d.Model || null,
                annee:  d.modelYear || d.model_year || d['Model Year'] || localYear,
                moteur: d.engineDisplacement || d.engine || d.Engine || null
            });
        } catch (apiError) {
            console.warn("Backend VIN API failed, using local WMI+year:", apiError.message);
            // Fallback: brand from WMI + year from position 10 — always available
            res.json({ marque: localBrand || 'Inconnu', modele: null, annee: localYear, moteur: null });
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
