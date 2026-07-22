# Diagnostic — sourcing avant abstraction `SupplierProvider`

*Phase 1. Lecture seule, aucun code modifié.*

---

## 1. Cartographie du code de sourcing

### Connecteurs

| Fichier | Rôle | État |
|---|---|---|
| `services/ebay.service.ts` | `searchParts`, `getItem`, `debugSearch`, `normalizeSummary`, `extractShipping`, `generateMockEbayResults` | Fonctionnel |
| `services/aliexpress.service.ts` | `searchProducts`, `normalize` | **N'a jamais fonctionné** (intégration « best effort », signature/endpoint jamais validés) |

### Orchestration — `routes/part.routes.ts`

C'est **le point névralgique**, et le problème principal : la logique de sourcing
vit dans la couche HTTP, pas dans les connecteurs.

`POST /find` enchaîne aujourd'hui :

1. Détermination de la pièce par IA (`PartAiService`)
2. **Cascade de 5 requêtes** eBay FR (du plus précis au plus large)
3. **Fan-out multilingue** sur 3 marchés (DE/IT/ES) via `part_glossary`
4. Recherche AliExpress en parallèle
5. Fusion + déduplication par `itemId` + garde-fou devise
6. Application de la marge
7. Tarification (`pricing.quoteMany`)
8. **Couche de sortie client** : retrait des champs interdits, proxification des
   images, signature du `offerToken`

### Consommateurs

| Consommateur | Couplage aux connecteurs |
|---|---|
| `services/pricing` | **Aucun** — `quoteMany` reçoit déjà une forme neutre `{id, prixPieceEur, portVendeurEur, titre, description, categoryCode}` |
| `estimateWeight` | **Aucun** — accepte déjà `poidsVendeurKg`, `categoryCode`, `titre` |
| `routes/checkout.routes.ts` | **Aucun** — lit le coût via `offerToken` (chiffré) |
| Frontend `app.js` | Consomme la sortie de `/find` |

> **Bonne nouvelle** : le pricing est déjà découplé. L'abstraction ne le touchera pas.

---

## 2. Points de couplage à traiter

### 2.1 Le type commun vit dans le connecteur eBay

```ts
// aliexpress.service.ts, ligne 3
import { NormalizedPart } from './ebay.service';
```

AliExpress dépend d'eBay pour son format de sortie. Tout nouveau fournisseur
hériterait de cette dépendance. `SupplierItem` (Phase 2) doit vivre dans
`services/suppliers/types`, et `NormalizedPart` disparaître.

### 2.2 La logique de recherche est dans la route

Cascade, fan-out multilingue, fusion et déduplication sont dans `/find`.
Un `EbayProvider.search()` qui ne ferait qu'un appel HTTP laisserait cette
logique dans la route : l'abstraction serait cosmétique.

**Conséquence** : la Phase 3 n'est pas un simple déplacement de fichier. Il faut
faire descendre cascade + multilingue **dans** `EbayProvider`, et remonter
fusion + déduplication **dans** le `SupplierRegistry`.

### 2.3 La couche de sortie client existe déjà, mais anonyme

Le `results.map()` final de `/find` fait exactement le travail de
`toClientListing()`. Il faut l'extraire, pas le réinventer — et **le rendre
obligatoire** : aujourd'hui, rien n'empêche une future route de renvoyer un
item brut.

---

## 3. Fuites marketplace détectées

Les correctifs récents ont fermé : images (relais backend), `itemWebUrl`,
`seller`, descriptions vendeur, champs de diagnostic, routes de diagnostic
(admin), coût d'acquisition (jeton chiffré). Audit `/find` : **0 occurrence**
de `ebay`/`aliexpress`.

### 🔴 Fuite restante : `itemId` exposé côté client

```
Réponse /find  →  "itemId": "v1|198369121156|0"
DOM            →  data-id="v1|198369121156|0"  data-detail="..."
URL appelée    →  /api/parts/item/v1%7C198369121156%7C0
```

C'est un **identifiant eBay natif**. Le nombre central collé dans
`ebay.fr/itm/198369121156` ouvre l'annonce d'origine : prix d'achat réel,
vendeur, marketplace. C'est précisément la fuite visée par le point 3 de la
Phase 1.

**Correctif proposé** : `toClientListing` n'expose qu'une **référence opaque**.
Le `offerToken` (déjà chiffré AES-256-GCM) contient déjà `itemId` et
`supplierCode` — il peut servir de poignée unique pour la fiche détaillée, sans
nouveau mécanisme. Impact : contrat de `GET /parts/item/:id` à changer.

### 🟠 Point mineur

`isMock` sort vers le client (booléen sans nom de fournisseur, mais révèle un
état interne). À retirer de `toClientListing`.

---

## 4. Écarts entre le plan et le code réel

### 🔴 Le filtre « Buy It Now » n'existe pas

