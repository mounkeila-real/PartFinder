# Handover Document — PartFinder Project
This document details the configuration, installation parameters, database structures, and backend/frontend details for **Claude Cowork** to take over the project.

---

## 1. Project Goal & Repository Info
PartFinder is a diagnostic and parts-ordering web dashboard for mechanics. It automates vehicle identification using VIN/License Plate API decoding, OCR scan of registration cards (Carte Grise), and a dynamic manual vehicle search with offline autocomplete caching.

* **GitHub Repository:** `https://github.com/mounkeila-real/PartFinder.git`
* **Local Workspace Directory:** `C:\Users\50177\.gemini\antigravity\scratch\PartFinder`

---

## 2. Technical Architecture & Ports
The application is split into two components:
1. **Frontend (`partfinder`):** Runs an Express server on **port 3000**. It serves static assets, simulates checkout/OCR processing, and proxies `/api` endpoints to the backend.
2. **Backend (`partfinder_backend`):** Runs a TypeScript + Express + Prisma server on **port 3001**. It handles SQL DB relations (SQLite) and fetches remote APIs (Vincario, NHTSA vPIC).

```
[Web Browser]  --> (Port 3000) --> [Frontend: Express Server]
                                          |
                                    (Proxy /api)
                                          v
[SQLite dev.db] <-- (Prisma) <--- [Backend: TS Express Server]
                                          |
                                  +-------+-------+
                                  |               |
                                  v               v
                           [Vincario API]  [NHTSA vPIC API]
```

---

## 3. Local Installation & Environment Variables
A local Node.js environment has been used (`node-v20.18.0-win-x64`).

### Frontend Configuration (`partfinder/.env`)
```ini
GEMINI_API_KEY="<VOTRE_CLE_GEMINI>"
ANTHROPIC_API_KEY="<VOTRE_CLE_ANTHROPIC>"
PORT=3000
BACKEND_URL=http://localhost:3001
```

### Backend Configuration (`partfinder_backend/.env`)
```ini
DATABASE_URL="file:./dev.db"
PORT=3001
GEMINI_API_KEY="<VOTRE_CLE_GEMINI>"
ANTHROPIC_API_KEY="<VOTRE_CLE_ANTHROPIC>"
RAILWAY_TOKEN="<VOTRE_TOKEN_RAILWAY>"
VINCARIO_API_KEY="<VOTRE_CLE_VINCARIO>"
VINCARIO_SECRET_KEY="<VOTRE_SECRET_VINCARIO>"
```

---

## 4. SQLite Database & Seeding
The database uses Prisma ORM on a local SQLite file: `partfinder_backend/prisma/dev.db`.

### Database Schema Highlights:
* **`VehicleMake`**: Holds car brands. We successfully pre-seeded **10,986 passenger car makes** directly from the official NHTSA vPIC dataset to provide a comprehensive offline dropdown.
* **`VehicleModel`**: Holds model variants associated with a Make.
* **`VehicleModelYear`**: Relation bridging model to model year constraints.
* **`Vehicle`**: Key-value table caching VIN decodes and complete specs (JSON).
* **`Order` / `OrderItem`**: Stores checkout records.

### Seeding Scripts:
Located in `partfinder_backend/scripts/`:
* `seed_makes_nhtsa.ts`: Seeds the makes autocomplete index from NHTSA.
* `seed_vehicles.ts`: Pre-seeds dummy vehicle profiles.
* `seed_vin_cache.ts`: Pre-caches default vehicle specs for test VIN `WDD2462421N227311`.

---

## 5. Completed Workflows & Implementation
1. **VIN & License Plate Decoding:**
   * Handled by `/api/decode-vin/:vin` and `/api/vehicle/plate/:plate` routes.
   * If a VIN is resolved, the client form fields are populated and automatically set to **disabled / read-only** to ensure integrity. A **"Plus d'infos"** button appears, opening the vehicle's spec sheet in a new tab.
   * If the VIN is missing or invalid, manual entry inputs remain enabled.
2. **Carte Grise OCR Image Scan:**
   * Handled using Gemini API (`gemini-1.5-flash`) by sending base64 image data of the registration card.
   * Auto-extracts fields (VIN, Make, Model, Year, Engine) and synchronizes them to the vehicle form state.
3. **Dynamic Autocomplete & Offline NHTSA Sync:**
   * The "Marque" field is a searchable datalist.
   * If the brand is new (e.g., `Dodge`), the backend automatically makes a one-time API query to the NHTSA vPIC API to fetch and cache all model relations in the SQLite DB under transaction blocks, immediately reloading the datalist options.
4. **Forms Reset ("Réinitialiser"):**
   * Clears all inputs and resets disabling attributes, setting opacity to `1`.

---

## 6. How to Start the App Locally
Run these commands in separate terminal shells to launch the environment:

* **Frontend:**
  ```powershell
  cd partfinder
  $env:PATH = "C:\Users\50177\.gemini\antigravity\scratch\node-v20.18.0-win-x64;" + $env:PATH
  npm run dev
  ```
  *(Launches frontend at http://localhost:3000)*

* **Backend:**
  ```powershell
  cd partfinder_backend
  $env:PATH = "C:\Users\50177\.gemini\antigravity\scratch\node-v20.18.0-win-x64;" + $env:PATH
  npm run dev
  ```
  *(Launches backend api at http://localhost:3001)*

---

## 7. B2B Authentication & Password Reset Flow (Phase 4)
We have implemented the forgot and reset password mechanisms for B2B users using the **Resend** transactional email API.

### Technical Implementation:
* **Prisma schema update:** Added `resetToken` and `resetTokenExpiry` to the `User` model.
* **Email Service (`email.service.ts`):** Sends styled, professional HTML emails containing the recovery URL.
  * *Local Debugging:* If `RESEND_API_KEY` is not defined in `.env`, the service will output the reset link directly in the console backend logs instead of crashing, allowing full local verification.
  * *Dynamic Frontend URL Resolution:* The base URL for the password recovery link is dynamically extracted from request headers (`Referer` or `Origin`). This guarantees that it correctly points back to whichever host the B2B user is accessing the app from (e.g. `http://localhost:3000` locally, or `https://partfinder-production-xxxx.up.railway.app` on Railway) without needing hardcoded domain environment variables.
* **Backend API routes (`auth.routes.ts`):**
  * `POST /api/auth/forgot-password`: Normalized email check, cryptographically secure 32-byte hex token generation, 1-hour expiration timestamping, and dispatch of the Resend transactional recovery email.
  * `POST /api/auth/reset-password`: Validates the token against current expiration date/time, updates the hashed password, and clears recovery token fields.
* **Frontend UI integrations (`index.html` & `auth.js`):**
  * Added "Mot de passe oublié ?" trigger link in the B2B Login form.
  * Created dynamic forms in the B2B authentication modal overlay for requesting the recovery link and submitting the new password.
  * Built URL search parameter checker (`resetToken`) that triggers on DOM ready, automatically showing the modal overlay on the password reset panel.

### Testing and Verification:
* An integration test script is available at `partfinder_backend/src/test_reset_flow.ts`.
* Run the test via:
  ```powershell
  npx ts-node src/test_reset_flow.ts
  ```

