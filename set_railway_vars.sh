#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Définit les variables d'environnement eBay/IA sur le service backend Railway.
# À exécuter SUR TA MACHINE (pas depuis Cowork : le réseau Railway y est bloqué).
#
# Prérequis :
#   1) Node installé, puis :  npm i -g @railway/cli
#   2) Remplace <TA_CLE_ANTHROPIC> ci-dessous par ta vraie clé.
#   3) Lance :  bash set_railway_vars.sh
#      (sous Windows : Git Bash, ou adapte en PowerShell.)
#
# Le token ci-dessous est un PROJECT TOKEN Railway (scopé au projet/environnement).
# ---------------------------------------------------------------------------
set -euo pipefail

export RAILWAY_TOKEN="<RAILWAY_PROJECT_TOKEN>"
PROJECT_ID="5cf2a364-d8f6-4e07-b15f-d4e031f7cea2"

# Nom EXACT du service backend tel qu'affiché dans Railway (à vérifier/ajuster).
SERVICE="partfinder_backend"

ANTHROPIC_API_KEY="<TA_CLE_ANTHROPIC>"

echo "→ Lien du projet Railway..."
railway link --project "$PROJECT_ID" || true

echo "→ Écriture des variables sur le service '$SERVICE'..."
railway variables --service "$SERVICE" \
  --set "EBAY_ENV=production" \
  --set "EBAY_APP_ID=<EBAY_APP_ID>" \
  --set "EBAY_CERT_ID=<EBAY_CERT_ID>" \
  --set "EBAY_MARKETPLACE_ID=EBAY_FR" \
  --set "EBAY_CATEGORY_ID=6030" \
  --set "EBAY_VERIFICATION_TOKEN=<EBAY_VERIFICATION_TOKEN>" \
  --set "EBAY_DELETION_ENDPOINT=https://partfinder-backend-production.up.railway.app/api/ebay/marketplace-deletion" \
  --set "PART_MARGIN_MULTIPLIER=1.33" \
  --set "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"

echo "✓ Variables définies. Railway va redéployer automatiquement."
echo "  Vérifie ensuite : https://partfinder-backend-production.up.railway.app/api/ebay/marketplace-deletion?challenge_code=test"
