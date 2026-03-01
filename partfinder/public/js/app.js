document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const vinInput = document.getElementById('vin');
    const partNumberInput = document.getElementById('part-number');
    const descInput = document.getElementById('description');

    const marqueInput = document.getElementById('marque');
    const modeleInput = document.getElementById('modele');
    const anneeInput = document.getElementById('annee');
    const moteurInput = document.getElementById('moteur');

    const btnDecode = document.getElementById('btn-decode-vin');
    const btnSearch = document.getElementById('btn-search');

    const cgFileInput = document.getElementById('cg-file');

    const chatInput = document.getElementById('chat-input');
    const btnChatSend = document.getElementById('btn-chat-send');
    const chatMessages = document.getElementById('chat-messages');

    const resultsGrid = document.getElementById('results-grid');
    const loader = document.getElementById('search-loader');
    const cartBadge = document.getElementById('cartBadge');

    let cartCount = 0;

    // --- Compression Image (Canvas) ---
    async function compressImage(file, maxWidth, quality) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        console.log(`Image compressée : ${Math.round(blob.size / 1024)} Ko`);
                        resolve(blob);
                    }, 'image/jpeg', quality);
                };
            };
        });
    }

    function addMessage(text, type) {
        const div = document.createElement('div');
        div.className = `message ${type}`;
        div.textContent = text;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function updateFormFields(data) {
        if (data.marque) { marqueInput.value = data.marque; marqueInput.style.color = '#10b981'; }
        if (data.modele) { modeleInput.value = data.modele; modeleInput.style.color = '#10b981'; }
        if (data.annee) { anneeInput.value = data.annee; anneeInput.style.color = '#10b981'; }
        if (data.moteur) { moteurInput.value = data.moteur; moteurInput.style.color = '#10b981'; }
        if (data.vin) { vinInput.value = data.vin; vinInput.style.borderColor = '#10b981'; }
        if (data.piece || data.partNumber) {
            if (data.partNumber) partNumberInput.value = data.partNumber;
            if (data.piece) {
                const oldDesc = descInput.value;
                descInput.value = oldDesc ? oldDesc + " " + data.piece : data.piece;
            }
        }
    }

    // --- Event Listeners ---

    // 1. Upload Carte Grise
    cgFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        addMessage("Veuillez patienter, analyse de la carte grise en cours...", "system");
        try {
            const compressedBlob = await compressImage(file, 2400, 0.88);
            const formData = new FormData();
            formData.append('image', compressedBlob, 'cg.jpg');

            const res = await fetch('/api/extract-carte-grise', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) throw new Error("Erreur serveur");
            const data = await res.json();

            updateFormFields(data);
            addMessage("Carte grise lue avec succès. J'ai prérempli les informations du véhicule.", "system");
        } catch (err) {
            console.error(err);
            addMessage("Désolé, impossible de lire la carte grise (l'API est-elle configurée ?).", "system");
        }
    });

    // 2. Chat API
    const handleChat = async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        addMessage(text, "user");
        chatInput.value = '';

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    context: {
                        marque: marqueInput.value,
                        modele: modeleInput.value,
                        annee: anneeInput.value,
                        piece: descInput.value
                    }
                })
            });

            const data = await res.json();
            updateFormFields(data);
            if (data.reponseAgent) {
                addMessage(data.reponseAgent, "system");
            } else {
                addMessage("J'ai mis à jour les champs.", "system");
            }
        } catch (err) {
            addMessage("Erreur de connexion à l'assistant.", "system");
        }
    };

    btnChatSend.addEventListener('click', handleChat);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleChat(); });

    // 3. Decode VIN
    btnDecode.addEventListener('click', async () => {
        const vin = vinInput.value.trim();
        if (vin.length < 3) {
            alert("Au moins 3 caractères requis"); return;
        }

        try {
            const res = await fetch(`/api/decode-vin/${vin}`);
            const data = await res.json();
            updateFormFields(data);
        } catch (err) {
            console.error("Erreur WMI/NHTSA");
        }
    });

    // 4. Lancer Recherche
    btnSearch.addEventListener('click', async () => {
        resultsGrid.innerHTML = '';
        loader.classList.remove('hidden');

        try {
            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    piece: descInput.value || partNumberInput.value,
                    marque: marqueInput.value,
                    modele: modeleInput.value,
                    annee: anneeInput.value
                })
            });

            const results = await res.json();
            loader.classList.add('hidden');

            if (results.length === 0) {
                resultsGrid.innerHTML = `<div class="empty-state"><p>Aucun résultat trouvé.</p></div>`;
                return;
            }

            results.forEach(item => {
                const card = document.createElement('div');
                card.className = 'result-card';
                card.innerHTML = `
                    < div class="card-img" >
                        <span class="badge ${item.etat}">${item.etat}</span>
                        <img src="${item.photos[0]}" alt="${item.nom}">
                    </div>
                    <div class="card-info">
                        <h4>${item.nom}</h4>
                        <span class="ref">${item.reference}</span>
                        <span class="price">${item.prixPublic} €</span>
                    </div>
                `;

                card.addEventListener('click', () => openModal(item));
                resultsGrid.appendChild(card);
            });

        } catch (err) {
            loader.classList.add('hidden');
            resultsGrid.innerHTML = `<div class="empty-state"><p>Erreur lors de la recherche.</p></div>`;
        }
    });

    // --- Modal Logic ---
    const modal = document.getElementById('detail-modal');
    const modalClose = document.getElementById('modal-close');
    const track = document.getElementById('carousel-track');
    const dotsContainer = document.getElementById('carousel-dots');
    let currentPhotos = [];
    let currentIndex = 0;

    function renderCarousel() {
        track.innerHTML = currentPhotos.map(p => `<img src="${p}" alt="Photo">`).join('');
        const shift = -currentIndex * 100;
        track.style.transform = `translateX(${shift}%)`;
    }

    function openModal(item) {
        document.getElementById('modal-nom').textContent = item.nom;
        document.getElementById('modal-ref').textContent = "REF: " + item.reference;
        document.getElementById('modal-desc').textContent = item.description;
        document.getElementById('modal-prix').textContent = item.prixPublic + " €";

        const etatEl = document.getElementById('modal-etat');
        etatEl.textContent = item.etat;
        etatEl.style.borderColor = item.etat === 'Neuf' ? '#10b981' : '#f97316';
        etatEl.style.color = item.etat === 'Neuf' ? '#10b981' : '#f97316';

        currentPhotos = item.photos || [];
        currentIndex = 0;
        renderCarousel();

        modal.classList.remove('hidden');
    }

    modalClose.addEventListener('click', () => modal.classList.add('hidden'));

    document.getElementById('carousel-prev').addEventListener('click', () => {
        if (currentPhotos.length <= 1) return;
        currentIndex = (currentIndex === 0) ? currentPhotos.length - 1 : currentIndex - 1;
        renderCarousel();
    });

    document.getElementById('carousel-next').addEventListener('click', () => {
        if (currentPhotos.length <= 1) return;
        currentIndex = (currentIndex === currentPhotos.length - 1) ? 0 : currentIndex + 1;
        renderCarousel();
    });

    document.getElementById('btn-add-cart').addEventListener('click', () => {
        cartCount++;
        cartBadge.textContent = `🛒 ${cartCount} demande(s)`;
        modal.classList.add('hidden');
        alert("Demande ajoutée au panier. Le back-office traitera votre demande.");
    });
});
