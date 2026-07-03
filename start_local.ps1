# ---------------------------------------------------------------------------
# Lanceur local PartFinder (Windows).
# Utilisation : clic droit sur ce fichier > "Exécuter avec PowerShell"
#   (ou dans un terminal : powershell -ExecutionPolicy Bypass -File start_local.ps1)
#
# Prérequis : Node.js 20+ installé (vérifie avec :  node --version)
# Ouvre 2 fenêtres (backend + frontend) puis le navigateur sur http://localhost:3000
# ---------------------------------------------------------------------------

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "== PartFinder : démarrage local ==" -ForegroundColor Cyan
Write-Host "Dossier projet : $root"

# --- Backend (port 3001) ---
$backendCmd = "cd `"$root\partfinder_backend`"; " +
              "if (!(Test-Path node_modules)) { npm install }; " +
              "npx prisma generate; npx prisma db push; " +
              "Write-Host 'Backend sur http://localhost:3001' -ForegroundColor Green; " +
              "npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

Start-Sleep -Seconds 4

# --- Frontend (port 3000) ---
$frontendCmd = "cd `"$root\partfinder`"; " +
               "if (!(Test-Path node_modules)) { npm install }; " +
               "Write-Host 'Frontend sur http://localhost:3000' -ForegroundColor Green; " +
               "npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host "Attente du démarrage des serveurs..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
Start-Process "http://localhost:3000"

Write-Host "Fait. Deux fenêtres PowerShell tournent (backend + frontend)." -ForegroundColor Cyan
Write-Host "Pour arrêter : ferme ces deux fenêtres."
