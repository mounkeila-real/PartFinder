# ---------------------------------------------------------------------------
# Définit les variables eBay/IA sur le service backend Railway (Windows PowerShell).
# À exécuter SUR TA MACHINE (le réseau Railway est bloqué depuis Cowork).
#
# Prérequis :
#   1) npm i -g @railway/cli
#   2) Remplace <TA_CLE_ANTHROPIC> ci-dessous.
#   3) Lance :  powershell -ExecutionPolicy Bypass -File set_railway_vars.ps1
# ---------------------------------------------------------------------------

$env:RAILWAY_TOKEN = "<RAILWAY_PROJECT_TOKEN>"
$ProjectId = "5cf2a364-d8f6-4e07-b15f-d4e031f7cea2"
$Service   = "PartFinder Backend"   # nom EXACT du service backend dans Railway
$Anthropic = "<TA_CLE_ANTHROPIC>"

Write-Host "-> Lien du projet Railway..."
railway link --project $ProjectId

Write-Host "-> Écriture des variables sur le service '$Service'..."
railway variables --service $Service `
  --set "EBAY_ENV=production" `
  --set "EBAY_APP_ID=<EBAY_APP_ID>" `
  --set "EBAY_CERT_ID=<EBAY_CERT_ID>" `
  --set "EBAY_MARKETPLACE_ID=EBAY_FR" `
  --set "EBAY_CATEGORY_ID=6030" `
  --set "EBAY_VERIFICATION_TOKEN=<EBAY_VERIFICATION_TOKEN>" `
  --set "EBAY_DELETION_ENDPOINT=https://partfinder-backend-production-c0af.up.railway.app/api/ebay/marketplace-deletion" `
  --set "PART_MARGIN_MULTIPLIER=1.33" `
  --set "ANTHROPIC_API_KEY=$Anthropic"

Write-Host "✓ Variables définies. Railway redéploie automatiquement."
Write-Host "  Test : https://partfinder-backend-production-c0af.up.railway.app/api/ebay/marketplace-deletion?challenge_code=test"
