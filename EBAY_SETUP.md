# PartFinder — Intégration eBay + IA (mise en route)

Ce document décrit ce qui a été ajouté pour la recherche de pièces (détermination par IA + annonces eBay) et comment le mettre en service.

## Ce qui a été ajouté

**Backend (`partfinder_backend`)**
- `src/services/ebay.service.ts` — réécrit : vraie **Browse API eBay** (fini le mock).
  - Piloté par `EBAY_ENV` (`sandbox` / `production`), token OAuth mis en cache, marché `EBAY_FR`.
  - Résultats normalisés : `itemId`, `title`, `price`, `currency`, `image`, `condition`, `itemWebUrl`, `shortDescription`, et **description complète** (`getItem`) pour les 3 premiers.
  - Repli mock automatique si les clés manquent ou si l'API échoue (résultats marqués `isMock`).
- `src/services/part_ai.service.ts` — **nouveau** : détermine la pièce via Anthropic à partir du véhicule + demande client, et construit une **requête eBay optimisée** (type de pièce + position + marque/modèle + motorisation + OEM). Repli heuristique si `ANTHROPIC_API_KEY` absente.
- `src/routes/part.routes.ts` — nouvelles routes :
  - `POST /api/parts/determine` — `{ vehicle, request }` → pièce déterminée.
  - `POST /api/parts/search` — `{ query, limit }` → annonces eBay normalisées.
  - `POST /api/parts/find` — `{ vehicle, request, limit }` → **flux complet** : IA + eBay + prix final (marge).

**Frontend (`partfinder`)**
- `public/js/app.js` — le formulaire appelle désormais `/api/parts/find` avec le contexte véhicule (VIN prioritaire) et la demande, affiche le nom de pièce déterminé par l'IA, et rend image + prix TTC + **description complète** + lien « Voir la fiche ».
- `public/css/style.css` — styles pour la description, les actions et le badge « DÉMO ».

## Variables d'environnement

Local : déjà écrites dans `partfinder_backend/.env` (gitignoré). Actuellement `EBAY_ENV="sandbox"`.

À définir aussi dans **Railway** (service backend) :

| Variable | Valeur |
|---|---|
| `EBAY_ENV` | `sandbox` (tests) puis `production` (vraies annonces) |
| `EBAY_APP_ID` | ton eBay Client ID |
| `EBAY_CERT_ID` | ton eBay Client Secret (Cert ID) |
| `EBAY_MARKETPLACE_ID` | `EBAY_FR` |
| `EBAY_CATEGORY_ID` | `6030` |
| `ANTHROPIC_API_KEY` | ta clé Anthropic |
| `ANTHROPIC_MODEL` | `claude-3-5-sonnet-latest` (optionnel) |
| `PART_MARGIN_MULTIPLIER` | `1.33` (+33 %) |

## Important — Sandbox vs Production

Les clés fournies sont **Sandbox** (`SBX-...`). Le Sandbox eBay renvoie très peu / pas d'annonces réelles : utile pour valider l'intégration, mais pour de vraies images/prix/descriptions il faut des **clés Production** (créer un keyset Production sur developer.ebay.com, puis passer `EBAY_ENV="production"`).

## Conformité eBay — Marketplace Account Deletion (requis pour la Production)

eBay n'active un keyset **Production** que si tu reçois les notifications de suppression de compte (ou si tu es exempté). L'endpoint est déjà codé :

- Route : `GET`/`POST` `…/api/ebay/marketplace-deletion` (`src/routes/ebay_notifications.routes.ts`).
- Le `GET` répond au challenge : `SHA256(challenge_code + verification_token + endpoint)`.
- Le `POST` accuse réception (200). PartFinder ne stocke pas de données d'utilisateurs eBay.

**Valeurs à utiliser** (déjà dans `.env` local ; à recopier dans Railway) :

| Champ | Valeur |
|---|---|
| Endpoint (URL HTTPS) | `https://partfinder-backend-production-c0af.up.railway.app/api/ebay/marketplace-deletion` |
| Verification token | `2745becf6bcc9f64e6ca2000c0750ac9412d8ef1746f259fe1358da8c40e` |
| `EBAY_DELETION_ENDPOINT` (env) | la même URL que l'endpoint ci-dessus |
| `EBAY_VERIFICATION_TOKEN` (env) | le même token ci-dessus |

> L'URL de l'endpoint et `EBAY_DELETION_ENDPOINT` doivent être **strictement identiques** (le hash en dépend).

**Ordre des opérations :**
1. Mettre les variables Production dans Railway (`EBAY_ENV=production`, `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT`, `ANTHROPIC_API_KEY`).
2. **Commit + push** → attendre que Railway ait redéployé (l'endpoint doit être en ligne).
3. Vérifier : ouvrir dans un navigateur
   `https://partfinder-backend-production-c0af.up.railway.app/api/ebay/marketplace-deletion?challenge_code=test`
   → doit renvoyer `{"challengeResponse":"…"}`.
4. Dans le formulaire eBay (onglet **Alerts & Notifications**, option **Marketplace Account Deletion**) : coller l'URL + le verification token, puis **Save**. eBay appelle le challenge en direct → validation.

> Clés Production fournies : App ID `mounkeil-Partfind-PRD-e0abf6ded-51eb8e30`. Le `.env` local est déjà en `EBAY_ENV="production"`.

## Sécurité

Toutes les clés collées dans le chat sont exposées : **à régénérer** (surtout GitHub et Anthropic). Ne jamais committer de `.env` (déjà gitignoré).

## Commit & déploiement (depuis ta machine)

Le sandbox Cowork ne peut pas committer de façon fiable (cache de fichiers). Depuis ta machine, dans le dossier du repo :

```bash
git add partfinder_backend/src partfinder_backend/.env.example \
        partfinder/public EBAY_SETUP.md
git commit -m "feat: recherche de pièces par IA + intégration eBay Browse API"
git push
```

Railway redéploiera automatiquement. Vérifie ensuite `https://<backend>/health` puis teste la recherche depuis l'interface.

## Test rapide en local

```bash
# backend
cd partfinder_backend && npm install && npm run dev   # :3001
# frontend (autre terminal)
cd partfinder && npm install && npm run dev            # :3000
```

Test direct de l'API :
```bash
curl -X POST http://localhost:3001/api/parts/find \
  -H "Content-Type: application/json" \
  -d '{"vehicle":{"make":"Renault","model":"Clio IV","engine":"1.5 dCi"},"request":{"description":"plaquettes de frein avant"}}'
```
