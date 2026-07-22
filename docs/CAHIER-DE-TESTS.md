# PartFinder — Cahier de tests

> **Rien de ce qui suit n'a été validé en conditions réelles.** L'environnement
> de développement n'a accès ni à Stripe ni à Railway : tous les parcours
> impliquant un paiement, un email ou une expédition sont **non testés**.
> Ce cahier existe pour que tu combles cet écart.

| | |
|---|---|
| **Version** | 1.0 — juillet 2026 |
| **Portée** | Phases 0 à 8 + correctifs sécurité/démarketisation |
| **Front** | https://partfinder-production.up.railway.app |
| **Back** | https://partfinder-backend-production-c0af.up.railway.app |

---

## Comment utiliser ce cahier

Chaque test porte un identifiant, une **priorité** et un résultat attendu.

- **P1** — bloquant : à repasser avant chaque mise en production.
- **P2** — important : à repasser après toute modification du domaine concerné.
- **P3** — confort : à vérifier périodiquement.

Note le résultat (`OK` / `KO` + observation). Un test **P1 en KO interdit la
mise en production**.

### Avant de commencer

| Prérequis | Détail |
|---|---|
| Compte client | Un compte non-admin, pour les parcours client |
| Compte admin | `mounkeila.drabo@gmail.com` (rôle ADMIN) |
| Stripe | **Mode test** pour TOUS les tests de paiement. Carte `4242 4242 4242 4242`, date future, CVC quelconque |
| Téléphone | Les écrans entrepôt sont conçus pour un usage mobile |
| Navigateur | Un onglet privé pour les tests de non-connexion |

> ⚠️ **Ne teste jamais les paiements en mode live.** Les appels de fonds
> déclenchent de vrais débits et de vrais emails clients.

### Test de fumée (5 minutes)

À passer après **chaque** déploiement, avant tout le reste :
`REC-01` · `REC-05` · `CPT-01` · `CMD-01` · `ADM-01` · `SEC-01`

---

