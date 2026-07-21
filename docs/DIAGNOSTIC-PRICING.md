# Diagnostic pré-intégration — Module Pricing / Réception / Réexpédition

Date : 2026-07-19 · Périmètre : Phases 0→8 du prompt « Pricing tout compris, Réception/Réexpédition, Appel de fonds, Cookies & CGV »

---

## 1. État des lieux technique

### Arborescence & frameworks

| Élément | Réalité constatée |
|---|---|
| Monorepo | `partfinder/` (frontend) + `partfinder_backend/` (API) |
| Backend | **Node + TypeScript + Express 5** |
| ORM | **Prisma 5.22** (pas de SQL brut) |
| Base | **PostgreSQL** (Railway) |
| Frontend | **Vanilla JS + Express statique** — pas de framework SPA |
| CSS | **CSS custom** (`public/css/style.css`, variables CSS). Tailwind v3 présent mais **quasi inutilisé** |
| Tests | **AUCUN** (`"test": "echo Error: no test specified && exit 1"`) |
| Jobs/cron | **AUCUN** planificateur |
| Déploiement | Railway — 2 services + Postgres |

### Migrations — incohérence à corriger

Le dossier `prisma/migrations/20260001000000_init` existe, **mais le script de build utilise `prisma db push`** (non versionné) :

```
"build": "tsc && npx prisma generate && npx prisma db push && ..."
```

➡️ **Recommandation** : basculer sur `prisma migrate deploy` pour obtenir de vraies migrations versionnées (exigence du prompt : « crée les migrations »).

### Tables existantes (10 modèles Prisma)

`WmiCode`, `PartCatalog`, `User`, `SavedVehicle`, `Order`, `OrderItem`, `VehicleMake`, `VehicleModelYear`, `VehicleModel`, `Vehicle`

- **`User`** : email, passwordHash, companyName (obligatoire), contactName, phone, vatNumber, role (CUSTOMER|ADMIN), status, resetToken/resetTokenExpiry
- **`Order`** : status, totalAmount, contactInfo, userId, shippingAddress (**texte libre**), poReference, paymentStatus, stripeSessionId
- **`OrderItem`** : partOem, partName, quantity, priceSold
- ❌ **Aucune table d'adresses structurée**, aucune notion de zone/territoire
- ❌ Aucune des 8 tables demandées en Phase 1 n'existe

### Types monétaires — non conforme

Tous les montants sont en **`Float`** : `Order.totalAmount`, `OrderItem.priceSold`, `PartCatalog.basePrice`.
Le prompt impose **`numeric`** (Prisma `Decimal`). ⚠️ Migration de champs existants sur une base avec commandes réelles (dont un paiement Stripe validé) → à traiter avec précaution.

### Flux de commande actuel

