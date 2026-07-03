/**
 * PartFinder Prototype Logic (Phase 1)
 */

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
                    modelInput.disabled = false;

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
        if (data.version) versionInput.value = data.version;
    }

    // Carte Grise Mockup (Highest Priority)
    btnScanCg.addEventListener('click', () => cgInput.click());
    cgInput.addEventListener('change', async (e) => {
        if (e.target.files.length) {
            vinFeedback.textContent = '⏳ Analyse de la carte grise en cours (Simulation OCR)...';
            vinFeedback.className = 'field-feedback feedback-info';
            vinFeedback.style.display = 'block';

            // Simulate OCR extracting a license plate after a brief delay
            setTimeout(async () => {
                const simulatedExtractedPlate = 'AA123AA'; // Replace with actual OCR later
                vinFeedback.textContent = `⏳ Plaque détectée (${simulatedExtractedPlate}). Recherche des infos du véhicule...`;

                try {
                    const response = await fetch(`${API_BASE_URL}/vehicle/plate/${simulatedExtractedPlate}`);
                    if (!response.ok) throw new Error('API Error');

                    const data = await response.json();

                    if (data && data.make) {
                        const parsedData = {
                            make: data.make,
                            model: data.model || '',
                            year: data.modelYear || data.year || '',
                            engine: data.engine || data.engine_displacement || '',
                            vin: data.vin || 'VIN NON TROUVÉ',
                            platform: data.platform || '',
                            version: data.version || ''
                        };

                        state.vehicle.method = 'carte_grise';
                        state.vehicle.data = parsedData;
                        state.vehicle.specifications = data.specifications || null;

                        vinInput.value = parsedData.vin;
                        vinInput.disabled = true;
                        vinInput.style.opacity = '0.5';

                        syncManualFields(parsedData);
                        setManualFieldsDisabled(true);

                        vinFeedback.textContent = `✓ Carte Grise validée: ${parsedData.make} ${parsedData.model}`;
                        vinFeedback.className = 'field-feedback feedback-success';

                        if (state.vehicle.specifications) {
                            btnMoreInfo.classList.remove('display-none');
                        } else {
                            btnMoreInfo.classList.add('display-none');
                        }
                    } else {
                        throw new Error("Données insuffisantes");
                    }
                } catch (error) {
                    console.error("Erreur API Plaque:", error);
                    vinFeedback.textContent = '✗ Impossible de récupérer les infos de cette plaque via l\'API. (Vérifiez votre clé RapidAPI backend)';
                    vinFeedback.className = 'field-feedback feedback-error';

                    // Cleanup file input so they can try again
                    cgInput.value = '';
                }
            }, 1000);
        }
    });

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

                        // Sync inputs
                        syncManualFields(state.vehicle.data);
                        setManualFieldsDisabled(true);
                        vinInput.disabled = true;
                        vinInput.style.opacity = '0.5';

                        if (state.vehicle.specifications) {
                            btnMoreInfo.classList.remove('display-none');
                        } else {
                            btnMoreInfo.classList.add('display-none');
                        }
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

    modelInput.addEventListener('change', handleManualInput);
    yearInput.addEventListener('input', handleManualInput);
    engineInput.addEventListener('input', handleManualInput);
    platformInput.addEventListener('input', handleManualInput);
    versionInput.addEventListener('input', handleManualInput);

    // Part input adaptiveness
    partNumberInput.addEventListener('input', (e) => {
        if (e.target.value.length > 0) {
            document.getElementById('part-photo-group').style.opacity = '0.3';
            partDescInput.style.opacity = '0.3';
            state.part.method = 'number';
        } else {
            document.getElementById('part-photo-group').style.opacity = '1';
            partDescInput.style.opacity = '1';
            state.part.method = null;
        }
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

                // Adaptive logic
                partNumberInput.style.opacity = '0.3';
                partDescInput.style.opacity = '0.3';
                state.part.method = 'photo';
                state.part.hasPhoto = true;

                // Simulate AI Assistant pop opening automatically
                setTimeout(() => {
                    chatWidget.classList.remove('collapsed');
                    addChatMessage('ai', "J'analyse votre photo... Je vois ce qui ressemble à des plaquettes de frein. Avez-vous une référence inscrite au dos ?");
                }, 800);
            }
            reader.readAsDataURL(file);
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
        };
        const partRequest = {
            description: partDescInput.value.trim() || null,
            oem: partNumberInput.value.trim() || null,
        };
        const FALLBACK_IMG = 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&q=80&w=400';

        try {
            // Flux complet : l'IA détermine la pièce PUIS eBay renvoie les offres.
            const response = await fetch(`${API_BASE_URL}/parts/find`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vehicle: vehicleCtx, request: partRequest, limit: 8 })
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

            // Normalise les annonces eBay pour le renderer.
            let resultsToRender = apiResults.map(item => {
                const src = item.sourcePrice != null ? item.sourcePrice : (item.price != null ? item.price : 0);
                const isUsed = item.condition && /USED|OCCAS|REFURB/i.test(item.condition);
                return {
                    id: item.itemId,
                    oem: determined.oem || partRequest.oem || '—',
                    brand: determined.category || 'Pièce',
                    name: item.title,
                    img: item.image || item.thumbnail || FALLBACK_IMG,
                    sourcePrice: src,
                    finalPrice: (item.finalPrice != null ? item.finalPrice : null),
                    condition: isUsed ? 'used' : 'new',
                    description: item.fullDescription || item.shortDescription || '',
                    url: item.itemWebUrl || null,
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

            if (resultsToRender.length === 0) {
                emptyState.classList.remove('display-none');
            } else {
                renderResults(resultsToRender);
                resultsContent.classList.remove('display-none');
            }

        } catch (error) {
            console.error("Search failed:", error);
            loadingState.classList.add('display-none');
            emptyState.classList.remove('display-none');
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

    function renderResults(results) {
        offersGrid.innerHTML = '';

        results.forEach(item => {
            const displayPrice = (item.finalPrice != null
                ? item.finalPrice
                : (item.sourcePrice || 0) * MARGIN_MULTIPLIER).toFixed(2);

            // Description complète eBay, nettoyée du HTML et tronquée.
            const rawDesc = (item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const shortDesc = rawDesc.length > 160 ? rawDesc.slice(0, 160) + '…' : rawDesc;
            const descHtml = shortDesc ? `<p class="offer-desc">${shortDesc}</p>` : '';
            const linkHtml = item.url
                ? `<a class="offer-link" href="${item.url}" target="_blank" rel="noopener">Voir la fiche</a>`
                : '';
            const mockBadge = item.isMock ? '<span class="offer-mock" title="Résultat de démonstration">DÉMO</span>' : '';

            const card = document.createElement('div');
            card.className = 'offer-card';
            card.innerHTML = `
                <div class="offer-img">
                    <span class="offer-condition cond-${item.condition}">${item.condition === 'new' ? 'Neuf' : 'Occasion'}</span>
                    ${mockBadge}
                    <img src="${item.img}" alt="${item.name}" onerror="this.src='${'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&q=80&w=400'}'">
                </div>
                <div class="offer-body">
                    <span class="offer-brand">${item.brand}</span>
                    <h4 class="offer-title">${item.name}</h4>
                    ${descHtml}
                    <div class="offer-footer">
                        <div class="offer-price">${displayPrice} <span>€ TTC</span></div>
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
    }

    // --- Cart / Order Logic ---
    function addToCart(id) {
        const allItems = window.currentSearchResults || [];
        const item = allItems.find(r => r.id === id);
        if (!item) return;

        // Prevent duplicates (simple logic)
        if (state.cart.find(c => c.id === id)) {
            return;
        }

        const cartItem = {
            ...item,
            displayPrice: parseFloat((item.finalPrice != null ? item.finalPrice : item.sourcePrice * MARGIN_MULTIPLIER).toFixed(2))
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

        const contact = prompt("Entrez les coordonnées du client pour cette commande :", "client@example.com");
        if (contact === null) return; // User cancelled

        const items = state.cart.map(item => ({
            partOem: item.oem || 'OEM-REF',
            partName: item.name,
            quantity: 1,
            priceSold: item.displayPrice
        }));

        try {
            btnCheckout.disabled = true;
            btnCheckout.textContent = "Validation en cours...";

            const response = await fetch(`${API_BASE_URL}/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contactInfo: contact, items })
            });

            if (!response.ok) throw new Error('Order creation failed');

            const orderData = await response.json();
            alert(`✓ Commande enregistrée ! ID Commande : ${orderData.order.id}`);

            // Clear cart
            state.cart = [];
            updateCartUI();

            // Close cart panel
            closeCartBtn.click();

        } catch (error) {
            console.error("Checkout failed:", error);
            alert("Une erreur est survenue lors de l'enregistrement de la commande.");
        } finally {
            btnCheckout.disabled = false;
            btnCheckout.textContent = "Valider la demande";
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
    });

    // Plus d'infos btn (Detailed specs window)
    btnMoreInfo.addEventListener('click', () => {
        if (!state.vehicle.specifications) return;
        
        const specs = state.vehicle.specifications;
        const vin = state.vehicle.data.vin || '';
        
        const specWindow = window.open('', '_blank');
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
            