## 1. Recherche de pièces

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| REC-01 | **P1** | Recherche par modèle | Choisir marque + modèle, saisir « plaquettes de frein avant », lancer | Des résultats s'affichent avec **photo, titre, prix** |
| REC-02 | **P1** | Les images s'affichent | Observer les cartes de résultats | **Aucune image cassée.** Les vignettes se chargent depuis notre domaine (voir SEC-02) |
| REC-03 | P2 | Repli visuel | Chercher une pièce rare | Les annonces sans photo affichent un **pictogramme d'engrenage**, jamais une image cassée |
| REC-04 | **P1** | Recherche par VIN | Onglet VIN, saisir un VIN valide | Le véhicule est identifié, le focus passe à la recherche de pièce |
| REC-05 | **P1** | Multilingue | Chercher « plaquettes de frein avant » sur une BMW | Des annonces **allemandes** apparaissent (titres type `BREMSBELÄGE … VORNE FÜR BMW`) |
| REC-06 | P2 | Volume | Compter les résultats | Nettement plus que le marché français seul (~4× observé) |
| REC-07 | P2 | Recherche par référence OEM | Saisir une référence OEM seule | Résultats de plusieurs pays (l'OEM est universel) |
| REC-08 | P2 | Terme hors glossaire | Chercher une pièce exotique non listée | Résultats français uniquement, **sans erreur** |
| REC-09 | P3 | Carte grise | Photographier une carte grise | Les champs se remplissent (OCR Tesseract) |
| REC-10 | P2 | Photo de pièce | Envoyer une photo de pièce | La description se remplit et **reste modifiable** |
| REC-11 | P3 | Tri | Utiliser le sélecteur de tri | Réordonnancement immédiat, **sans appel réseau** |
| REC-12 | P2 | Livraison France | Ouvrir plusieurs annonces étrangères | Toutes annoncent une livraison possible en France |

---

## 2. Affichage des prix

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| PRX-01 | **P1** | Prix tout compris | Résultat dont le poids est connu | **Un seul prix**, sans mention de frais additionnels |
| PRX-02 | **P1** | Prix hors port | Résultat dont le port est inconnu | « XX € **+ frais de port** » avec un bouton `?` |
| PRX-03 | **P1** | Explication | Cliquer sur `?` | Modale expliquant le calcul, **avec la grille Colissimo** |
| PRX-04 | P2 | Changement de zone | Basculer OM1 → OM2 dans la modale | Les prix se recalculent, le choix est **mémorisé** |
| PRX-05 | **P1** | Aucune marge visible | Inspecter la réponse réseau de `/find` | **Aucun** champ de marge, prix d'achat ou coût source |
| PRX-06 | P2 | Cohérence panier | Ajouter au panier | Le prix du panier est **identique** à celui de la carte |

---

## 3. Compte et authentification

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| CPT-01 | **P1** | Inscription | Créer un compte | Connexion automatique, compte visible en admin |
| CPT-02 | **P1** | Connexion | Se déconnecter puis se reconnecter | Accès rétabli |
| CPT-03 | **P1** | Recherche sans compte | Onglet privé, faire une recherche | La recherche **fonctionne sans compte** |
| CPT-04 | **P1** | Panier protégé | Sans compte, ajouter au panier | Invitation à se connecter |
| CPT-05 | **P1** | Mot de passe oublié | Demander une réinitialisation | Email reçu, nouveau mot de passe accepté |
| CPT-06 | P2 | Lien expiré | Réutiliser un lien de réinitialisation | Refus explicite |
| CPT-07 | P2 | Garage | Enregistrer un véhicule | Réapparaît après reconnexion |
| CPT-08 | P2 | Suppression RGPD | Supprimer le compte | Compte supprimé, commandes **anonymisées** (pas effacées) |

---

## 4. Commande et paiement

> Stripe en **mode test** obligatoire.

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| CMD-00 | **P1** | Zone tarifaire correcte | Commander avec une adresse en **Nouvelle-Calédonie** (CP `98800`), puis vérifier le port calculé à la pesée | Zone **OM2** appliquée. Une zone OM1 sur une adresse Pacifique = **vente à perte** |
| CMD-0a | **P1** | Détection du territoire | Saisir le code postal `97400` | Territoire « La Réunion » sélectionné **automatiquement**, mention « zone OM1 » |
| CMD-0b | **P1** | Incohérence bloquée | Saisir CP `97400` puis forcer le territoire « Nouvelle-Calédonie » | **Refusé** avec un message explicite |
| CMD-0c | P2 | Téléphone obligatoire | Envoyer sans téléphone | **Refusé** (le transporteur en a besoin outre-mer) |
| CMD-0d | P2 | Adresse réutilisée | Passer une 2ᵉ commande | L'adresse précédente est **proposée pré-remplie** |
| CMD-01 | **P1** | Demande de commande | Panier → adresse → **cocher les CGV** → envoyer | Commande créée en `PENDING_VALIDATION`, **aucun débit** |
| CMD-02 | **P1** | CGV obligatoires | Envoyer sans cocher | Envoi **bloqué** |
| CMD-03 | **P1** | Validation opérateur | Admin → Commandes → ajuster le prix → envoyer la demande de paiement | Statut `AWAITING_PAYMENT`, email au client |
| CMD-04 | **P1** | Paiement | Côté client, « Régler » → carte de test | Redirection Stripe, puis retour au site |
| CMD-05 | **P1** | Webhook | Après paiement, recharger l'espace client | Statut `CONFIRMED` **automatiquement** (sans action manuelle) |
| CMD-06 | **P1** | Abandon | Lancer un paiement puis annuler | Commande **inchangée**, aucun débit |
| CMD-07 | P2 | Coût d'acquisition | Admin, ouvrir la commande | Le coût d'acquisition est affiché à l'opérateur |
| CMD-08 | **P1** | Coût non falsifiable | Voir SEC-04 | — |

---

## 5. Entrepôt (mobile)

> À faire **depuis un téléphone**, c'est l'usage réel.

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| ENT-01 | **P1** | Pré-annonce | Admin → Entrepôt → annoncer un colis | Colis en `EXPECTED` |
| ENT-02 | **P1** | Réception | Saisir le numéro de suivi | Rapproché du client, statut `RECEIVED` |
| ENT-03 | P2 | Colis non annoncé | Réceptionner un suivi inconnu | Sélection du client obligatoire, supplément 5 € |
| ENT-04 | **P1** | Pesée | Saisir poids + dimensions + **photo** | Statut `WEIGHED` |
| ENT-05 | **P1** | Photo obligatoire | Peser **sans** photo | **Refusé côté serveur** (pas seulement dans le navigateur) |
| ENT-06 | **P1** | Écart faible | Peser à ~10 % de l'estimation | Absorbé, passage en `READY_TO_SHIP` |
| ENT-07 | **P1** | Écart important | Peser au double de l'estimation | **Appel de fonds** créé + email client, commande bloquée |
| ENT-08 | P2 | Hors gabarit | Saisir L+l+h > 200 cm | Passage en `ISSUE`, expédition refusée |
| ENT-09 | P2 | Supplément gabarit | Saisir L+l+h entre 150 et 200 cm | Supplément de 6 € appliqué |
| ENT-10 | P2 | Consolidation | Regrouper 2 colis du même client | Poids = somme **+ 5 %**, forfait 15 € |
| ENT-11 | P2 | Consolidation impossible | Regrouper des colis de clients différents | **Refusé** |
| ENT-12 | P3 | Stockage | Colis reçu depuis plus de 15 jours | Facturation de 1 €/jour au-delà de la franchise |

---

## 6. Expédition

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| EXP-01 | **P1** | File d'attente | Admin → Expéditions | Les colis prêts apparaissent |
| EXP-02 | **P1** | Blocage si impayé | Créer une expédition pour un client avec appel de fonds en attente | **Refusé**, motif affiché |
| EXP-03 | **P1** | CN23 | Préparer la déclaration | Expéditeur, destinataire, désignation **neutre**, code SH `8708.99`, mention octroi de mer |
| EXP-04 | P2 | Impression | Cliquer sur Imprimer | **Seule la CN23** s'imprime, pas l'interface |
| EXP-05 | **P1** | Expédition | Saisir le numéro de suivi | Statut `SHIPPED`, colis et commande mis à jour |
| EXP-06 | **P1** | Notification | Vérifier la boîte du client | Email avec **lien de suivi La Poste** |
| EXP-07 | **P1** | Suivi client | Espace client → Mes colis | Étapes Reçu / Contrôlé / Expédié + **photos** du colis |
| EXP-08 | **P1** | Suivi entrant masqué | Inspecter la réponse de `/orders/my-parcels` | **Aucun** numéro de suivi fournisseur (il révélerait la source) |

---

## 7. Appels de fonds

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| APF-01 | **P1** | Visibilité | Espace client → Paiements | Badge orange avec le nombre en attente |
| APF-02 | **P1** | Justificatif | Ouvrir l'appel de fonds | Motif chiffré + **photos de la pesée** |
| APF-03 | **P1** | Paiement | « Régler » → carte de test | Redirection Stripe puis paiement accepté |
| APF-04 | **P1** | Déblocage | Après paiement, recharger l'admin | Commande **repassée en `READY_TO_SHIP` automatiquement** |
| APF-05 | **P1** | Contestation | « Contester ce complément » → confirmer | Statut `REFUSED`, commande en `ISSUE` |
| APF-06 | P2 | Contestation limitée | Tenter de contester des frais de stockage | Bouton **absent** (seuls les écarts de poids sont contestables) |
| APF-07 | P3 | Relances | Laisser un appel de fonds 3 puis 7 jours | Email de rappel à J+3 et J+7 |

---

## 8. Mentions légales et cookies

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| LEG-01 | **P1** | Bandeau | Première visite (onglet privé) | Bandeau affiché |
| LEG-02 | **P1** | Refus aussi visible | Comparer les deux boutons | « Tout refuser » **aussi visible** que « Tout accepter » (exigence CNIL) |
| LEG-03 | **P1** | Persistance | Refuser, recharger | Le bandeau **ne réapparaît pas** |
| LEG-04 | P2 | Personnalisation | « Personnaliser » | Essentiels verrouillés, autres décochables |
| LEG-05 | **P1** | Retrait | « Gérer mes cookies » | Le bandeau se rouvre avec les choix pré-remplis |
| LEG-06 | P2 | Accès mobile | Sur téléphone, espace compte | Liens légaux accessibles (la barre latérale disparaît) |
| LEG-07 | **P1** | Pages légales | Ouvrir `/cgv.html` et `/confidentialite.html` | Pages lisibles, mobile compris |

---

## 9. Administration

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| ADM-01 | **P1** | Accès réservé | Se connecter en **client** et tenter l'admin | **Refusé** |
| ADM-02 | **P1** | État des sources | Tarification → « Tester les sources » | Verdict eBay / AliExpress + requêtes traduites |
| ADM-03 | **P1** | Alerte données factices | Voir ADM-02 | Si eBay échoue, l'alerte **⚠ DONNÉES FACTICES** apparaît |
| ADM-03a | **P1** | Ajout d'une casse | Tarification → saisir identifiant + libellé → Ajouter | Vendeur listé, marqué « Non vérifié » |
| ADM-03b | **P1** | Vérification | Cliquer « Vérifier » | Nombre d'annonces trouvées. **« 0 annonce » = identifiant faux** — il serait accepté sans erreur et ne remonterait jamais rien |
| ADM-03c | P2 | Casses dans les résultats | Après ajout d'une casse vérifiée, relancer une recherche | Ses annonces apparaissent avec le badge **« Pro »**, remontées à prix comparable |
| ADM-03d | **P1** | Aucune fuite via le badge | Inspecter la réponse `/find` | Le badge est présent, mais **aucun nom de vendeur ni de marketplace** |
| ADM-04 | P2 | Simulateur | Simuler un prix | Décomposition complète (pièce, port, frais, marge) |
| ADM-05 | P2 | Paramètres | Modifier le taux de marge | Pris en compte **sans redéploiement** |
| ADM-06 | P2 | Bornes | Saisir une marge aberrante (ex. 500 %) | **Refusé** |
| ADM-07 | P2 | Journal | Après ADM-05, consulter l'historique | Modification tracée (ancienne/nouvelle valeur, auteur) |
| ADM-08 | P3 | Grille Colissimo | Consulter la grille | Tranches affichées + **alerte de fraîcheur** si > 1 an |

---

## 10. Sécurité et démarketisation

> **Le cœur du modèle : le client ne doit jamais savoir où sont achetées les
> pièces.** Ces tests se font avec les outils de développement du navigateur
> (`F12`), onglet **Réseau**.

| ID | Prio | Objectif | Étapes | Résultat attendu |
|---|---|---|---|---|
| SEC-01 | **P1** | Aucune fuite | Lancer une recherche, ouvrir la réponse `/find`, chercher `ebay` / `aliexpress` | **Zéro occurrence** |
| SEC-02 | **P1** | Images relayées | Onglet Réseau, filtrer les images | Toutes viennent de **notre backend**, jamais de `ebayimg.com` |
| SEC-03 | **P1** | Jeton opaque | Décoder un `offerToken` (base64) | **Illisible** (chiffré) — ni source, ni prix d'achat |
| SEC-04 | **P1** | Coût infalsifiable | Modifier un `offerToken` dans la console avant de commander | Commande créée **sans coût**, avec la note « COÛT NON VÉRIFIÉ » en admin |
| SEC-05 | **P1** | Diagnostics protégés | Sans être connecté, ouvrir `/api/parts/debug-sources` et `/api/parts/search` | **HTTP 401** |
| SEC-06 | P2 | Relais non détournable | Appeler `/api/parts/image/<jeton forgé>` visant `169.254.169.254` | **HTTP 404** |
| SEC-07 | P2 | Descriptions nettoyées | Lire les descriptions des résultats | Aucune marque de marketplace, aucun lien vendeur |
| SEC-08 | P2 | Emails neutres | Relire tous les emails reçus | Aucune mention de fournisseur |
| SEC-09 | **P1** | Isolation des comptes | Avec le compte A, tenter d'accéder à une commande du compte B | **Refusé** |

---

## 11. Compatibilité

| ID | Prio | Objectif | Résultat attendu |
|---|---|---|---|
| CMP-01 | **P1** | Mobile Android | Parcours complet utilisable |
| CMP-02 | **P1** | Sélection de marque sur mobile | Saisir « mer » → « Mercedes » proposé et **lisible** |
| CMP-03 | P2 | iPhone / Safari | Pas de rupture d'affichage |
| CMP-04 | P2 | Entrepôt sur téléphone | Champs et boutons **utilisables avec des gants** |
| CMP-05 | P3 | Tablette | Mise en page cohérente |

---

## Feuille de résultats

```
Date : ____________   Version testée (commit) : ____________
Testeur : ____________   Environnement : [ ] test   [ ] production

P1 : ____ / ____ OK        P2 : ____ / ____ OK        P3 : ____ / ____ OK

Anomalies bloquantes :
  ID ______  ________________________________________________
  ID ______  ________________________________________________

Décision :  [ ] Mise en production autorisée   [ ] Refusée
```

---

## Points à surveiller particulièrement

1. **Le circuit financier complet** — `CMD-01` → `CMD-05` → `ENT-07` → `APF-03`
   → `APF-04` → `EXP-05`. Jamais joué de bout en bout. C'est de l'argent réel.
2. **La grille Colissimo** — les tarifs ont été **interpolés**, pas relevés sur
   le barème officiel. Une grille fausse fait vendre à perte, silencieusement.
3. **Les pannes silencieuses** — eBay bascule sur des données factices et
   AliExpress renvoie une liste vide sans rien signaler. `ADM-02` est le seul
   moyen de s'en apercevoir : à passer régulièrement, pas seulement en recette.
4. **Les commandes antérieures au jeton signé** — leurs coûts d'acquisition ont
   été déclarés par l'ancien client. À vérifier manuellement en validation.
5. **Les CGV** n'ont pas été relues par un juriste (clauses marquées `TODO`).
