<#
.SYNOPSIS
  Full local test of the Docker stack as the compose project "caltest". Run it on a development
  PC, never on the server.

.DESCRIPTION
  1. Builds the image and starts the whole stack with the real deploy scripts (Start.ps1), a
     dummy tunnel token, a stand-in for the Google AI API behind the allowed Google host, and the
     app published ONLY on 127.0.0.1:3206 through deploy/test/docker-compose.test.yml.
  2. Imports the FoodData Central data from a cached download folder, seeds the dishes and makes
     two invite codes with Cal.ps1.
  3. Runs the Playwright smoke test (playwright.stack.config.ts): sign up by invite, upload a
     photo, analysis through the proxy, edit an item, photo privacy, Persian search.
  4. Runs deploy/test/stack-checks.mjs (no published ports, non-root, read-only, zero
     capabilities, no direct route out, proxy allowlist, secrets absent) and exercises Status.ps1
     and Backup.ps1.
  5. Tears the project down completely: containers, networks, volumes, the test image and every
     file the test made in deploy/. Nothing outside the "caltest" names is touched.

  The test refuses to run when deploy/ already holds secret files or a docker-compose.override.yml,
  or when anything named caltest exists in Docker.

.PARAMETER FdcCache
  Folder with the downloaded FoodData Central zip files (what "cal import-fdc" cached).

.PARAMETER WorkDir
  Scratch folder for the photos, backups, certificates and logs of the run (default
  deploy\test\work, which git ignores). Removed at the end unless -KeepWork is given.

.PARAMETER KeepRunning
  Do not tear down at the end (for looking around). Tear down later with -TearDownOnly.

.PARAMETER TearDownOnly
  Only remove what an earlier run left.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\test\Test-Stack.ps1 -FdcCache X:\cache\cal-fdc
#>
[CmdletBinding()]
param(
    [string]$FdcCache = '',
    [string]$WorkDir = '',
    [switch]$KeepRunning,
    [switch]$KeepWork,
    [switch]$TearDownOnly
)

$ErrorActionPreference = 'Continue'
$testDir = $PSScriptRoot
$deploy = Split-Path -Parent $testDir
$repo = Split-Path -Parent $deploy
. (Join-Path $deploy 'Common.ps1')

if (-not $WorkDir) { $WorkDir = Join-Path $testDir 'work' }
$WorkDir = [System.IO.Path]::GetFullPath($WorkDir)
$logDir = Join-Path $repo 'test-results\stack-test'
$fwd = { param($p) ($p -replace '\\', '/') }

$project = 'caltest'
$imageName = 'caltest-app:local'
$made = @('db.env', 'app.env', 'vapid.env', 'cloudflared.env', 'site.env', 'docker-compose.override.yml')

$failed = 0
function Pass([string]$msg) { Write-Host "PASS  $msg" -ForegroundColor Green }
function Bad([string]$msg) { Write-Host "FAIL  $msg" -ForegroundColor Red; $script:failed++ }
function Expect([bool]$ok, [string]$msg) { if ($ok) { Pass $msg } else { Bad $msg } }

# Tee-Object in Windows PowerShell 5.1 writes UTF-16; logs here are plain ASCII, and the lines are
# also shown on the screen.
function Tee-Ascii([string]$file) {
    begin { Set-Content -LiteralPath $file -Value '' -Encoding ascii }
    process { Add-Content -LiteralPath $file -Value $_ -Encoding ascii; $_ }
}

# Everything this test created, by name. Used before the run (to refuse) and after it (to verify).
function Get-LeftOvers {
    $found = @()
    $found += @(docker ps -a --format '{{.Names}}' --filter "name=$project")
    $found += @(docker network ls --format '{{.Name}}' --filter "name=$project")
    $found += @(docker volume ls --format '{{.Name}}' --filter "name=$project")
    $found += @(docker image ls --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -like "$project*" })
    return @($found | Where-Object { $_ })
}

