<#
.SYNOPSIS
  Builds, starts or updates Kal. Run it ON THE SERVER from the deploy folder of the repository.

.DESCRIPTION
  1. Checks that Docker is running.
  2. Makes site.env from site.env.example on the first run and stops, so that you can fill in
     the address of your site.
  3. Makes the secret files that are missing, with random values that are never shown:
     db.env (database password), app.env (key that encrypts saved AI keys and tokens) and
     vapid.env (Web Push keys).
  4. Checks that cloudflared.env holds a tunnel token (skipped with -NoTunnel).
  5. Locks the secret files (and, the first time, the photos and backups folders) to you,
     SYSTEM and Administrators.
  6. Pulls the pinned Postgres, Squid and cloudflared images and builds the Kal image.
  7. Starts the database, the egress proxy, the app and the worker, with no published port, and
     waits until the app answers and the worker reports in.
  8. Starts the tunnel and waits for "Registered tunnel connection" (skipped with -NoTunnel).

.PARAMETER NoTunnel
  Start everything except the tunnel. Nothing is reachable from outside. Use it for the first
  setup: import the food data and make the first invite code, then run Start.ps1 again.

.PARAMETER SkipPull
  Use the Postgres, Squid and cloudflared images already on this computer (no download).

.PARAMETER SkipBuild
  Use the Kal image already built on this computer.

.PARAMETER TunnelWaitSeconds
  How long to wait for the tunnel to connect (default 60).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Start.ps1 -NoTunnel
  powershell -ExecutionPolicy Bypass -File .\Start.ps1
#>
[CmdletBinding()]
param(
    [switch]$NoTunnel,
    [switch]$SkipPull,
    [switch]$SkipBuild,
    [int]$TunnelWaitSeconds = 60
)

Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'Common.ps1')