> Phase 3, point 3 : « Filtre systématique **déjà en vigueur** à conserver :
> Buy It Now uniquement (`buyingOptions:{FIXED_PRICE}`) »

**Il n'est pas en place.** Le seul filtre appliqué est :

```ts
filter: `deliveryCountry:${DELIVERY_COUNTRY}`   // ebay.service.ts:153
```

Les **enchères remontent donc dans les résultats**. C'est un vrai risque
métier : un prix « tout compris » ferme est annoncé au client sur une annonce
dont le prix n'est pas ferme et peut ne jamais être remportée.

L'ajouter est une **modification de comportement**, incompatible avec l'exigence
« iso-fonctionnel » de la Phase 3 → décision requise.

### 🟠 `poidsVendeurKg` n'est jamais alimenté

`estimateWeight` sait l'exploiter (source `SELLER`, confiance 1 — la meilleure),
mais aucun connecteur ne le renseigne : `normalizeSummary` ne lit pas les
`itemSpecifics`, et `getItem` récupère les `aspects` sans en extraire le poids.
Le mapping de la Phase 3 comblera ce manque — **gain direct sur la précision des
prix**.

### 🟠 Budget d'appels eBay

| | Appels par recherche |
|---|---|
| Aujourd'hui | ~9 (cascade FR jusqu'à 5 + 3 marchés étrangers) |
| Avec whitelist sur les 4 marchés | ~13 à 17 |

Aucun cache n'existe sur les recherches. À 5 000 appels/jour de quota Browse,
~17 appels/recherche plafonne à **~290 recherches/jour**.

### 🟠 AliExpress : stub neuf ou service existant ?

Créer un `AliExpressProvider` vide laisserait `aliexpress.service.ts` en
parallèle — deux chemins de code pour une source déjà en panne silencieuse.

### 🟠 Ovoko : deux fois la même annonce

Ovoko/RRR vend **sur eBay** (whitelist, Phase 4) **et** via sa propre API
(`OvokoProvider`, Phase 7). Le jour où les deux seront actifs, la même pièce
remontera deux fois. La déduplication du registry devra croiser
référence + vendeur, pas seulement `externalId`.

### 🟡 Convention de nommage

Le schéma Prisma utilise `PascalCase` pour les modèles et `camelCase` pour les
champs (`PartCategory`, `PricingSetting`). Le plan demande `supplier_sellers`.
Proposition : modèles `Supplier` / `SupplierSeller` avec
`@@map("suppliers")` / `@@map("supplier_sellers")` — conforme aux deux.

### 🟡 Vérification du vendeur Ovoko impossible d'ici

Le proxy réseau bloque l'API eBay depuis l'environnement de développement : je
ne peux pas confirmer le username `usedautocarparts`. **Un username erroné
renvoie 0 résultat sans erreur** — exactement la classe de panne silencieuse
corrigée récemment. Le compteur de résultats par vendeur dans l'admin (Phase 6)
doit rendre l'erreur visible en un clic.

---

## 5. Plan de refactoring

| Phase | Action | Risque |
|---|---|---|
| 2 | `services/suppliers/types` + `SupplierProvider` + `toClientListing` (point de sortie **unique**) | Faible |
| 3 | `EbayProvider` : descendre cascade + multilingue + mapping `itemSpecifics`→`poidsVendeurKg` | **Moyen** — cœur du parcours |
| 4 | `SupplierSeller` + stratégie `sellers:` + `whitelist_boost` + cache 10 min | Moyen (quota) |
| 5 | `SupplierRegistry` : fan-out, timeout 5 s, fusion, dédoublonnage | Moyen |
| 6 | Admin : fournisseurs, whitelist, testeur de recherche | Faible |
| 7 | Stubs + `README` + tests contractuels | Faible |
| 8 | `/find` et commande via le registry ; `supplierCode`/`externalId` sur `OrderItem` | Moyen |
| 9 | Tests + anti-fuite (grep DOM) | Faible |

`OrderItem` ne stocke aujourd'hui **ni `supplierCode` ni `externalId`** : l'opérateur
ne peut pas retrouver l'annonce source. La Phase 8 comble ce manque
(colonnes internes, jamais sérialisées).

---

## 6. Décisions attendues

| # | Question | Recommandation |
|---|---|---|
| 1 | Ajouter `buyingOptions:{FIXED_PRICE}` (les enchères remontent aujourd'hui) ? | **Oui**, en changement explicite et isolé — un prix ferme sur une enchère est intenable |
| 2 | Rendre `itemId` opaque côté client ? | **Oui**, via `offerToken` — la fuite est réelle et directement exploitable |
| 3 | Périmètre de la recherche whitelist | **FR + DE seulement** : les grosses casses européennes y sont, et le quota reste tenable |
| 4 | AliExpress | Convertir le service existant en provider **désactivé**, plutôt qu'un stub parallèle |

*Les points 1 et 2 modifient le comportement : ils ne seront pas appliqués sans accord.*