function Remove-TestStack {
    Step 'Tearing down the caltest project'
    Push-Location -LiteralPath $deploy
    try {
        if (Test-Path -LiteralPath (Join-Path $deploy 'db.env')) {
            Invoke-Compose down -v --remove-orphans --timeout 20
        }
        # Anything of this project that compose no longer knows (an interrupted run).
        $names = @(docker ps -a -q --filter "label=com.docker.compose.project=$project")
        if ($names.Count -gt 0) { docker rm -f $names | Out-Null }
        foreach ($n in @(docker network ls -q --filter "label=com.docker.compose.project=$project")) { docker network rm $n | Out-Null }
        foreach ($v in @(docker volume ls -q --filter "label=com.docker.compose.project=$project")) { docker volume rm $v | Out-Null }
        Invoke-Quiet docker image rm $imageName
        Invoke-Quiet docker image rm 'caltest-app:probe'
    } finally {
        Pop-Location
    }
    foreach ($f in $made) {
        $p = Join-Path $deploy $f
        if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
    }
    if (-not $KeepWork -and (Test-Path -LiteralPath $WorkDir)) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force
    }
    $left = Get-LeftOvers
    Expect ($left.Count -eq 0) ('nothing named caltest is left in Docker' + $(if ($left.Count -gt 0) { ': ' + ($left -join ', ') } else { '' }))
}

if ($TearDownOnly) {
    Test-DockerRunning | Out-Null
    $env:COMPOSE_PROJECT_NAME = $project
    $env:CAL_IMAGE = $imageName
    $env:CALTEST_DIR = (& $fwd $WorkDir)
    $env:CALTEST_FDC_DIR = (& $fwd $deploy)
    $env:CAL_PHOTOS_DIR = (& $fwd (Join-Path $WorkDir 'photos'))
    $env:CAL_BACKUP_DIR = (& $fwd (Join-Path $WorkDir 'backups'))
    Remove-TestStack
    exit $failed
}

if (-not $FdcCache) { Fail 'Give -FdcCache, the folder with the cached FoodData Central downloads.' }
if (-not (Test-Path -LiteralPath $FdcCache)) { Fail "FdcCache folder $FdcCache does not exist." }

Step 'Checking that this PC is ready'
$ver = Test-DockerRunning
Write-Host "  Docker $ver"
$existing = $made | Where-Object { Test-Path -LiteralPath (Join-Path $deploy $_) }
if ($existing) { Fail ("deploy/ already holds " + ($existing -join ', ') + '. This test only runs where nothing is installed; it will not touch them.') }
$left = Get-LeftOvers
if ($left.Count -gt 0) { Fail ('Docker already has: ' + ($left -join ', ') + '. Run with -TearDownOnly first.') }
$busy = Get-NetTCPConnection -LocalPort 3206 -State Listen -ErrorAction SilentlyContinue
if ($busy) { Fail 'Port 3206 is already in use on this PC.' }

New-Item -ItemType Directory -Force -Path $WorkDir, $logDir | Out-Null
foreach ($d in 'photos', 'backups', 'mock') { New-Item -ItemType Directory -Force -Path (Join-Path $WorkDir $d) | Out-Null }

# Settings for the compose files (the environment wins over .env).
$env:COMPOSE_PROJECT_NAME = $project
$env:CAL_IMAGE = $imageName
$env:CALTEST_DIR = (& $fwd $WorkDir)
$env:CALTEST_FDC_DIR = (& $fwd ([System.IO.Path]::GetFullPath($FdcCache)))
$env:CAL_PHOTOS_DIR = (& $fwd (Join-Path $WorkDir 'photos'))
$env:CAL_BACKUP_DIR = (& $fwd (Join-Path $WorkDir 'backups'))
$env:CAL_STACK_PHOTOS = (Join-Path $WorkDir 'photos')

