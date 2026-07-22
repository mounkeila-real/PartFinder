/**
 * PartFinder Prototype Logic (Phase 1)
 */

// Visuel de repli : SVG embarqué, aucune requête réseau. Un repli hébergé
// ailleurs (Unsplash & co) tombe dès que le réseau du client filtre ce domaine —
// exactement le problème que l'on corrige ici.
window.PF_FALLBACK_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
    '<rect width="400" height="300" fill="#E4E9F2"/>' +
    '<g fill="none" stroke="#9AA8BF" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="200" cy="150" r="46"/>' +
    '<circle cx="200" cy="150" r="15"/>' +
    '<path d="M200 88v-22M200 234v-22M262 150h22M116 150h22M244 106l16-16M140 194l-16 16M244 194l16 16M140 106l-16-16"/>' +
    '</g></svg>'
);

document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    // Change this to your backend's actual Railway URL if different.
    const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production-c0af.up.railway.app/api';
    // WARNING: Replace with the actual API backend URL on Railway if needed.

    // --- State Management ---
    const state = {
        vehicle: {
            method: null, // 'carte_grise', 'vin' or 'manual'
            data: {
                make: '',
                model: '',
                year: '',
                engine: '',
                vin: ''
            },
            wmiDecoded: false
        },
        part: {
            method: null, // 'number', 'photo', or 'desc'
            number: null,
            hasPhoto: false
        },
        cart: []
    };

    // --- Mock Data ---
    const mockWMI = {
        'VF1': { make: 'Renault', country: 'France' },
        'VF3': { make: 'Peugeot', country: 'France' },
        'VF7': { make: 'Citroën', country: 'France' },
        'WAU': { make: 'Audi', country: 'Germany' },
        'WBA': { make: 'BMW', country: 'Germany' },
        'WVW': { make: 'Volkswagen', country: 'Germany' }
    };

    // --- Real APIs Data Storage ---
    // Replace hardcoded dropdown with real API data logic
    let cachedMakes = [];

    const form = document.getElementById('search-form');
    const vinInput = document.getElementById('vin');
    const vinFeedback = document.getElementById('vin-feedback');
    const btnScanCg = document.getElementById('btn-scan-cg');
    const cgInput = document.getElementById('cg-image');
    const cgCamera = document.getElementById('cg-camera');
    const btnScanCamera = document.getElementById('btn-scan-camera');
    const btnMoreInfo = document.getElementById('btn-more-info');

    const manualVehicleFields = document.getElementById('manual-vehicle-fields');
    const makeSelect = document.getElementById('make');
    const modelInput = document.getElementById('model');
    const yearInput = document.getElementById('year');
    const engineInput = document.getElementById('engine');
    const platformInput = document.getElementById('platform');
    const versionInput = document.getElementById('version');

    const partNumberInput = document.getElementById('part-number');
    const partDescInput = document.getElementById('part-desc');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('part-image');
    const filePreview = document.getElementById('file-preview');
    const previewImg = document.getElementById('preview-img');
    const btnRemoveImg = document.getElementById('btn-remove-img');

    // UI Panels
    const emptyState = document.getElementById('empty-state');
    const loadingState = document.getElementById('loading-state');
    const resultsContent = document.getElementById('results-content');
    const offersGrid = document.getElementById('offers-grid');

    // Cart
    const cartBadge = document.getElementById('cart-badge');
    const cartItems = document.getElementById('cart-items');
    const cartTotalPrice = document.getElementById('cart-total-price');

    // Commands
    const navItems = document.querySelectorAll('.nav-item');
    const cartPanel = document.getElementById('cart-panel');
    const closeCartBtn = document.getElementById('close-cart');
    const btnCheckout = document.getElementById('btn-checkout');

    // Chat
    const chatWidget = document.querySelector('.chat-widget');
    const toggleChatBtn = document.getElementById('toggle-chat');


    // --- 1. Form Adaptive Logic ---

    // Utility to set fields disabled state
    function setManualFieldsDisabled(disabled) {
        makeSelect.disabled = disabled;
        modelInput.disabled = disabled;
        yearInput.disabled = disabled;
        engineInput.disabled = disabled;
        platformInput.disabled = disabled;
        versionInput.disabled = disabled;
        manualVehicleFields.style.opacity = disabled ? '0.5' : '1';
    }

    const sectionPart = document.getElementById('section-part');
    const btnSearch = document.getElementById('btn-search');

    // Le vehicule est-il decrit ? (VIN / carte grise decode, ou saisie manuelle de la marque)
    function isVehicleDescribed() {
        const m = ((state.vehicle && state.vehicle.data && state.vehicle.data.make) || makeSelect.value || '').trim();
        return m.length > 0;
    }

    // Verrouille la section "Identification Piece" tant qu'aucun vehicule n'est decrit
    function setPartSectionEnabled(enabled) {
        partNumberInput.disabled = !enabled;
        partDescInput.disabled = !enabled;
        if (fileInput) fileInput.disabled = !enabled;
        if (btnSearch) btnSearch.disabled = !enabled;
        if (sectionPart) {
            sectionPart.style.opacity = enabled ? '1' : '0.45';
            sectionPart.style.pointerEvents = enabled ? 'auto' : 'none';
        }
    }

    function refreshPartLock() {
        setPartSectionEnabled(isVehicleDescribed());
    }

    // Une fois le vehicule identifie : amener l'utilisateur sur la recherche de piece.
    // Ne se declenche qu'une fois par identification (remis a zero au reset).
    let vehicleFocusDone = false;
    function focusPartSection() {
        if (vehicleFocusDone) return;
        vehicleFocusDone = true;
        const band = document.getElementById('section-part');
        if (band) band.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () {
            if (partDescInput && !partDescInput.disabled) partDescInput.focus();
        }, 450);
    }

    async function syncManualFields(data) {
        if (data.make) {
            makeSelect.value = data.make;
            const make = data.make;
            modelInput.innerHTML = '<option value="">Chargement des modèles...</option>';
            modelInput.disabled = true;

            try {
                const response = await fetch(`${API_BASE_URL}/vehicle/models/${encodeURIComponent(make)}`);
                if (response.ok) {
                    const models = await response.json();
                    modelInput.innerHTML = '<option value="">Sélectionner...</option>';
                    models.forEach(mod => {
                        const modelValue = typeof mod === 'object' ? (mod.model || mod.name) : mod;
                        const option = document.createElement('option');
                        option.value = modelValue;
                        option.textContent = modelValue;
                        modelInput.appendChild(option);
                    });
                    modelInput.disabled = (state.vehicle.method === 'vin' || state.vehicle.method === 'carte_grise');

                    if (data.model) {
                        let matchedValue = "";
                        for (let i = 0; i < modelInput.options.length; i++) {
                            const optionText = modelInput.options[i].text.toLowerCase();
                            const targetText = data.model.toLowerCase();
                            
                            const cleanOption = optionText.replace(/classe\s+/g, '').trim();
                            const cleanTarget = targetText.replace(/classe\s+/g, '').trim();

                            if (optionText === targetText || 
                                optionText.includes(targetText) || 
                                targetText.includes(optionText) ||
                                cleanTarget.startsWith(cleanOption) ||
                                cleanOption.startsWith(cleanTarget)) {
                                modelInput.selectedIndex = i;
                                matchedValue = modelInput.options[i].value;
                                break;
                            }
                        }
                        if (matchedValue) {
                            modelInput.value = matchedValue;
                        } else {
                            // Aucun modele de la liste ne correspond: on ajoute la valeur exacte du decodage (ex: B 180)
                            const exactOpt = document.createElement('option');
                            exactOpt.value = data.model;
                            exactOpt.textContent = data.model;
                            modelInput.appendChild(exactOpt);
                            modelInput.value = data.model;
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to load models during sync:", error);
                modelInput.innerHTML = '<option value="">Erreur de chargement</option>';
            }
        }
        if (data.year) {
            const yearMatch = String(data.year).match(/\d{4}/);
            if (yearMatch) {
                yearInput.value = yearMatch[0];
            } else {
                yearInput.value = data.year;
            }
        }
        if (data.engine) engineInput.value = data.engine;
        if (data.platform) {
            // Clean platform value to first word (e.g. W246 (2011-) -> W246)
            platformInput.value = String(data.platform).split(' ')[0];
        }
        // Version laissee vide pour l'instant (demande utilisateur)
        versionInput.value = '';

        refreshPartLock();
    }

    // Carte Grise Mockup (Highest Priority)
    btnScanCg.addEventListener('click', () => cgInput.click());
    async function runCgOcr(file) {

        vinFeedback.style.display = 'block';
        vinFeedback.className = 'field-feedback feedback-info';
        vinFeedback.textContent = "⏳ OCR de la carte grise en cours... 0%";

        if (typeof Tesseract === 'undefined') {
            vinFeedback.textContent = "✗ Moteur OCR non charge. Verifie ta connexion et reessaie.";
            vinFeedback.className = 'field-feedback feedback-error';
            cgInput.value = '';
            return;
        }

        try {
            vinFeedback.textContent = "⏳ Pretraitement de l'image...";
            const canvas = await preprocessCgImage(file);
            const result = await Tesseract.recognize(canvas, 'eng', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        vinFeedback.textContent = "⏳ OCR de la carte grise... " + Math.round(m.progress * 100) + "%";
                    }
                }
            });
            const text = (result && result.data) ? result.data.text : '';
            const vin = extractVinFromText(text);

            if (vin) {
                vinFeedback.textContent = "✓ VIN extrait: " + vin + ". Decodage...";
                vinFeedback.className = 'field-feedback feedback-success';
                vinInput.value = vin;
                vinInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                vinFeedback.textContent = "✗ VIN introuvable sur le scan. Reprends une photo nette et bien cadree (champ E du certificat).";
                vinFeedback.className = 'field-feedback feedback-error';
            }
        } catch (err) {
            console.error('Erreur OCR:', err);
            vinFeedback.textContent = "✗ Echec de l'OCR. Reessaie avec une image plus nette.";
            vinFeedback.className = 'field-feedback feedback-error';
        } finally {
            cgInput.value = '';
            cgCamera.value = '';
        }
    }

    cgInput.addEventListener('change', (e) => { if (e.target.files.length) runCgOcr(e.target.files[0]); });
    cgCamera.addEventListener('change', (e) => { if (e.target.files.length) runCgOcr(e.target.files[0]); });
    btnScanCamera.addEventListener('click', () => cgCamera.click());

    // Extraction robuste du VIN: on collecte tous les candidats valides
    // (17 car., charset VIN, >=4 chiffres, >=3 lettres) et on retient le PLUS FREQUENT
    // (le VIN figure en champ E, sur le coupon et dans la bande MRZ du bas).
    function extractVinFromText(raw) {
        if (!raw) return null;
        const upper = raw.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
        const fix = c => ({ 'I': '1', 'O': '0', 'Q': '0' }[c] || c);
        const isValid = v => /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
        const nDigits = v => (v.match(/[0-9]/g) || []).length;
        const nLetters = v => (v.match(/[A-Z]/g) || []).length;
        const counts = {};
        const add = v => {
            const f = v.split('').map(fix).join('');
            if (isValid(f) && nDigits(f) >= 4 && nLetters(f) >= 3) counts[f] = (counts[f] || 0) + 1;
        };
        for (const tok of upper.split(/\s+/)) if (tok.length === 17) add(tok);
        const concat = upper.replace(/[^A-Z0-9]/g, '');
        for (let i = 0; i + 17 <= concat.length; i++) add(concat.substr(i, 17));
        const cands = Object.keys(counts);
        if (!cands.length) return null;
        cands.sort((a, b) => counts[b] - counts[a]);
        return cands[0];
    }

    // Charge un fichier image dans un objet Image (pour le pretraitement canvas)
    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    // Pretraitement: agrandit, niveaux de gris + etirement du contraste (ameliore l'OCR)
    async function preprocessCgImage(file) {
        try {
            const img = await loadImage(file);
            const targetW = 1700;
            const ratio = img.width ? targetW / img.width : 1;
            const w = Math.max(1, Math.round(img.width * ratio));
            const h = Math.max(1, Math.round(img.height * ratio));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            const d = imgData.data;
            let min = 255, max = 0;
            for (let i = 0; i < d.length; i += 4) {
                const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                d[i] = d[i + 1] = d[i + 2] = g;
                if (g < min) min = g;
                if (g > max) max = g;
            }
            const range = Math.max(1, max - min);
            for (let i = 0; i < d.length; i += 4) {
                let v = (d[i] - min) * 255 / range;
                v = Math.max(0, Math.min(255, (v - 35) * 1.35));
                d[i] = d[i + 1] = d[i + 2] = v;
            }
            ctx.putImageData(imgData, 0, 0);
            return canvas;
        } catch (e) {
            console.warn('Pretraitement echoue, image brute utilisee:', e);
            return file;
        }
    }

    // VIN Input (Medium Priority)
    let vinTimeout = null;
    vinInput.addEventListener('input', (e) => {
        if (state.vehicle.method === 'carte_grise') return; // Do not override if carte grise is used

        const val = e.target.value.toUpperCase();
        e.target.value = val;
        state.vehicle.data.vin = val;

        clearTimeout(vinTimeout);

        if (val.length >= 11) { // Decode generally requires more than 3 chars to be useful via API
            vinTimeout = setTimeout(async () => {
                vinFeedback.textContent = '⏳ Décodage du VIN en cours...';
                vinFeedback.className = 'field-feedback feedback-info';
                vinFeedback.style.display = 'block';
                setManualFieldsDisabled(true);

                try {
                    const response = await fetch(`/api/decode-vin/${val}`);
                    if (!response.ok) throw new Error('API Error');

                    const data = await response.json();

                    if (data && data.make) {
                        vinFeedback.textContent = `✓ Constructeur identifié: ${data.make} ${data.model || ''}`;
                        vinFeedback.className = 'field-feedback feedback-success';

                        state.vehicle.method = 'vin';
                        state.vehicle.wmiDecoded = true;
                        state.vehicle.data = {
                            make: data.make,
                            model: data.model || '',
                            year: data.modelYear || '',
                            engine: data.engine || '',
                            vin: val,
                            platform: data.platform || '',
                            version: data.version || ''
                        };
                        state.vehicle.specifications = data.specifications || null;

                        // Sync inputs (attendre le chargement des modeles AVANT de verrouiller)
                        await syncManualFields(state.vehicle.data);
                        setManualFieldsDisabled(true);
                        vinInput.disabled = true;
                        vinInput.style.opacity = '0.5';

                        // Proposer la fiche (specs Vincario si dispo, sinon infos de base)
                        // On n'ouvre plus automatiquement : on signale juste le bouton par une animation.
                        btnMoreInfo.classList.remove('display-none');
                        btnMoreInfo.classList.add('pulse');

                        // Vehicule identifie -> focus sur la recherche de piece
                        focusPartSection();
                    } else {
                        throw new Error('No useful data returned');
                    }

                } catch (error) {
                    // Fallback to WMI if API fails but we have at least 3 chars
                    const wmi = val.substring(0, 3);
                    if (mockWMI[wmi]) {
                        vinFeedback.textContent = `✓ (Fallback) Constructeur: ${mockWMI[wmi].make}`;
                        vinFeedback.className = 'field-feedback feedback-warning';

                        state.vehicle.method = 'vin';
                        state.vehicle.wmiDecoded = true;
                        state.vehicle.data.make = mockWMI[wmi].make;

                        syncManualFields({ make: mockWMI[wmi].make, model: '', year: '', engine: '' });
                    } else {
                        vinFeedback.textContent = '✗ Impossible de décoder ce VIN.';
                        vinFeedback.className = 'field-feedback feedback-error';
                        state.vehicle.method = 'vin';
                        setManualFieldsDisabled(false);
                    }
                }
            }, 800); // 800ms debounce
        } else if (val.length >= 3 && val.length < 11) {
            // Very basic WMI check while typing if they haven't typed enough for full decode
            const wmi = val.substring(0, 3);
            if (mockWMI[wmi]) {
                vinFeedback.textContent = `ℹ️ WMI détecté: ${mockWMI[wmi].make} (Attente de la suite...)`;
                vinFeedback.className = 'field-feedback feedback-info';
                vinFeedback.style.display = 'block';
            } else {
                vinFeedback.style.display = 'none';
            }
            setManualFieldsDisabled(false);
            state.vehicle.method = null;
        } else {
            vinFeedback.style.display = 'none';
            setManualFieldsDisabled(false);
            state.vehicle.method = null;
        }
    });

    // Manual input override (Lowest Priority)
    function handleManualInput() {
        if (state.vehicle.method === 'carte_grise' || state.vehicle.method === 'vin') {
            return; // Protected fields
        }

        const hasManualData = makeSelect.value !== '' || modelInput.value !== '' || yearInput.value !== '' || engineInput.value !== '' || platformInput.value !== '' || versionInput.value !== '';

        if (hasManualData) {
            state.vehicle.method = 'manual';
            state.vehicle.data = {
                make: makeSelect.value.trim(),
                model: modelInput.value,
                year: yearInput.value,
                engine: engineInput.value,
                platform: platformInput.value,
                version: versionInput.value
            };
            vinInput.style.opacity = '0.5';
        } else {
            state.vehicle.method = null;
            vinInput.style.opacity = '1';
        }

        refreshPartLock();
    }

    // Load Makes from Backend on initialization
    async function initMakes() {
        const makesDatalist = document.getElementById('makes-list');
        if (!makesDatalist) return;
        try {
            const response = await fetch(`${API_BASE_URL}/vehicle/makes`);
            if (response.ok) {
                const makesList = await response.json();
                makesDatalist.innerHTML = '';
                cachedMakes = makesList;
                makesList.forEach(m => {
                    const makeValue = typeof m === 'object' ? (m.make || m.name) : m;
                    const option = document.createElement('option');
                    option.value = makeValue;
                    makesDatalist.appendChild(option);
                });
            } else {
                throw new Error("Failed to load");
            }
        } catch (e) {
            console.warn("Could not load dynamic makes, using basic fallback.", e);
            makesDatalist.innerHTML = `
                <option value="Renault"></option>
                <option value="Peugeot"></option>
                <option value="Citroën"></option>
                <option value="Audi"></option>
                <option value="BMW"></option>
                <option value="Mercedes-Benz"></option>
                <option value="Volkswagen"></option>
            `;
        }
    }
    initMakes();
    refreshPartLock(); // section piece verrouillee au demarrage

    // --- Autocompletion Marque (remplace le datalist natif, illisible sur Android) ---
    (function setupMakeAutocomplete() {
        const group = makeSelect.parentElement;
        if (!group) return;
        group.style.position = 'relative';

        const list = document.createElement('div');
        list.className = 'make-ac hidden';
        list.id = 'make-ac';
        group.appendChild(list);

        const labelOf = m => (typeof m === 'object' ? (m.make || m.name) : m) || '';
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        function hide() { list.classList.add('hidden'); list.innerHTML = ''; }

        function choose(val) {
            makeSelect.value = val;
            hide();
            // Reutilise toute la logique existante (chargement des modeles, etc.)
            makeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function render(q) {
            const ql = (q || '').trim().toLowerCase();
            if (!ql) { hide(); return; }
            const all = (cachedMakes || []).map(labelOf).filter(Boolean);
            const starts = [], incl = [];
            for (const name of all) {
                const nl = name.toLowerCase();
                if (nl.startsWith(ql)) starts.push(name);
                else if (nl.includes(ql)) incl.push(name);
            }
            const matches = starts.concat(incl).slice(0, 30);
            if (!matches.length) {
                list.innerHTML = '<div class="make-ac-empty">Aucune marque — saisie libre acceptée</div>';
                list.classList.remove('hidden');
                return;
            }
            list.innerHTML = matches.map(n => `<div class="make-ac-item" role="option">${esc(n)}</div>`).join('');
            list.classList.remove('hidden');
        }

        makeSelect.addEventListener('input', () => render(makeSelect.value));
        makeSelect.addEventListener('focus', () => { if (makeSelect.value) render(makeSelect.value); });
        // mousedown (avant le blur de l'input) pour que la selection soit prise en compte
        list.addEventListener('mousedown', (e) => {
            const item = e.target.closest('.make-ac-item');
            if (item) { e.preventDefault(); choose(item.textContent); }
        });
        makeSelect.addEventListener('blur', () => setTimeout(hide, 150));
    })();

    // Champs vehicule editables par defaut (mode manuel). Le decodage VIN les reverrouille.
    setManualFieldsDisabled(false);
    modelInput.disabled = true; // le modele se charge apres selection d'une marque

    // Fetch models when make changes
    makeSelect.addEventListener('change', async () => {
        handleManualInput();
        const make = makeSelect.value.trim();

        // Reset models
        modelInput.innerHTML = '<option value="">Sélectionner...</option>';
        modelInput.disabled = true;

        if (make) {
            try {
                modelInput.innerHTML = '<option value="">Chargement des modèles...</option>';
                const response = await fetch(`${API_BASE_URL}/vehicle/models/${encodeURIComponent(make)}`);
                if (response.ok) {
                    const models = await response.json();
                    modelInput.innerHTML = '<option value="">Sélectionner...</option>';
                    models.forEach(mod => {
                        const modelValue = typeof mod === 'object' ? (mod.model || mod.name) : mod;
                        const option = document.createElement('option');
                        option.value = modelValue;
                        option.textContent = modelValue;
                        modelInput.appendChild(option);
                    });
                    modelInput.disabled = false;
                    
                    // Reload makes to cache new entries in the datalist
                    initMakes();
                } else {
                    modelInput.innerHTML = '<option value="">Modèles introuvables</option>';
                }
            } catch (error) {
                modelInput.innerHTML = '<option value="">Erreur de chargement</option>';
            }
        }
    });

    modelInput.addEventListener('change', () => {
        handleManualInput();
        if (modelInput.value) focusPartSection(); // modele choisi -> focus recherche piece
    });
    yearInput.addEventListener('input', handleManualInput);
    engineInput.addEventListener('input', handleManualInput);
    platformInput.addEventListener('input', handleManualInput);
    versionInput.addEventListener('input', handleManualInput);

    // Part input adaptiveness
    partNumberInput.addEventListener('input', (e) => {
        if (e.target.value.length > 0) {
            document.getElementById('part-photo-group').style.opacity = '0.3';
            state.part.method = 'number';
        } else {
            document.getElementById('part-photo-group').style.opacity = '1';
            state.part.method = null;
        }
        // La description reste toujours modifiable (champ principal).
    });

    // Photo Upload (Drag & Drop)
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', function () {
        if (this.files.length) {
            handleFile(this.files[0]);
        }
    });

    function handleFile(file) {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                previewImg.src = e.target.result;
                dropZone.classList.add('display-none');
                filePreview.classList.remove('display-none');

                state.part.method = 'photo';
                state.part.hasPhoto = true;

                // La description reste modifiable : l'IA va y consolider desc + ref.
                partDescInput.style.opacity = '1';
                identifyPartFromPhoto(file);
            }
            reader.readAsDataURL(file);
        }
    }

    // Envoie la photo a l'IA (Gemini via server.js) avec le contexte vehicule,
    // et remplit le champ Description (modifiable) avec la piece identifiee + sa reference.
    async function identifyPartFromPhoto(file) {
        const prevPlaceholder = partDescInput.placeholder;
        partDescInput.placeholder = '⏳ Identification de la pièce par IA...';
        try {
            const fd = new FormData();
            fd.append('image', file);
            // Contexte vehicule -> l'IA identifie la piece pour CE modele
            fd.append('make', (state.vehicle.data.make || makeSelect.value || '').trim());
            fd.append('model', (state.vehicle.data.model || modelInput.value || '').trim());
            fd.append('year', (state.vehicle.data.year || yearInput.value || '').toString().trim());
            fd.append('engine', (state.vehicle.data.engine || engineInput.value || '').trim());

            // Endpoint servi par le serveur frontend (meme origine), pas le backend.
            const resp = await fetch('/api/identify-part', { method: 'POST', body: fd });
            if (!resp.ok) throw new Error('identify failed (' + resp.status + ')');
            const data = await resp.json();

            const desc = (data && data.description ? String(data.description) : '').trim();
            const oem = (data && data.oem ? String(data.oem) : '').trim();

            if (desc || oem) {
                let combined = desc;
                if (oem && oem.toLowerCase() !== 'null') {
                    combined += (combined ? ' — ' : '') + 'Réf: ' + oem;
                    if (!partNumberInput.value.trim()) partNumberInput.value = oem;
                }
                partDescInput.value = combined;
                state.part.number = oem || null;
                refreshPartLock();
            }
            partDescInput.placeholder = prevPlaceholder;
        } catch (err) {
            console.error('identify-part:', err);
            // Echec gracieux : la description reste editable, l'utilisateur complete a la main.
            partDescInput.placeholder = prevPlaceholder;
        }
    }

    btnRemoveImg.addEventListener('click', () => {
        fileInput.value = '';
        previewImg.src = '';
        dropZone.classList.remove('display-none');
        filePreview.classList.add('display-none');

        partNumberInput.style.opacity = '1';
        partDescInput.style.opacity = '1';
        state.part.method = null;
        state.part.hasPhoto = false;
    });

    // --- Search Submission ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Determine the query
        let query = partNumberInput.value.trim() || partDescInput.value.trim();
        if (!query) {
            const make = makeSelect.value.trim();
            const model = modelInput.value || '';
            if (make || model) {
                query = `${make} ${model} pièce`.trim();
            } else {
                query = "plaquettes de frein";
            }
        }

        // Hide empty state, show loading
        emptyState.classList.add('display-none');
        resultsContent.classList.add('display-none');
        loadingState.classList.remove('display-none');

        // Simulate network / processing delay cascade
        let steps = document.querySelectorAll('.loading-steps .step');

        const step1 = setTimeout(() => {
            steps[0].classList.replace('step-active', 'step-done');
            steps[0].querySelector('i').classList.replace('ph-spinner-gap', 'ph-check-circle');

            steps[1].classList.add('step-active');
            steps[1].querySelector('i').classList.replace('ph-circle', 'ph-spinner-gap');
        }, 600);

        const step2 = setTimeout(() => {
            steps[1].classList.replace('step-active', 'step-done');
            steps[1].querySelector('i').classList.replace('ph-spinner-gap', 'ph-check-circle');

            steps[2].classList.add('step-active');
            steps[2].querySelector('i').classList.replace('ph-circle', 'ph-spinner-gap');
        }, 1200);

        // Contexte véhicule (VIN prioritaire, sinon données décodées / saisie manuelle)
        const vehicleCtx = {
            vin: ((vinInput && vinInput.value) || state.vehicle.data.vin || '').trim() || null,
            make: (state.vehicle.data.make || makeSelect.value || '').trim() || null,
            model: (state.vehicle.data.model || modelInput.value || '').trim() || null,
            year: (state.vehicle.data.year || yearInput.value || '').toString().trim() || null,
            engine: (state.vehicle.data.engine || engineInput.value || '').trim() || null,
            platform: (state.vehicle.data.platform || platformInput.value || '').trim() || null,
        };
        const partRequest = {
            description: partDescInput.value.trim() || null,
            oem: partNumberInput.value.trim() || null,
        };
        const FALLBACK_IMG = window.PF_FALLBACK_IMG;

        try {
            // Flux complet : l'IA determine la piece PUIS les offres sont recuperees.
            const response = await fetch(`${API_BASE_URL}/parts/find`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vehicle: vehicleCtx,
                    request: partRequest,
                    limit: 50,
                    // Territoire du client : conditionne le tarif d'acheminement.
                    zone: (window.pfGetZone ? window.pfGetZone() : 'OM1'),
                })
            });

            if (!response.ok) throw new Error('Search failed');
            const data = await response.json();

            // Clear timeouts and mark all steps done
            clearTimeout(step1);
            clearTimeout(step2);
            steps.forEach(s => {
                s.className = 'step step-done';
                const i = s.querySelector('i');
                if (i) i.className = 'ph ph-check-circle';
            });

            loadingState.classList.add('display-none');

            const determined = data.part || {};
            const apiResults = Array.isArray(data.results) ? data.results : [];

            // Normalise les offres pour le renderer.
            let resultsToRender = apiResults.map(item => {
                const isUsed = item.condition && /USED|OCCAS|REFURB/i.test(item.condition);
                return {
                    id: item.itemId,
                    oem: determined.oem || partRequest.oem || '—',
                    brand: determined.category || 'Pièce',
                    name: item.title,
                    img: item.image || item.thumbnail || FALLBACK_IMG,
                    finalPrice: (item.finalPrice != null ? item.finalPrice : null),
                    prixClientEur: item.prixClientEur != null ? item.prixClientEur : null,
                    prixHorsPortEur: item.prixHorsPortEur != null ? item.prixHorsPortEur : null,
                    portInconnu: item.portInconnu !== false,
                    condition: isUsed ? 'used' : 'new',
                    description: item.fullDescription || item.shortDescription || '',
                    // Pas de lien vers l'annonce d'origine : la fiche détaillée
                    // passe par notre backend (bouton « Voir la fiche »).
                    // Le coût d'acquisition ne transite plus en clair : il est
                    // scellé dans ce jeton signé par le serveur, renvoyé tel
                    // quel avec la commande (illisible et infalsifiable ici).
                    offerToken: item.offerToken || null,
                    // Langue du titre : évite au navigateur de la deviner.
                    langue: item.langue || 'fr',
                    // Vendeur professionnel : information utile au client
                    // (stock, délais), sans jamais nommer la place de marché.
                    vendeurPro: !!item.vendeurProfessionnel,
                    isMock: !!item.isMock
                };
            });

            const resTitle = document.getElementById('res-part-name');
            const resTags = document.querySelector('.part-tags');

            resTitle.innerText = determined.partName || (resultsToRender[0] && resultsToRender[0].name) || 'Pièce';

            const vehicleDisplay = [vehicleCtx.make, vehicleCtx.model, vehicleCtx.engine]
                .filter(Boolean).join(' ') || 'Véhicule';
            const aiTag = determined.source === 'ai' ? '<span class="tag tag-vehicle">IA</span>' : '';
            resTags.innerHTML = `
                    <span class="tag tag-oem">OEM: ${determined.oem || partRequest.oem || '—'}</span>
                    <span class="tag tag-vehicle">${vehicleDisplay}</span>
                    ${aiTag}
                 `;

            window.currentSearchResults = resultsToRender;
            if (sortSelect) sortSelect.value = 'relevance'; // nouvelle recherche -> ordre par defaut

            if (resultsToRender.length === 0) {
                resultsContent.classList.remove('display-none');
                offersGrid.innerHTML = '<p style="color: var(--text-secondary); padding: 24px; line-height: 1.6;">Aucune pièce disponible pour cette recherche.<br>Essayez une référence constructeur (OEM) ou une description plus simple.</p>';
            } else {
                renderResults(resultsToRender);
                resultsContent.classList.remove('display-none');
            }

        } catch (error) {
            console.error("Search failed:", error);
            loadingState.classList.add('display-none');
            resultsContent.classList.remove('display-none');
            const resTitleErr = document.getElementById('res-part-name');
            if (resTitleErr) resTitleErr.innerText = 'Erreur de recherche';
            offersGrid.innerHTML = '<p style="color: #ff6b6b; padding: 24px; line-height: 1.6;">La recherche a échoué. Merci de réessayer dans un instant.</p>';
        } finally {
            // Reset loading UI for next time
            steps.forEach(s => {
                s.className = 'step';
                s.innerHTML = '<i class="ph ph-circle"></i> ' + s.innerText.replace('✓', '').replace('⏳', '').trim();
            });
            steps[0].classList.add('step-active');
            steps[0].querySelector('i').className = 'ph ph-spinner-gap';
        }
    });

    // --- Results Rendering ---
    const MARGIN_MULTIPLIER = 1.33; // 33% markup

    // Prix affiche d'une offre (sert au tri) — meme calcul que renderResults.
    function offerPrice(item) {
        // Priorité au prix tout compris, puis hors port, puis prix margé.
        if (item.prixClientEur != null) return Number(item.prixClientEur);
        if (item.prixHorsPortEur != null) return Number(item.prixHorsPortEur);
        return item.finalPrice != null ? item.finalPrice : 0;
    }

    // Tri cote client (aucun appel reseau) : reordonne les resultats deja recus.
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            const arr = (window.currentSearchResults || []).slice();
            switch (sortSelect.value) {
                case 'price-asc':  arr.sort((a, b) => offerPrice(a) - offerPrice(b)); break;
                case 'price-desc': arr.sort((a, b) => offerPrice(b) - offerPrice(a)); break;
                case 'cond-new':   arr.sort((a, b) => (a.condition === 'new' ? 0 : 1) - (b.condition === 'new' ? 0 : 1)); break;
                default: break; // 'relevance' = ordre d'origine
            }
            renderResults(arr);
        });
    }

    function renderResults(results) {
        offersGrid.innerHTML = '';

        results.forEach(item => {
            // Prix tout compris si calculable, sinon prix hors acheminement
            // outre-mer (affiché « + frais de port » avec un lien d'explication).
            const allIn = item.prixClientEur != null ? Number(item.prixClientEur) : null;
            const horsPort = item.prixHorsPortEur != null ? Number(item.prixHorsPortEur) : null;
            const fallback = (item.finalPrice != null ? item.finalPrice : 0);
            const displayPrice = (allIn != null ? allIn : (horsPort != null ? horsPort : fallback)).toFixed(2);
            const portSuffix = (allIn == null)
                ? ' <span class="offer-port">+ frais de port <button type="button" class="offer-port-link" data-shipping-info>?</button></span>'
                : '';

            // Description complete, nettoyee du HTML et tronquee.
            const rawDesc = (item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const shortDesc = rawDesc.length > 160 ? rawDesc.slice(0, 160) + '…' : rawDesc;
            const descHtml = shortDesc ? `<p class="offer-desc">${shortDesc}</p>` : '';
            const linkHtml = `<button type="button" class="offer-link" data-detail="${item.id}">Voir la fiche</button>`;
            const mockBadge = item.isMock ? '<span class="offer-mock" title="Résultat de démonstration">DÉMO</span>' : '';
            const proBadge = item.vendeurPro
                ? '<span class="offer-pro" title="Vendeur professionnel : stock important et délais tenus"><i class="ph ph-seal-check"></i> Pro</span>'
                : '';
            // Aucune source d'approvisionnement n'est exposee au client.
            const sourceBadge = '';

            const card = document.createElement('div');
            card.className = 'offer-card';
            card.innerHTML = `
                <div class="offer-img">
                    <span class="offer-condition cond-${item.condition}">${item.condition === 'new' ? 'Neuf' : 'Occasion'}</span>
                    ${sourceBadge}
                    ${mockBadge}
                    ${proBadge}
                    <img src="${item.img}" alt="${item.name}" loading="lazy" onerror="this.onerror=null;this.src=window.PF_FALLBACK_IMG">
                </div>
                <div class="offer-body">
                    <span class="offer-brand">${item.brand}</span>
                    <h4 class="offer-title" data-titre-id="${item.id}">${item.name}</h4>
                    ${descHtml}
                    <div class="offer-footer">
                        <div class="offer-price">${displayPrice} <span>€ TTC</span>${portSuffix}</div>
                        <div class="offer-actions">
                            ${linkHtml}
                            <button class="btn-add" data-id="${item.id}" title="Ajouter à la commande">
                                <i class="ph ph-plus"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            offersGrid.appendChild(card);
        });

        // Add event listeners to new buttons
        document.querySelectorAll('.btn-add').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                addToCart(id);
            });
        });

        // "Voir la fiche" -> page interne PartFinder
        document.querySelectorAll('.offer-link[data-detail]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                openItemDetail(e.currentTarget.getAttribute('data-detail'));
            });
        });

        traduireTitres(results);
    }

    /**
     * Traduit les titres étrangers APRÈS affichage : les résultats s'affichent
     * immédiatement, les titres se mettent à jour ensuite. Attendre la
     * traduction pour afficher rendrait la recherche perceptiblement plus lente.
     */
    async function traduireTitres(results) {
        if (!window.pfTraduire) return;
        const aTraduire = results.filter(r => r.langue && r.langue !== 'fr');
        if (!aTraduire.length) return;
        try {
            const textes = await window.pfTraduire(
                aTraduire.map(r => ({ texte: r.name, langue: r.langue }))
            );
            aTraduire.forEach((r, i) => {
                const t = textes[i];
                if (!t || t === r.name) return;
                const el = offersGrid.querySelector(`[data-titre-id="${CSS.escape(String(r.id))}"]`);
                if (!el) return;
                el.textContent = t;
                // L'original reste consultable : sur une pièce technique, une
                // référence peut se perdre à la traduction.
                el.title = r.name;
                r.nameFr = t;
            });
        } catch { /* les titres d'origine restent affichés */ }
    }

    // Ouvre une page interne PartFinder avec les informations de la piece
    function openItemDetail(itemId) {
        // Fenetre popup dimensionnee et centree (pas en plein ecran)
        const w = 940;
        const h = Math.min(900, (window.screen && window.screen.availHeight ? window.screen.availHeight - 80 : 900));
        const left = (window.screen && window.screen.availWidth) ? Math.max(0, Math.round((window.screen.availWidth - w) / 2)) : 120;
        const top = 40;
        const win = window.open('', 'partfinderFiche', `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`);
        if (!win) { alert("Veuillez autoriser les fenetres pop-up pour voir la fiche."); return; }
        win.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Fiche piece</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap" rel="stylesheet"><style>' + detailStyles() + '</style></head><body><div class="wrap"><p class="loading">Chargement de la fiche...</p></div></body></html>');
        win.document.close();

        // Langue connue depuis la recherche : elle évite une détection.
        const source = allItems.find(r => String(r.id) === String(itemId));
        const langue = (source && source.langue) || 'fr';

        fetch(`${API_BASE_URL}/parts/item/${encodeURIComponent(itemId)}`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error('not found')))
            .then(async (d) => {
                const w = win.document.querySelector('.wrap');
                if (!w) return;
                w.innerHTML = detailHtml(d);

                // La description porte l'état RÉEL de la pièce (rayures,
                // kilométrage, garantie) : elle doit être traduite par un
                // vrai moteur, jamais approximée.
                if (langue !== 'fr' && d.description && window.pfTraduire) {
                    const zone = win.document.querySelector('.desc');
                    if (zone) {
                        zone.insertAdjacentHTML('beforebegin',
                            '<p id="trad-etat" style="color:#94A3B8;font-size:.85rem;margin:0 0 8px">Traduction en cours…</p>');
                        try {
                            const [trad] = await window.pfTraduire([{ texte: d.description, langue }]);
                            const etat = win.document.getElementById('trad-etat');
                            if (trad && trad !== d.description) {
                                zone.textContent = trad;
                                if (etat) etat.textContent = 'Description traduite automatiquement — texte d\'origine sous réserve.';
                            } else if (etat) {
                                // Ne pas laisser croire à une traduction qui
                                // n'a pas eu lieu : l'état de la pièce en dépend.
                                etat.textContent = 'Traduction indisponible — description dans sa langue d\'origine.';
                            }
                        } catch {
                            const etat = win.document.getElementById('trad-etat');
                            if (etat) etat.textContent = 'Traduction indisponible — description dans sa langue d\'origine.';
                        }
                    }
                }
            })
            .catch(() => { const w = win.document.querySelector('.wrap'); if (w) w.innerHTML = '<p class="loading">Fiche indisponible pour cet article.</p>'; });
    }

    function detailStyles() {
        return `
            * { box-sizing: border-box; }
            body { margin:0; font-family:'Inter',sans-serif; background:#0B0F19; color:#E2E8F0; }
            .wrap { max-width: 1000px; margin: 0 auto; padding: 32px 24px 64px; }
            .loading { color:#94A3B8; text-align:center; padding:80px 0; }
            .head { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; flex-wrap:wrap; margin-bottom:4px; }
            h1 { font-family:'Outfit',sans-serif; font-size:1.4rem; line-height:1.3; margin:0; color:#F8FAFC; flex:1; min-width:260px; }
            .pricebox { text-align:right; white-space:nowrap; }
            .price { font-family:'Outfit',sans-serif; font-size:2rem; font-weight:700; color:#38BDF8; }
            .price span { font-size:.95rem; color:#94A3B8; font-weight:400; }
            .chip { display:inline-block; font-size:.78rem; padding:4px 12px; border-radius:99px; background:#132033; color:#7DD3FC; border:1px solid rgba(56,189,248,.25); margin-top:8px; }
            .gallery { margin:24px 0 8px; }
            .main-img { width:100%; max-height:420px; object-fit:contain; background:#131A2A; border:1px solid rgba(255,255,255,.06); border-radius:14px; }
            .thumbs { display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
            .thumbs img { width:72px; height:72px; object-fit:cover; border-radius:10px; background:#131A2A; border:1px solid rgba(255,255,255,.08); cursor:pointer; transition:border-color .15s; }
            .thumbs img:hover { border-color:#38BDF8; }
            h2 { font-family:'Outfit',sans-serif; font-size:1.05rem; color:#F8FAFC; margin:32px 0 12px; }
            .specs { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.06); border-radius:12px; overflow:hidden; }
            .spec { display:flex; justify-content:space-between; gap:12px; padding:12px 16px; background:#0F1626; font-size:.9rem; }
            .spec .k { color:#94A3B8; }
            .spec .v { color:#F1F5F9; text-align:right; font-weight:500; word-break:break-word; }
            .spec.oem { background:#10233b; }
            .spec.oem .v { color:#7DD3FC; }
            .desc { font-size:.92rem; line-height:1.7; color:#CBD5E1; background:#0F1626; border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:18px 20px; white-space:pre-line; }
            @media (max-width:640px){ .specs{ grid-template-columns:1fr; } .price{ font-size:1.6rem; } .head{ flex-direction:column; } .pricebox{ text-align:left; } }
        `;
    }

    function detailHtml(d) {
        const cur = d.currency || 'EUR';
        const priceStr = d.price != null ? Number(d.price).toFixed(2) + ' <span>' + cur + ' TTC</span>' : '&mdash;';
        const cond = d.condition ? '<div class="chip">' + d.condition + '</div>' : '';
        const imgs = (d.images || []).filter(Boolean);
        let gallery = '';
        if (imgs.length) {
            const thumbs = imgs.slice(0, 8).map(u => '<img src="' + u + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" onclick="var m=document.getElementById(\'mainImg\'); if(m){m.src=this.src;m.style.display=\'block\';}">').join('');
            gallery = '<div class="gallery"><img id="mainImg" class="main-img" referrerpolicy="no-referrer" src="' + imgs[0] + '" onerror="this.style.display=\'none\'"><div class="thumbs">' + thumbs + '</div></div>';
        }
        const aspects = (d.aspects || []).map(a => ({ name: a.name, value: Array.isArray(a.value) ? a.value.join(', ') : (a.value || '') }));
        const specsHtml = aspects.length
            ? '<h2>Caractéristiques</h2><div class="specs">' + aspects.map(a => {
                const isOem = /(oe|oem|référence|reference|part)/i.test(a.name);
                return '<div class="spec' + (isOem ? ' oem' : '') + '"><span class="k">' + a.name + '</span><span class="v">' + a.value + '</span></div>';
            }).join('') + '</div>'
            : '';
        const rawDesc = (d.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const descHtml = rawDesc ? '<h2>Description</h2><div class="desc">' + rawDesc + '</div>' : '';
        return '<div class="head"><h1>' + (d.title || 'Pièce') + '</h1><div class="pricebox"><div class="price">' + priceStr + '</div>' + cond + '</div></div>' + gallery + specsHtml + descHtml;
    }

    // --- Cart / Order Logic ---
    function addToCart(id) {
        // Le panier demande un compte : invité -> ouvre la connexion.
        if (window.pfIsLoggedIn && !window.pfIsLoggedIn()) {
            if (window.pfOpenAuth) window.pfOpenAuth('login');
            return;
        }

        const allItems = window.currentSearchResults || [];
        const item = allItems.find(r => r.id === id);
        if (!item) return;

        // Prevent duplicates (simple logic)
        if (state.cart.find(c => c.id === id)) {
            return;
        }

        const cartItem = {
            ...item,
            // Même logique que l'affichage : tout compris > hors port > margé.
            displayPrice: parseFloat(offerPrice(item).toFixed(2))
        };

        state.cart.push(cartItem);
        updateCartUI();

        // Visual feedback on nav icon
        const navIcon = navItems[1].querySelector('i');
        navIcon.classList.add('ph-fill');
        setTimeout(() => navIcon.classList.remove('ph-fill'), 500);

        // Show cart panel briefly
        if (cartPanel.classList.contains('display-none')) {
            navItems[1].click();
        }
    }

    function removeFromCart(id) {
        state.cart = state.cart.filter(item => item.id !== id);
        updateCartUI();
    }

    // Vide le panier apres l'envoi d'une demande de commande (appele par checkout.js).
    window.pfClearCart = function () {
        state.cart = [];
        updateCartUI();
        if (cartPanel) cartPanel.classList.add('display-none');
    };

    function updateCartUI() {
        // Update badge
        if (state.cart.length > 0) {
            cartBadge.textContent = state.cart.length;
            cartBadge.classList.remove('display-none');
        } else {
            cartBadge.classList.add('display-none');
        }

        // Render items in panel
        cartItems.innerHTML = '';
        let total = 0;

        state.cart.forEach(item => {
            total += item.displayPrice;

            const el = document.createElement('div');
            el.className = 'cart-item';
            el.innerHTML = `
                <div class="cart-item-img"><img src="${item.img}" alt="img"></div>
                <div class="cart-item-info">
                    <div class="offer-brand">${item.brand}</div>
                    <div class="cart-item-title">${item.name}</div>
                    <div class="cart-item-price">${item.displayPrice.toFixed(2)} €</div>
                </div>
                <button class="btn-remove-cart" data-id="${item.id}"><i class="ph ph-trash"></i></button>
            `;
            cartItems.appendChild(el);
        });

        cartTotalPrice.textContent = total.toFixed(2) + ' €';

        // Add remove listeners
        document.querySelectorAll('.btn-remove-cart').forEach(btn => {
            btn.addEventListener('click', (e) => {
                removeFromCart(e.currentTarget.getAttribute('data-id'));
            });
        });
    }

    // Checkout Action
    btnCheckout.addEventListener('click', async () => {
        if (state.cart.length === 0) {
            alert("Votre panier est vide.");
            return;
        }

        // La commande demande un compte.
        if (window.pfIsLoggedIn && !window.pfIsLoggedIn()) {
            if (window.pfOpenAuth) window.pfOpenAuth('login');
            return;
        }

        const items = state.cart.map(item => ({
            partOem: item.oem || 'OEM-REF',
            partName: item.name,
            quantity: 1,
            priceSold: item.displayPrice,
            // Cout d'acquisition (interne) transmis pour la validation operateur.
            // Jeton signé par le serveur : contient le coût d'acquisition,
            // que le serveur relira lui-même (rien à déclarer côté client).
            offerToken: item.offerToken || null,
        }));

        // Ouvre le tunnel de paiement Stripe (livraison + redirection).
        if (window.pfCheckout) {
            window.pfCheckout(items);
        } else {
            alert("Le module de paiement n'est pas disponible.");
        }
    });

    // Navigation and Cart toggling
    navItems[0].addEventListener('click', (e) => {
        e.preventDefault();
        navItems.forEach(n => n.classList.remove('active'));
        navItems[0].classList.add('active');
        cartPanel.classList.add('display-none');
    });

    navItems[1].addEventListener('click', (e) => {
        e.preventDefault();
        if (cartPanel.classList.contains('display-none')) {
            navItems.forEach(n => n.classList.remove('active'));
            navItems[1].classList.add('active');
            cartPanel.classList.remove('display-none');
        } else {
            navItems[1].classList.remove('active');
            navItems[0].classList.add('active');
            cartPanel.classList.add('display-none');
        }
    });

    closeCartBtn.addEventListener('click', () => {
        navItems[1].classList.remove('active');
        navItems[0].classList.add('active');
        cartPanel.classList.add('display-none');
    });

    // Chat Toggle
    toggleChatBtn.addEventListener('click', () => {
        chatWidget.classList.toggle('collapsed');
        const icon = toggleChatBtn.querySelector('i');
        if (chatWidget.classList.contains('collapsed')) {
            icon.classList.replace('ph-caret-down', 'ph-caret-up');
        } else {
            icon.classList.replace('ph-caret-up', 'ph-caret-down');
        }
    });

    function addChatMessage(sender, text) {
        const body = document.getElementById('chat-body');
        const msg = document.createElement('div');
        msg.className = `chat-msg ${sender}`;
        msg.textContent = text;
        body.appendChild(msg);
        body.scrollTop = body.scrollHeight;
    }

    // Quick Demo Chat response hook
    const chatInput = document.querySelector('.chat-input input');
    document.querySelector('.chat-input button').addEventListener('click', handleChatSubmit);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleChatSubmit();
    });

    function handleChatSubmit() {
        if (chatInput.value.trim() === '') return;

        addChatMessage('user', chatInput.value);
        let val = chatInput.value;
        chatInput.value = '';

        setTimeout(() => {
            addChatMessage('ai', "Je note cette précision concernant votre véhicule. Je l'intègre à la recherche.");
            // Example of AI injecting data into form automatically
            if (val.toLowerCase().includes('clio')) {
                makeSelect.value = 'renault';
                document.getElementById('model').value = 'Clio';
                manualVehicleFields.style.opacity = '1';
                vinInput.style.opacity = '0.5';
            }
        }, 1000);
    }

    // Reset btn
    document.getElementById('btn-reset').addEventListener('click', () => {
        form.reset();
        vinFeedback.style.display = 'none';
        btnMoreInfo.classList.add('display-none');
        btnMoreInfo.classList.remove('pulse');

        // Revenir a l'onglet VIN (etat de depart)
        var vinTab = document.querySelector('.veh-tab[data-veh-tab="vin"]');
        if (vinTab) vinTab.click();

        // Reautoriser le focus auto vers la piece a la prochaine identification
        vehicleFocusDone = false;

        // Remonter en haut de la page (conteneur scrollable + fenetre pour le mobile)
        var stack = document.querySelector('.search-stack');
        if (stack) stack.scrollTo({ top: 0, behavior: 'smooth' });
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Reset manual fields UI
        makeSelect.disabled = false;
        modelInput.disabled = true; // disabled until make selected
        modelInput.innerHTML = '<option value="">Sélectionner d\'abord une marque...</option>';
        yearInput.disabled = false;
        engineInput.disabled = false;
        platformInput.disabled = false;
        versionInput.disabled = false;
        manualVehicleFields.style.opacity = '1';

        vinInput.disabled = false;
        vinInput.style.opacity = '1';

        partNumberInput.style.opacity = '1';
        partDescInput.style.opacity = '1';
        document.getElementById('part-photo-group').style.opacity = '1';
        btnRemoveImg.click();

        emptyState.classList.remove('display-none');
        resultsContent.classList.add('display-none');
        loadingState.classList.add('display-none');

        state.vehicle = { method: null, data: { make: '', model: '', year: '', engine: '', vin: '', platform: '', version: '' }, wmiDecoded: false, specifications: null };
        state.part = { method: null, number: null, hasPhoto: false };
        refreshPartLock();
    });

    // Plus d'infos btn (Detailed specs window)
    btnMoreInfo.addEventListener('click', () => {
        btnMoreInfo.classList.remove('pulse'); // l'utilisateur a vu la fiche : on stoppe le signal

        const d = state.vehicle.data || {};
        const specs = state.vehicle.specifications || {
            'Marque': d.make || '—',
            'Modèle': d.model || '—',
            'Année': d.year || '—',
            'Plateforme': d.platform || '—',
            'Version': d.version || '—',
            'Moteur': d.engine || '—',
            'VIN': d.vin || '—'
        };
        const vin = state.vehicle.data.vin || '';
        
        const _sw = 940;
        const _sh = Math.min(900, (window.screen && window.screen.availHeight ? window.screen.availHeight - 80 : 900));
        const _sl = (window.screen && window.screen.availWidth) ? Math.max(0, Math.round((window.screen.availWidth - _sw) / 2)) : 120;
        const specWindow = window.open('', 'partfinderVehicule', `width=${_sw},height=${_sh},left=${_sl},top=40,scrollbars=yes,resizable=yes`);
        if (!specWindow) {
            alert("Veuillez autoriser les fenêtres pop-up pour voir les détails.");
            return;
        }

        let tableRows = '';
        for (const [key, value] of Object.entries(specs)) {
            tableRows += `
                <tr>
                    <td><strong>${key}</strong></td>
                    <td>${value}</td>
                </tr>
            `;
        }

        specWindow.document.write(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Détails Véhicule - ${vin}</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
                <script src="https://unpkg.com/@phosphor-icons/web"></script>
                <style>
                    body {
                        background-color: #0B0F19;
                        color: #F8FAFC;
                        font-family: 'Inter', sans-serif;
                        margin: 0;
                        padding: 40px 20px;
                        display: flex;
                        justify-content: center;
                    }
                    .container {
                        max-width: 800px;
                        width: 100%;
                        background: #131A2A;
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        border-radius: 12px;
                        padding: 30px;
                        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
                    }
                    .header {
                        display: flex;
                        align-items: center;
                        gap: 15px;
                        margin-bottom: 25px;
                        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                        padding-bottom: 20px;
                    }
                    .header i {
                        font-size: 2.5rem;
                        color: #3B82F6;
                    }
                    .header h1 {
                        margin: 0;
                        font-family: 'Outfit', sans-serif;
                        font-size: 1.8rem;
                    }
                    .header p {
                        margin: 5px 0 0 0;
                        color: #94A3B8;
                        font-size: 0.95rem;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 10px;
                    }
                                tr {
                        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    }
                    tr:hover {
                        background: rgba(255, 255, 255, 0.02);
                    }
                    td {
                        padding: 12px 16px;
                        font-size: 0.9rem;
                    }
                    td:first-child {
                        color: #94A3B8;
                        width: 40%;
                    }
                    td:last-child {
                        color: #F8FAFC;
                        font-weight: 500;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <i class="ph-fill ph-barcode"></i>
                        <div>
                            <h1>Détails Techniques Véhicule</h1>
                            <p>Numéro de Châssis (VIN) : <strong>${vin}</strong></p>
                        </div>
                    </div>
                    <table>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
        specWindow.document.close();
    });

});