# Polls the app from inside its own container until it answers (the first start creates the tables).
function Wait-App {
    for ($i = 0; $i -lt 60; $i++) {
        $health = Invoke-Compose exec -T app wget -qO- -T 5 http://127.0.0.1:3000/api/health
        if ($LASTEXITCODE -eq 0 -and "$health" -match '"ok":true') { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}

# Waits until a service's own health check passes.
function Wait-Healthy([string]$service, [int]$tries) {
    for ($i = 0; $i -lt $tries; $i++) {
        $id = Invoke-Compose ps -q $service
        if ($id) {
            $state = docker inspect -f '{{.State.Health.Status}}' "$id"
            if ("$state".Trim() -eq 'healthy') { return $true }
        }
        Start-Sleep -Seconds 3
    }
    return $false
}

Step 'Checking Docker'
$ver = Test-DockerRunning
Write-Host "  Docker $ver"

# --- site.env ---------------------------------------------------------------------------------
$siteEnv = Join-Path $PSScriptRoot 'site.env'
if (-not (Test-Path -LiteralPath $siteEnv)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'site.env.example') -Destination $siteEnv
    Write-Host ''
    Write-Host 'site.env was made from site.env.example.' -ForegroundColor Yellow
    Write-Host 'Open it, set BASE_URL (the public address of Kal) and your contact address, then run Start.ps1 again.'
    exit 1
}
$baseUrl = Get-EnvValue $siteEnv 'BASE_URL'
if (-not $baseUrl) { Fail 'BASE_URL is missing in site.env.' }
if ($baseUrl -match 'example\.(org|com|net)') {
    Write-Host '  warning: BASE_URL in site.env is still the example address; invite links will use it.' -ForegroundColor Yellow
}

# --- secret files -----------------------------------------------------------------------------
$dbEnv = Join-Path $PSScriptRoot 'db.env'
$appEnv = Join-Path $PSScriptRoot 'app.env'
$vapidEnv = Join-Path $PSScriptRoot 'vapid.env'

# A new password or key for a database that already exists would lock the app out of it (or make
# the saved AI keys unreadable), so stop and say how to get the old files back.
$project = $env:COMPOSE_PROJECT_NAME
if (-not $project) { $project = 'cal' }
Invoke-Quiet docker volume inspect "${project}_db"
$haveVolume = ($LASTEXITCODE -eq 0)
if ($haveVolume -and (-not (Test-Path -LiteralPath $dbEnv) -or -not (Test-Path -LiteralPath $appEnv))) {
    Fail 'The database volume exists but db.env or app.env is missing. Copy them back from the newest backup (Backup.ps1 keeps app.env next to the dumps). Do not make new ones for an existing database.'
}

if (-not (Test-Path -LiteralPath $dbEnv)) {
    Step 'Making db.env with a random database password'
    $password = New-RandomText 40
    Write-EnvFile $dbEnv @(
        '# Database login, made by Start.ps1. Read by the db, app and worker containers only.'
        '# Do not change the password after the first start: the database keeps the old one.'
        'POSTGRES_USER=cal'
        'POSTGRES_DB=cal'
        "POSTGRES_PASSWORD=$password"
        'PGUSER=cal'
        'PGDATABASE=cal'
        "PGPASSWORD=$password"
    )
    $password = $null
    Write-Host '  db.env written'
}

if (-not (Test-Path -LiteralPath $appEnv)) {
    Step 'Making app.env with a random key for the saved AI keys'
    Write-EnvFile $appEnv @(
        '# Encrypts the saved AI keys and tokens (AES-256-GCM), made by Start.ps1. Read by the app'
        '# and the worker only. Backup.ps1 copies it next to the database dumps: without this key a'
        '# restored database cannot read them. Never change it.'
        "CAL_SECRET_KEY=$(New-SecretKey)"
    )
    Write-Host '  app.env written'
}

if (-not (Test-Path -LiteralPath $vapidEnv)) {
    Step 'Making vapid.env with a Web Push key pair'
    $keys = New-VapidKeys
    Write-EnvFile $vapidEnv @(
        '# Web Push (notifications) key pair, made by Start.ps1. Read by the app and the worker only.'
        "VAPID_PUBLIC_KEY=$($keys.Public)"
        "VAPID_PRIVATE_KEY=$($keys.Private)"
    )
    $keys = $null
    Write-Host '  vapid.env written'
}

$tunnelEnv = Join-Path $PSScriptRoot 'cloudflared.env'
if ($NoTunnel) {
    # Compose reads every service's env file, so the tunnel's file has to exist (it can be empty).
    if (-not (Test-Path -LiteralPath $tunnelEnv)) { Write-EnvFile $tunnelEnv @('TUNNEL_TOKEN=') }
} else {
    Step 'Checking the Cloudflare token'
    if (-not (Test-Path -LiteralPath $tunnelEnv)) {
        Fail 'cloudflared.env is missing. Copy cloudflared.env.example to cloudflared.env and paste the token (README.md, step 3), or run with -NoTunnel.'
    }
    $token = Get-EnvValue $tunnelEnv 'TUNNEL_TOKEN'
    if ($token -notmatch '^eyJ[A-Za-z0-9+/_=-]{40,}$') {
        Fail 'No valid tunnel token in cloudflared.env yet. Paste it right after TUNNEL_TOKEN= (README.md, step 3), or run with -NoTunnel.'
    }
    $token = $null
    Write-Host '  token present'
}

# --- folders and locks ------------------------------------------------------------------------
Step 'Locking secret files'
$photos = Resolve-DeployFolder (Get-ComposeSetting 'CAL_PHOTOS_DIR' './photos')
$backups = Resolve-DeployFolder (Get-ComposeSetting 'CAL_BACKUP_DIR' './backups')
$newFolders = @()
foreach ($d in @($photos, $backups)) {
    if (-not (Test-Path -LiteralPath $d)) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        $newFolders += $d
    }
}
$locked = @($dbEnv, $appEnv, $vapidEnv)
# The tunnel file is locked once it holds a token. Before that it stays editable, so the token can
# still be pasted in, also from another computer through a network share.
if ((Test-Path -LiteralPath $tunnelEnv) -and (Get-EnvValue $tunnelEnv 'TUNNEL_TOKEN')) { $locked += $tunnelEnv }
# Folders are locked when they are new; resetting thousands of photo files on every start is slow.
$locked += $newFolders
foreach ($p in $locked) { Protect-Path $p }

