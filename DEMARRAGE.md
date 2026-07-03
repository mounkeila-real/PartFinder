# Démarrage local de PartFinder (Windows)

Guide pour lancer l'application sur ta machine. L'app a deux parties :

- **Frontend** (`partfinder`) — serveur Express, port **3000** (interface web).
- **Backend** (`partfinder_backend`) — TypeScript + Express + Prisma + SQLite, port **3001** (décodage VIN, base de données).

Le frontend redirige (`proxy`) les appels `/api` vers le backend. Il faut donc lancer **les deux**.

---

## Prérequis

- **Node.js 20+** (Node 20.18.0 a été utilisé pour ce projet ; Node 22 fonctionne aussi).
- Vérifier : ouvre PowerShell et tape `node --version`.

---

## 1. Clés API (optionnel mais recommandé)

Les fichiers `.env` sont déjà créés avec des valeurs vides. Le décodage VIN via NHTSA (gratuit) fonctionne **sans clé**. Les fonctions suivantes nécessitent des clés :

- **OCR de la carte grise + chat assistant** → `GEMINI_API_KEY` (Google Gemini).
- **Décodage VIN premium** → `VINCARIO_API_KEY` + `VINCARIO_SECRET_KEY`.

Pour les activer, ouvre `partfinder\.env` et `partfinder_backend\.env` et colle tes clés entre les guillemets.

---

## 2. Lancer le BACKEND (première fenêtre PowerShell)

```powershell
cd partfinder_backend
npm install
npx prisma generate      # génère le client Prisma
npx prisma db push       # crée la base SQLite (dev.db)

# Remplir la base (autocomplétion des marques + véhicules de test) :
npx ts-node scripts/seed_makes_nhtsa.ts    # ~10 986 marques depuis NHTSA
npx ts-node scripts/seed_vehicles.ts       # véhicules fictifs
npx ts-node scripts/seed_vin_cache.ts      # VIN de test WDD2462421N227311

# Démarrer :
npm run dev
```

Le backend écoute sur **http://localhost:3001**. Test rapide : ouvre http://localhost:3001/health → tu dois voir `{"status":"OK", ...}`.

> Le `npm run build` fait tout d'un coup (tsc + prisma generate + db push + seed). `npm run dev` relance automatiquement à chaque modification.

---

## 3. Lancer le FRONTEND (deuxième fenêtre PowerShell)

```powershell
cd partfinder
npm install
npm run dev
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

---

## 4. Vérifier que tout marche

- http://localhost:3000 → l'interface se charge.
- Test décodage VIN (backend) : http://localhost:3001/api/vehicle/vin/WDD2462421N227311
- Saisir une marque dans le champ « Marque » → l'autocomplétion se remplit depuis la base.

---

## Notes / dépannage

- **Erreur de téléchargement Prisma** : Prisma télécharge un moteur au premier `prisma generate`. Il faut une connexion Internet non filtrée. En cas de blocage réseau, réessaie depuis un réseau standard.
- **Port déjà utilisé** : change `PORT` dans le `.env` concerné, ou ferme le processus qui occupe 3000/3001.
- **`ts-node` introuvable** : lance `npm install` dans `partfinder_backend` d'abord (il est dans les dépendances).
- Les dossiers `node_modules/`, `dev.db` et les `.env` ne sont pas versionnés (voir `.gitignore`).
```