$ps = 'powershell.exe'
$psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')
$exit = 0
try {
    # --- stand-in provider and its certificate ---------------------------------------------------
    Step 'Making the stand-in AI provider and its certificate'
    foreach ($f in 'mock-ai.mjs', 'gateway.mjs') { Copy-Item -LiteralPath (Join-Path $testDir $f) -Destination (Join-Path $WorkDir 'mock') }
    Copy-Item -LiteralPath (Join-Path $repo 'tests\helpers\mock-integrations.ts') -Destination (Join-Path $WorkDir 'mock')
    [System.IO.File]::WriteAllText((Join-Path $WorkDir 'mock\package.json'), "{`"type`":`"module`"}`n", (New-Object System.Text.UTF8Encoding($false)))
    $squid = 'ubuntu/squid:' + (Get-EnvValue (Join-Path $deploy '.env') 'CAL_SQUID_VERSION')
    $mockDir = (& $fwd (Join-Path $WorkDir 'mock'))
    Invoke-Quiet docker run --rm --name "$project-cert" --network none --user 1000:1000 --mount "type=bind,source=$mockDir,target=/out" --entrypoint openssl $squid req -x509 -newkey rsa:2048 -nodes -keyout /out/mock-key.pem -out /out/mock-cert.pem -days 2 -subj /CN=generativelanguage.googleapis.com -addext subjectAltName=DNS:generativelanguage.googleapis.com
    Expect ((Test-Path (Join-Path $WorkDir 'mock\mock-cert.pem')) -and (Test-Path (Join-Path $WorkDir 'mock\mock-key.pem'))) 'certificate for the stand-in provider made'

    # --- settings and the dummy tunnel token -------------------------------------------------------
    Write-EnvFile (Join-Path $deploy 'site.env') @(
        'BASE_URL=http://127.0.0.1:3206'
        'OFF_CONTACT=test@example.org'
        'VAPID_SUBJECT=mailto:test@example.org'
        'MEALIE_BASE_URL=https://mealie.caltest.example.org'
        'OPENGYM_BASE_URL=https://gym.caltest.example.org'
    )
    $dummy = '{"a":"00000000000000000000000000000000","t":"00000000-0000-0000-0000-000000000000","s":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}'
    $dummyToken = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($dummy))
    Write-EnvFile (Join-Path $deploy 'cloudflared.env') @("TUNNEL_TOKEN=$dummyToken")
    Copy-Item -LiteralPath (Join-Path $testDir 'docker-compose.test.yml') -Destination (Join-Path $deploy 'docker-compose.override.yml')

    Push-Location -LiteralPath $deploy

    # --- first setup: everything except the tunnel ---------------------------------------------
    Step 'Start.ps1 -NoTunnel (first setup: builds the image, makes the secrets)'
    & $ps @psArgs (Join-Path $deploy 'Start.ps1') -NoTunnel | Tee-Ascii (Join-Path $logDir 'start-notunnel.log') | Out-Null
    Expect ($LASTEXITCODE -eq 0) 'Start.ps1 -NoTunnel finished with exit code 0'
    foreach ($f in 'db.env', 'app.env', 'vapid.env') { Expect (Test-Path (Join-Path $deploy $f)) "$f was made" }
    # The secret files are locked to the current user, SYSTEM and Administrators only.
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $lockedOk = $true
    foreach ($f in 'db.env', 'app.env', 'vapid.env', 'cloudflared.env') {
        $acl = Get-Acl -LiteralPath (Join-Path $deploy $f)
        $who = @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        $expected = @($me, 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators') | Sort-Object
        if (-not $acl.AreAccessRulesProtected -or (Compare-Object $who $expected)) { $lockedOk = $false }
    }
    Expect $lockedOk 'the four secret files are locked to the current user, SYSTEM and Administrators'
    $tunnelRunning = (Invoke-Compose ps -q --status running tunnel)
    Expect (-not $tunnelRunning) 'the tunnel is not running after -NoTunnel'
    $log = Get-Content (Join-Path $logDir 'start-notunnel.log') -Raw
    Expect ($log -notmatch 'PGPASSWORD|POSTGRES_PASSWORD|CAL_SECRET_KEY|VAPID_PRIVATE_KEY') 'the start log shows no secret names or values'

    # --- food data and accounts ------------------------------------------------------------------
    Step 'Cal.ps1: import the FoodData Central cache, seed the dishes, make invite codes'
    $import = & $ps @psArgs (Join-Path $deploy 'Cal.ps1') import-fdc --no-download
    $import | Out-File -FilePath (Join-Path $logDir 'import-fdc.log') -Encoding ascii
    Expect ($LASTEXITCODE -eq 0) 'Cal.ps1 import-fdc finished with exit code 0'
    $seed = & $ps @psArgs (Join-Path $deploy 'Cal.ps1') seed-dishes
    $seed | Out-File -FilePath (Join-Path $logDir 'seed-dishes.log') -Encoding ascii
    Expect ($LASTEXITCODE -eq 0) 'Cal.ps1 seed-dishes finished with exit code 0'
    $foods = (Invoke-Compose exec -T db psql -tAc 'select count(*) from foods').Trim()
    $dishes = (Invoke-Compose exec -T db psql -tAc "select count(*) from foods where kind = 'dish'").Trim()
    Expect ([int]$foods -gt 13000) "foods in the database: $foods"
    Expect ([int]$dishes -ge 21) "seeded dishes: $dishes"

    $codes = @()
    foreach ($note in 'smoke-a', 'smoke-b') {
        $out = & $ps @psArgs (Join-Path $deploy 'Cal.ps1') invite --note $note
        $m = [regex]::Match(($out -join "`n"), '[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}')
        if ($m.Success) { $codes += $m.Value }
    }
    Expect ($codes.Count -eq 2) 'two invite codes made with Cal.ps1 invite'
    $users = & $ps @psArgs (Join-Path $deploy 'Cal.ps1') users
    Expect (($users -join ' ') -match 'No accounts yet') 'Cal.ps1 users runs (no accounts yet)'

    # --- the whole stack with a dummy tunnel token -------------------------------------------
    Step 'Start.ps1 (all services, dummy tunnel token: the tunnel cannot connect)'
    & $ps @psArgs (Join-Path $deploy 'Start.ps1') -SkipPull -SkipBuild -TunnelWaitSeconds 20 | Tee-Ascii (Join-Path $logDir 'start-full.log') | Out-Null
    Expect ($LASTEXITCODE -eq 1) 'Start.ps1 exits with 1 because the dummy token cannot register'
    $log = Get-Content (Join-Path $logDir 'start-full.log') -Raw
    Expect ($log -match 'app answers, database connected') 'Start.ps1 saw the app answer'
    Expect ($log -match 'tunnel NOT connected') 'Start.ps1 reported the tunnel as not connected'
    $tunnelId = Invoke-Compose ps -aq tunnel
    $tlog = cmd /c "docker logs --tail 40 $tunnelId 2>&1"
    Expect (($tlog -join ' ') -match 'cloudflared|tunnel|Unauthorized|token') 'the hardened tunnel container started and tried to register'

    # --- browser smoke test ------------------------------------------------------------------------
    Step 'Playwright smoke test against 127.0.0.1:3206'
    Pop-Location
    Push-Location -LiteralPath $repo
    $env:CAL_STACK_URL = 'http://127.0.0.1:3206'
    $env:CAL_STACK_INVITE_A = $codes[0]
    $env:CAL_STACK_INVITE_B = $codes[1]
    corepack pnpm@11.11.0 exec playwright test -c playwright.stack.config.ts | Tee-Ascii (Join-Path $logDir 'playwright.log')
    Expect ($LASTEXITCODE -eq 0) 'Playwright smoke test passed'
    Remove-Item Env:CAL_STACK_INVITE_A, Env:CAL_STACK_INVITE_B -ErrorAction SilentlyContinue
    Pop-Location
    Push-Location -LiteralPath $deploy

    # --- checks ---------------------------------------------------------------------------------------
    Step 'Stack checks'
    node (Join-Path $testDir 'stack-checks.mjs') | Tee-Ascii (Join-Path $logDir 'stack-checks.log')
    Expect ($LASTEXITCODE -eq 0) 'stack-checks.mjs passed'

    # --- Status.ps1 -----------------------------------------------------------------------------------
    Step 'Status.ps1'
    $status = & $ps @psArgs (Join-Path $deploy 'Status.ps1')
    $status | Out-File -FilePath (Join-Path $logDir 'status.log') -Encoding ascii
    $statusText = $status -join "`n"
    Expect ($statusText -match 'App: answering') 'Status.ps1 reports the app answering'
    Expect ($statusText -match 'Accounts: 2') 'Status.ps1 counts the two accounts'
    Expect ($statusText -match 'Published port on') 'Status.ps1 reports the one published test port'

    # --- Backup.ps1 -----------------------------------------------------------------------------------
    Step 'Backup.ps1 (never deletes unless -Keep is given)'
    $backups = Join-Path $WorkDir 'backups'
    & $ps @psArgs (Join-Path $deploy 'Backup.ps1') | Out-File -FilePath (Join-Path $logDir 'backup-1.log') -Encoding ascii
    Expect ($LASTEXITCODE -eq 0) 'Backup.ps1 finished with exit code 0'
    Start-Sleep -Seconds 2
    & $ps @psArgs (Join-Path $deploy 'Backup.ps1') | Out-File -FilePath (Join-Path $logDir 'backup-2.log') -Encoding ascii
    $dumps = @(Get-ChildItem -LiteralPath $backups -Filter 'cal-db-*.dump')
    Expect ($dumps.Count -eq 2 -and ($dumps | Where-Object { $_.Length -gt 0 }).Count -eq 2) 'two non-empty dumps exist and the first was not deleted'
    Expect (Test-Path (Join-Path $backups 'app.env')) 'app.env is next to the dumps'
    $copied = @(Get-ChildItem -LiteralPath (Join-Path $backups 'photos') -Recurse -File -ErrorAction SilentlyContinue)
    Expect ($copied.Count -ge 3) "the photo folder was copied ($($copied.Count) files)"
    $dest = Join-Path $WorkDir 'offsite'
    Start-Sleep -Seconds 2
    & $ps @psArgs (Join-Path $deploy 'Backup.ps1') -Destination $dest -Keep 1 | Out-File -FilePath (Join-Path $logDir 'backup-3.log') -Encoding ascii
    $dumps = @(Get-ChildItem -LiteralPath $backups -Filter 'cal-db-*.dump')
    Expect ($dumps.Count -eq 1) '-Keep 1 left exactly the newest dump'
    Expect ((@(Get-ChildItem -LiteralPath $dest -Filter 'cal-db-*.dump')).Count -eq 1 -and (Test-Path (Join-Path $dest 'photos'))) '-Destination received the dump and the photos'
    $restore = docker compose -f docker-compose.yml -f docker-compose.override.yml exec -T db pg_restore --list "/backups/$($dumps[0].Name)"
    Expect (($restore -join ' ') -match 'TABLE DATA public meals') 'the dump lists the meals table data (pg_restore --list)'
    Pop-Location
} catch {
    Bad "the test script stopped: $_"
} finally {
    if (-not $KeepRunning) {
        Set-Location -LiteralPath $repo
        Remove-TestStack
    } else {
        Write-Host 'Leaving the stack running (-KeepRunning). Remove it with -TearDownOnly.' -ForegroundColor Yellow
    }
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'STACK TEST: ALL STEPS PASSED' -ForegroundColor Green
    exit 0
}
Write-Host "STACK TEST: $failed STEP(S) FAILED. Logs: $logDir" -ForegroundColor Red
exit 1
