# ============================================================================
# 2.13.6 — LOKALNI CRON ZA UVOZ VESTI (Windows Task Scheduler)
# ============================================================================
# Pravi zadatak koji svakih 30 minuta pokreće `npm run ingest:news`.
#
# Kada koristiti ovo, a kada GitHub Actions:
#   * ovde — dok razvijaš lokalno, API radi na tvom računaru;
#   * GitHub Actions (.github/workflows/news-ingest.yml) — kada API bude na
#     hostingu; radi i kad je računar ugašen.
#
# Ograničenje: Task Scheduler pokreće zadatak samo dok je računar uključen.
# Ako je preskočen (sleep), Windows ga pokreće po buđenju (-StartWhenAvailable).
#
# Upotreba (PowerShell, iz root-a projekta):
#   .\scripts\setup-cron.ps1                 # registruj (svakih 30 min)
#   .\scripts\setup-cron.ps1 -Interval 15    # svakih 15 min
#   .\scripts\setup-cron.ps1 -Remove         # obriši zadatak
#   .\scripts\setup-cron.ps1 -Test           # pokreni odmah (bez registracije)
# ============================================================================

param(
  [int]$Interval = 30,
  [switch]$Remove,
  [switch]$Test,
  [string]$TaskName = 'NEXUS vests'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
$logFile = Join-Path $logDir 'news-ingest.log'

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Zadatak '$TaskName' je obrisan." -ForegroundColor Yellow
  } else {
    Write-Host "Zadatak '$TaskName' ne postoji." -ForegroundColor DarkGray
  }
  return
}

# Pokretanje ide kroz cmd, da bi se radni direktorijum postavio pre node-a.
#
# 2.13.6 — kodiranje: podrazumevana Windows konzola je CP1250, pa se „č/ć/ž“
# u logu pretvaraju u „ÄŤ/Â“. `chcp 65001` preko UTF-8 pre uključivanja loga.
#
# 2.13.7 — skripta se poziva direktno (`node scripts/ingest-rss.mjs`), bez `npm`,
# jer Task Scheduler pokreće cmd bez konzole i npm-ov obojeni izlaz je pravio
# duple redove i ostavljao dijakritiku pokvarenom u logu.
$command = "cmd /c cd /d `"$root`" && set PYTHONUTF8=1 && node scripts/ingest-rss.mjs >> `"$logFile`" 2>&1"

if ($Test) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Write-Host 'Pokrećem uvoz jednom (bez registracije)...' -ForegroundColor Cyan
  cmd /c "chcp 65001 >nul && cd /d `"$root`" && node scripts/ingest-rss.mjs"
  Write-Host "Log: $logFile" -ForegroundColor DarkGray
  return
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Bez `chcp` u akciji: zadatak nema konzolu, pa pod Windows 11 (ConPTY) izlaz
# i dalje ide kao CP1250 iako skripta piše UTF-8. Konzolno pokretanje (`-Test`)
# zadržava `chcp 65001` jer se tamo ispisuje na ekran.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $command" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Interval) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
# `-StartWhenAvailable`: ako je računar bio ugašen/sleep, pokreni po buđenju.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "NEXUS: uvoz RSS vesti iz n8n-a (svakih $Interval min)" | Out-Null

Write-Host "Zadatak '$TaskName' je registrovan (svakih $Interval min)." -ForegroundColor Green
Write-Host "Log:        $logFile" -ForegroundColor DarkGray
Write-Host 'Provera:    Get-ScheduledTask -TaskName "NEXUS vests" | Get-ScheduledTaskInfo' -ForegroundColor DarkGray
Write-Host 'Brisanje:   .\scripts\setup-cron.ps1 -Remove' -ForegroundColor DarkGray
