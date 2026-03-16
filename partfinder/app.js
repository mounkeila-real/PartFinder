/**
 * PartFinder Prototype Logic (Phase 1)
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    // Change this to your backend's actual Railway URL if different.
    const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api'
        : 'https://partfinder-backend-production.up.railway.app/api';
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

    const manualVehicleFields = document.getElementById('manual-vehicle-fields');
    const makeSelect = document.getElementById('make');
    const modelInput = document.getElementById('model');
    const yearInput = document.getElementById('year');
    const engineInput = document.getElementById('engine');

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
        manualVehicleFields.style.opacity = disabled ? '0.5' : '1';
    }

    function syncManualFields(data) {
        if (data.make) {
            for (let i = 0; i < makeSelect.options.length; i++) {
                if (makeSelect.options[i].text.toLowerCase() === data.make.toLowerCase()) {
                    makeSelect.selectedIndex = i;
                    break;
                }
            }
        }
        if (data.model) modelInput.value = data.model;
        if (data.year) yearInput.value = data.year;
        if (data.engine) engineInput.value = data.engine;
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
                            vin: data.vin || 'VIN NON TROUVÉ'
                        };

                        state.vehicle.method = 'carte_grise';
                        state.vehicle.data = parsedData;

                        vinInput.value = parsedData.vin;
                        vinInput.disabled = true;
                        vinInput.style.opacity = '0.5';

                        syncManualFields(parsedData);
                        setManualFieldsDisabled(true);

                        vinFeedback.textContent = `✓ Carte Grise validée: ${parsedData.make} ${parsedData.model}`;
                        vinFeedback.className = 'field-feedback feedback-success';
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
                            vin: val
                        };

                        // Sync inputs
                        syncManualFields(state.vehicle.data);
                        setManualFieldsDisabled(true);
                        vinInput.disabled = false;
                        vinInput.style.opacity = '1';
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

        const hasManualData = makeSelect.value !== '' || modelInput.value !== '' || yearInput.value !== '' || engineInput.value !== '';

        if (hasManualData) {
            state.vehicle.method = 'manual';
            state.vehicle.data = {
                make: makeSelect.options[makeSelect.selectedIndex]?.text || '',
                model: modelInput.value,
                year: yearInput.value,
                engine: engineInput.value
            };
            vinInput.style.opacity = '0.5';
        } else {
            state.vehicle.method = null;
            vinInput.style.opacity = '1';
        }
    }

    // Load Makes from Backend on initialization
    async function initMakes() {
        try {
            makeSelect.innerHTML = '<option value="">Chargement des marques...</option>';
            const response = await fetch(`${API_BASE_URL}/vehicle/makes`);
            if (response.ok) {
                const makesList = await response.json();
                makeSelect.innerHTML = '<option value="">Sélectionner...</option>';
                cachedMakes = makesList;
                makesList.forEach(m => {
                    const makeValue = typeof m === 'object' ? (m.make || m.name) : m;
                    const option = document.createElement('option');
                    option.value = makeValue;
                    option.textContent = makeValue;
                    makeSelect.appendChild(option);
                });
            } else {
                throw new Error("Failed to load");
            }
        } catch (e) {
            console.warn("Could not load dynamic makes, using basic fallback.", e);
            makeSelect.innerHTML = `
                <option value="">Sélectionner...</option>
                <option value="Renault">Renault</option>
                <option value="Peugeot">Peugeot</option>
                <option value="Citroen">Citroën</option>
                <option value="Audi">Audi</option>
                <option value="BMW">BMW</option>
            `;
        }
    }
    initMakes();

    // Fetch models when make changes
    makeSelect.addEventListener('change', async () => {
        handleManualInput();
        const make = makeSelect.value;

        // Reset models
        modelInput.innerHTML = '<option value="">Sélectionner d\'abord une marque...</option>';
        modelInput.disabled = true;

        if (make) {
            try {
                modelInput.innerHTML = '<option value="">Chargement des modèles...</option>';
                const response = await fetch(`${API_BASE_URL}/vehicle/models/${encodeURIComponent(make)}`);
                if (response.ok) {
                    const models = await response.json();
                    modelInput.innerHTML = '<option value="">Sélectionner le modèle...</option>';
                    models.forEach(mod => {
                        const modelValue = typeof mod === 'object' ? (mod.model || mod.name) : mod;
                        const option = document.createElement('option');
                        option.value = modelValue;
                        option.textContent = modelValue;
                        modelInput.appendChild(option);
                    });
                    modelInput.disabled = false;
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
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        // Hide empty state, show loading
        emptyState.classList.add('display-none');
        resultsContent.classList.add('display-none');
        loadingState.classList.remove('display-none');

        // Simulate network / processing delay cascade
        let steps = document.querySelectorAll('.loading-steps .step');

        setTimeout(() => {
            steps[0].classList.replace('step-active', 'step-done');
            steps[0].querySelector('i').classList.replace('ph-spinner-gap', 'ph-check-circle');

            steps[1].classList.add('step-active');
            steps[1].querySelector('i').classList.replace('ph-circle', 'ph-spinner-gap');
        }, 800);

        setTimeout(() => {
            steps[1].classList.replace('step-active', 'step-done');
            steps[1].querySelector('i').classList.replace('ph-spinner-gap', 'ph-check-circle');

            steps[2].classList.add('step-active');
            steps[2].querySelector('i').classList.replace('ph-circle', 'ph-spinner-gap');
        }, 1600);

        setTimeout(() => {
            // Processing done
            loadingState.classList.add('display-none');

            // Dynamic mock logic based on inputs
            // We use dummy fetch logic for search because real catalog search 
            // wasn't fully requested yet (requires eCommerce DB).
            let resultsToRender = [
                {
                    id: 'p1', oem: '7701477023', brand: 'BOSCH', name: 'Jeu de 4 plaquettes de frein', img: 'https://images.oscaro.com/catalog/bosch/400/0986424794.jpg', sourcePrice: 28.50, condition: 'new'
                },
                {
                    id: 'p2', oem: 'GEN-X01', brand: 'VALEO', name: 'Pièce de rechange', img: 'https://images.oscaro.com/catalog/valeo/400/301636.jpg', sourcePrice: 32.10, condition: 'new'
                }];

            const makeValue = makeSelect.value.toLowerCase();
            const descValue = partDescInput.value.toLowerCase();
            const method = state.vehicle.method;

            // Update title
            const resTitle = document.getElementById('res-part-name');
            const resTags = document.querySelector('.part-tags');
            if (resultsToRender.length > 0) {
                resTitle.innerText = resultsToRender[0].name;

                let vehicleDisplay = 'Véhicule Multiple';
                if (method === 'carte_grise' || method === 'vin') {
                    vehicleDisplay = state.vehicle.data.make;
                    if (state.vehicle.data.model) vehicleDisplay += ` ${state.vehicle.data.model}`;
                    if (state.vehicle.data.engine) vehicleDisplay += ` ${state.vehicle.data.engine}`;
                } else if (method === 'manual') {
                    vehicleDisplay = makeSelect.options[makeSelect.selectedIndex]?.text;
                    if (modelInput.value) vehicleDisplay += ` ${modelInput.value}`;
                    if (engineInput.value) vehicleDisplay += ` ${engineInput.value}`;
                }

                resTags.innerHTML = `
                    <span class="tag tag-oem">OEM: ${resultsToRender[0].oem}</span>
                    <span class="tag tag-vehicle">${vehicleDisplay}</span>
                 `;
            }

            renderResults(resultsToRender);
            resultsContent.classList.remove('display-none');

            // Reset loading UI for next time
            steps.forEach(s => {
                s.className = 'step';
                s.innerHTML = '<i class="ph ph-circle"></i> ' + s.innerText;
            });
            steps[0].classList.add('step-active');
            steps[0].querySelector('i').className = 'ph ph-spinner-gap';

        }, 2500);
    });

    // --- Results Rendering ---
    const MARGIN_MULTIPLIER = 1.33; // 33% markup

    function renderResults(results) {
        offersGrid.innerHTML = '';

        results.forEach(item => {
            const displayPrice = (item.sourcePrice * MARGIN_MULTIPLIER).toFixed(2);

            const card = document.createElement('div');
            card.className = 'offer-card';
            card.innerHTML = `
                <div class="offer-img">
                    <span class="offer-condition cond-${item.condition}">${item.condition === 'new' ? 'Neuf' : 'Occasion'}</span>
                    <img src="${item.img}" alt="${item.name}">
                </div>
                <div class="offer-body">
                    <span class="offer-brand">${item.brand}</span>
                    <h4 class="offer-title">${item.name}</h4>
                    <div class="offer-footer">
                        <div class="offer-price">${displayPrice} <span>€ TTC</span></div>
                        <button class="btn-add" data-id="${item.id}" title="Ajouter à la commande">
                            <i class="ph ph-plus"></i>
                        </button>
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
        let allItems = [];
        Object.values(mockResults).forEach(arr => allItems = allItems.concat(arr));
        const item = allItems.find(r => r.id === id);
        if (!item) return;

        // Prevent duplicates (simple logic)
        if (state.cart.find(c => c.id === id)) {
            // Flash red on button or similar
            return;
        }

        const cartItem = {
            ...item,
            displayPrice: parseFloat((item.sourcePrice * MARGIN_MULTIPLIER).toFixed(2))
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

        // Reset manual fields UI
        makeSelect.disabled = false;
        modelInput.disabled = true; // disabled until make selected
        modelInput.innerHTML = '<option value="">Sélectionner d\'abord une marque...</option>';
        yearInput.disabled = false;
        engineInput.disabled = false;
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

        state.vehicle = { method: null, data: { make: '', model: '', year: '', engine: '', vin: '' }, wmiDecoded: false };
        state.part = { method: null, number: null, hasPhoto: false };
    });

});