1. Recherche → `POST /api/parts/find` : l'IA détermine la pièce, puis cascade de requêtes eBay + AliExpress en parallèle
2. **Prix** : calculé dans `part.routes.ts` — `MARGIN_MULTIPLIER` (env `PART_MARGIN_MULTIPLIER`, défaut **1.33**) appliqué au prix marketplace. **C'est tout** : aucun port, aucun frais de traitement
3. Panier (mémoire navigateur) → checkout
4. **Paiement : Stripe Checkout** (`POST /api/checkout/session` + webhook `/api/checkout/webhook`) — opérationnel et testé
5. Statuts commande : `PENDING`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED` · paiement : `UNPAID`, `PAID`, `FAILED`

### Interface admin existante

- **Backend** : `/api/admin/*` protégé par `requireAdmin` (JWT, `role=ADMIN`) — users, orders, statuts, reset password, suspension, suppression RGPD
- **Frontend** : `admin.js` = **une modale** à 2 onglets (Clients / Commandes) dans la page unique
- ⚠️ Une modale est **insuffisante** pour les écrans Tarification / Réception / Expéditions des phases 4-6

### Récupération marketplace

- `ebay.service.ts` → Browse API `item_summary/search` + `getItem` (limité aux 3 premiers, pour maîtriser le quota)
- `aliexpress.service.ts` → Affiliate API (non fonctionnelle : profil dev non approuvé)
- **Champs capturés** : itemId, title, price, currency, image, condition, itemWebUrl, seller, shortDescription, fullDescription
- ❌ **NON capturés** : **frais de port vendeur** (`shippingOptions[].shippingCost`) et **itemSpecifics** (dont le poids)

---

## 2. Points de friction — à trancher avant de coder

### 🔴 A. Contradiction majeure : visibilité des marketplaces

Le prompt exige : *« Aucune mention d'eBay/AliExpress ne doit JAMAIS apparaître côté client »*.

Or **tout le parcours client actuel est construit autour de l'affichage des annonces marketplace** :
- Pastilles de source « eBay » / « AliExpress » sur chaque carte de résultat
- Bouton « Voir la fiche » ouvrant l'annonce eBay (`itemWebUrl`) en externe
- Messages d'erreur nommant eBay (« Aucune offre eBay trouvée… »)
- Les résultats **sont** des annonces marketplace (titre vendeur, photo vendeur, état, vendeur)

➡️ Ce n'est pas un ajustement cosmétique mais un **renversement du produit côté client**. Il faut décider :
- Supprimer pastilles, liens externes et vocabulaire marketplace
- Repenser « résultats » : offres PartFinder avec **un seul prix tout compris**, sans lien sortant
- Que faire du **titre et des photos** issus du vendeur (les garder mais neutraliser ? les reformuler par IA ?)

### 🔴 B. Port vendeur non capturé — prérequis bloquant du pricing

La formule de prix exige `port vendeur→Sarralbe`, aujourd'hui **inexistant**.
De plus, eBay renvoie fréquemment un port **`CALCULATED`** (dépendant de l'adresse) plutôt qu'un montant ferme sur l'international.
➡️ Impact direct sur le régime FERME/ESTIMÉ : sans port ferme, beaucoup de commandes basculeront en ESTIMÉ. À anticiper.
*(Une modification locale non commitée amorce déjà l'ajout de `shippingCost`/`shippingType`.)*

### 🟠 C. Pas de table d'adresses

La zone Colissimo (OM1/OM2) pilote le prix, mais l'adresse est un **texte libre** sur `Order`.
La Phase 1 mentionne `adresse_livraison_id (FK)` → **table absente du périmètre du prompt**.
➡️ Il faut créer `addresses` (destinataire, rue, CP, ville, territoire → mapping zone) + rattachement `User`.

### 🟠 D. Float → numeric sur données existantes

Migrer `Order.totalAmount` / `OrderItem.priceSold` de `Float` vers `Decimal` sur une base contenant de vraies commandes.
➡️ Deux options : (1) migrer tout (propre, risque maîtrisable car volume faible), (2) `Decimal` sur les nouveaux champs seulement (incohérent). **Recommandation : option 1**, volume actuel très faible.

### 🟠 E. Aucun outil de test

La Phase 2 impose des tests unitaires. ➡️ Ajouter **Vitest** (léger, natif TS) ou Jest + ts-jest.

### 🟠 F. Aucun planificateur

Phase 5.6 (facturation stockage quotidienne). ➡️ `node-cron` dans le process backend, ou un **Railway Cron** séparé.

### 🟡 G. Admin = modale, pas un back-office

➡️ Créer une vraie page `/admin` (ou un mode plein écran) pour Tarification / Réception / Expéditions.

### 🟡 H. « Tailwind mobile-first » vs réalité CSS

Le style du projet est du **CSS custom** avec variables ; Tailwind n'est pas réellement exploité.
➡️ **Recommandation** : suivre les conventions CSS existantes (cohérence visuelle) plutôt qu'introduire des classes Tailwind non compilées. Mobile-first respecté quoi qu'il arrive.

### 🟡 I. Comptes B2B vs clients outre-mer

L'inscription **exige une raison sociale** (compte pro). Le nouveau modèle vise des clients outre-mer, potentiellement **particuliers**.
➡️ Décider : rester B2B strict, ou rendre `companyName` optionnel et gérer les deux profils (impacte aussi TVA/octroi de mer et le droit de rétractation, qui ne s'applique qu'aux consommateurs).

### 🟡 J. Anthropic

`@anthropic-ai/sdk` **non installé** côté backend (le projet utilise Gemini côté frontend). ✅ Bonne nouvelle : `ANTHROPIC_API_KEY` est **déjà présent** dans les variables Railway du backend.

### ⚖️ K. Réserves juridiques (Phase 8)

- Je peux rédiger des clauses **standard et prudentes**, mais **je ne suis pas juriste** : garantie légale, rétractation, clauses douanières et responsabilité transporteur **doivent être relues par un professionnel** avant mise en ligne.
- **« Société en cours d'immatriculation »** : vendre à des consommateurs sans immatriculation ni mentions légales complètes expose à un risque réel. À sécuriser avant ouverture commerciale.

---

## 3. Plan d'intégration proposé (adapté à l'existant)

| Phase | Adaptation retenue |
|---|---|
| 1 — Schéma | Modèles **Prisma** (pas de SQL brut) + passage à `prisma migrate`. **+ table `addresses`** (manquante au prompt). Montants en `Decimal`. |
| 2 — Pricing | `src/services/pricing/` en fonctions pures + **Vitest**. Remplace `MARGIN_MULTIPLIER` dans `part.routes.ts`. |
| 3 — IA | `@anthropic-ai/sdk`, modèle Haiku, cache `ai_classifications`, timeout 5 s, fallback ESTIMÉ. |
| 4 — Admin tarif | Nouvelle page `/admin` + routes `/api/admin/pricing/*`. |
| 5 — Réception | Écran mobile-first opérateur ; `node-cron` pour le stockage. |
| 6 — Expéditions | Interface `LabelProvider` + `ManualLabelProvider` (CN23 imprimable). |
| 7 — Appels de fonds | **Stripe déjà en place** → `PaymentProvider` avec `StripePaymentProvider` (pas besoin du provider manuel). |
| 8 — Légal | Bandeau cookies + `/cgv` + `/confidentialite`, clauses marquées `TODO: relecture juridique`. |

**Ordre conseillé** : B (port vendeur) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, avec **A (dé-marketplacisation)** traité juste après validation, car il conditionne tout l'affichage client.

---

## 4. Ce que j'attends comme validation

1. **A** — Confirmer la dé-marketplacisation complète du parcours client (et le sort des titres/photos vendeur).
2. **D** — Migrer les montants existants `Float`→`Decimal` (recommandé) ?
3. **I** — Clients : B2B uniquement, ou ouvrir aux particuliers ?
4. **C** — Créer la table `addresses` (hors périmètre initial du prompt) : validé ?
5. Confirmer `prisma migrate`, **Vitest**, `node-cron`, page `/admin` dédiée.

⚠️ **Volumétrie** : ces 8 phases représentent un chantier très supérieur à une session. Livraison phase par phase, avec vérification que l'app démarre et que les parcours existants fonctionnent avant chaque commit.
