/**
 * PartFinder Prototype Logic (Phase 1)
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- State Management ---
    const state = {
        vehicle: {
            method: null, // 'vin' or 'manual'
            vin: null,
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

    const mockResults = {
        default: [
            {
                id: 'p1', oem: '7701477023', brand: 'BOSCH', name: 'Jeu de 4 plaquettes de frein avant', img: 'https://images.oscaro.com/catalog/bosch/400/0986424794.jpg', sourcePrice: 28.50, condition: 'new'
            },
            {
                id: 'p2', oem: '7701477023', brand: 'VALEO', name: 'Plaquettes de frein (Essieu avant)', img: 'https://images.oscaro.com/catalog/valeo/400/301636.jpg', sourcePrice: 32.10, condition: 'new'
            }
        ],
        bmw: [
            {
                id: 'b1', oem: '34116792223', brand: 'BREMBO', name: 'Disques de frein forgés (Paire)', img: 'https://images.oscaro.com/catalog/brembo/400/09-b337-21.jpg', sourcePrice: 115.00, condition: 'new'
            },
            {
                id: 'b2', oem: '34116792223', brand: 'TRW', name: 'Jeu de disques sur essieu avant', img: 'https://images.oscaro.com/catalog/trw/400/df6600s.jpg', sourcePrice: 98.40, condition: 'new'
            }
        ],
        audi: [
            {
                id: 'a1', oem: '4G0698151D', brand: 'BOSCH', name: 'Plaquettes de frein (avec contact d\'usure)', img: 'https://images.oscaro.com/catalog/bosch/400/0986494723.jpg', sourcePrice: 54.20, condition: 'new'
            }
        ],
        filter: [
            {
                id: 'f1', oem: 'PURFLUX-L394', brand: 'PURFLUX', name: 'Filtre à huile', img: 'https://images.oscaro.com/catalog/purflux/400/l394.jpg', sourcePrice: 8.90, condition: 'new'
            },
            {
                id: 'f2', oem: 'MANN-HU711/51X', brand: 'MANN-FILTER', name: 'Filtre à huile avec joint', img: 'https://images.oscaro.com/catalog/mann-filter/400/hu711-51x.jpg', sourcePrice: 11.20, condition: 'new'
            }
        ]
    };

    // --- DOM Elements ---
    const form = document.getElementById('search-form');
    const vinInput = document.getElementById('vin');
    const vinFeedback = document.getElementById('vin-feedback');
    const manualVehicleFields = document.getElementById('manual-vehicle-fields');
    const makeSelect = document.getElementById('make');

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

    // VIN Input
    vinInput.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase();
        e.target.value = val;

        if (val.length >= 3) {
            const wmi = val.substring(0, 3);
            if (mockWMI[wmi]) {
                vinFeedback.textContent = `✓ Constructeur identifié: ${mockWMI[wmi].make}`;
                vinFeedback.className = 'field-feedback feedback-success';
                vinFeedback.style.display = 'block';

                // Auto-fill manual dropdown
                for (let i = 0; i < makeSelect.options.length; i++) {
                    if (makeSelect.options[i].text.toLowerCase() === mockWMI[wmi].make.toLowerCase()) {
                        makeSelect.selectedIndex = i;
                        break;
                    }
                }

                // Dim manual fields logically (UI feedback)
                manualVehicleFields.style.opacity = '0.5';
                state.vehicle.method = 'vin';
                state.vehicle.wmiDecoded = true;
            } else if (val.length >= 17) {
                vinFeedback.textContent = '✗ WMI inconnu. Décodage étendu nécessaire (API).';
                vinFeedback.className = 'field-feedback feedback-error';
                vinFeedback.style.display = 'block';
            } else {
                vinFeedback.style.display = 'none';
                manualVehicleFields.style.opacity = '1';
                state.vehicle.method = null;
            }
        } else {
            vinFeedback.style.display = 'none';
            manualVehicleFields.style.opacity = '1';
        }
    });

    // Manual input override
    makeSelect.addEventListener('change', () => {
        if (!state.vehicle.wmiDecoded && makeSelect.value !== '') {
            state.vehicle.method = 'manual';
            vinInput.style.opacity = '0.5';
        } else if (makeSelect.value === '') {
            vinInput.style.opacity = '1';
        }
    });

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
            let resultsToRender = mockResults.default;
            const makeValue = makeSelect.value.toLowerCase();
            const descValue = partDescInput.value.toLowerCase();
            const vinValue = vinInput.value.toUpperCase();

            // Check what to show
            if (descValue.includes('filtre')) {
                resultsToRender = mockResults.filter;
            } else if (makeValue === 'bmw' || vinValue.startsWith('WBA')) {
                resultsToRender = mockResults.bmw;
            } else if (makeValue === 'audi' || vinValue.startsWith('WAU')) {
                resultsToRender = mockResults.audi;
            }

            // Update title
            const resTitle = document.getElementById('res-part-name');
            const resTags = document.querySelector('.part-tags');
            if (resultsToRender.length > 0) {
                resTitle.innerText = resultsToRender[0].name;
                resTags.innerHTML = `
                    <span class="tag tag-oem">OEM: ${resultsToRender[0].oem}</span>
                    <span class="tag tag-vehicle">${makeSelect.options[makeSelect.selectedIndex]?.text ||
                    (vinValue.length >= 3 && mockWMI[vinValue.substring(0, 3)] ? mockWMI[vinValue.substring(0, 3)].make : 'Véhicule Multiple')}</span>
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
        manualVehicleFields.style.opacity = '1';
        vinInput.style.opacity = '1';
        partNumberInput.style.opacity = '1';
        partDescInput.style.opacity = '1';
        document.getElementById('part-photo-group').style.opacity = '1';
        btnRemoveImg.click();

        emptyState.classList.remove('display-none');
        resultsContent.classList.add('display-none');
        loadingState.classList.add('display-none');

        state.vehicle = { method: null, vin: null, wmiDecoded: false };
        state.part = { method: null, number: null, hasPhoto: false };
    });

});