# --- images -----------------------------------------------------------------------------------
if (-not $SkipPull) {
    Step 'Pulling pinned images'
    if ($NoTunnel) { Invoke-Compose pull db egress } else { Invoke-Compose pull db egress tunnel }
    if ($LASTEXITCODE -ne 0) { Fail 'docker compose pull failed (see above).' }
}

if (-not $SkipBuild) {
    Step 'Building the Kal image (a few minutes the first time)'
    Invoke-Compose build app
    if ($LASTEXITCODE -ne 0) { Fail 'Building the Kal image failed (see above).' }
} else {
    $image = Get-ComposeSetting 'CAL_IMAGE' 'cal-app:local'
    Invoke-Quiet docker image inspect $image
    if ($LASTEXITCODE -ne 0) { Fail "-SkipBuild was given but the image $image does not exist yet." }
}

# --- start ------------------------------------------------------------------------------------
Step 'Starting database, proxy, app and worker (no published ports)'
Invoke-Compose up -d --remove-orphans db egress app worker
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed (see above).' }
if (-not (Wait-App)) {
    Invoke-Compose stop tunnel
    Fail 'The app did not answer within 3 minutes, so the tunnel stays off. Check: docker compose logs app db'
}
Write-Host '  app answers, database connected, migrations applied' -ForegroundColor Green
if (Wait-Healthy 'worker' 30) {
    Write-Host '  worker reports in' -ForegroundColor Green
} else {
    Write-Host '  worker has not reported in yet. Check: docker compose logs worker' -ForegroundColor Yellow
}

$users = Invoke-Compose exec -T db psql -tAc 'select count(*) from users'
if ("$users".Trim() -eq '0') {
    Write-Host ''
    Write-Host '  No accounts yet. Make the first (admin) invite code with:' -ForegroundColor Yellow
    Write-Host '    powershell -ExecutionPolicy Bypass -File .\Cal.ps1 invite --admin --note first-admin'
    $foods = Invoke-Compose exec -T db psql -tAc 'select count(*) from foods'
    if ("$foods".Trim() -eq '0') {
        Write-Host '  The food database is empty. Import it (a few minutes, needs internet through the proxy):' -ForegroundColor Yellow
        Write-Host '    powershell -ExecutionPolicy Bypass -File .\Cal.ps1 import-fdc'
        Write-Host '    powershell -ExecutionPolicy Bypass -File .\Cal.ps1 seed-dishes'
    }
}

if ($NoTunnel) {
    Invoke-Quiet Invoke-Compose stop tunnel
    Invoke-Compose ps
    Write-Host ''
    Write-Host 'Tunnel left OFF (-NoTunnel). Nothing is reachable from outside this server.'
    exit 0
}

Step 'Starting the Cloudflare tunnel'
Invoke-Compose up -d --remove-orphans
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed (see above).' }

$tid = Invoke-Compose ps -aq tunnel
$connected = $false
$rounds = [math]::Max(1, [int]($TunnelWaitSeconds / 2))
for ($i = 0; $i -lt $rounds; $i++) {
    Start-Sleep -Seconds 2
    # cloudflared logs to stderr; cmd merges it so PowerShell 5.1 does not treat it as an error.
    $log = cmd /c "docker logs --tail 60 $tid 2>&1"
    if ($log -match 'Registered tunnel connection') { $connected = $true; break }
    if ($log -match 'token is not valid|Unauthorized|failed to unmarshal|Failed to get tunnel|Invalid tunnel secret') { break }
}
if ($connected) {
    Write-Host '  tunnel connected to Cloudflare' -ForegroundColor Green
} else {
    Write-Host '  tunnel NOT connected yet. Last tunnel log lines:' -ForegroundColor Yellow
    cmd /c "docker logs --tail 15 $tid 2>&1"
}

Invoke-Compose ps
Write-Host ''
Write-Host "Open $baseUrl and sign in. .\Status.ps1 shows the same checks at any time."
if (-not $connected) { exit 1 }
