<#
.SYNOPSIS
  Shows whether Kal, its worker, its database, its egress proxy and its Cloudflare tunnel are up.
  Run ON THE SERVER from the deploy folder.
#>
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'Common.ps1')

Invoke-Compose ps -a
Write-Host ''

$health = Invoke-Compose exec -T app wget -qO- -T 5 http://127.0.0.1:3000/api/health
if ($LASTEXITCODE -eq 0 -and "$health" -match '"ok":true') { Write-Host 'App: answering, database connected' -ForegroundColor Green }
else { Write-Host 'App: not answering' -ForegroundColor Yellow }

# Health of the containers that have a health check.
foreach ($svc in 'worker', 'db', 'egress', 'tunnel') {
    $cid = Invoke-Compose ps -aq $svc
    if (-not $cid) { Write-Host "$svc`: not created"; continue }
    $state = docker inspect -f '{{.State.Status}} / {{if .State.Health}}{{.State.Health.Status}}{{else}}no health check{{end}}' "$cid"
    $color = 'Green'
    if ("$state" -notmatch 'running / healthy') { $color = 'Yellow' }
    Write-Host "$svc`: $state" -ForegroundColor $color
}

$users = Invoke-Compose exec -T db psql -tAc 'select count(*) from users'
if ($LASTEXITCODE -eq 0) { Write-Host "Accounts: $("$users".Trim())" }
$foods = Invoke-Compose exec -T db psql -tAc 'select count(*) from foods'
if ($LASTEXITCODE -eq 0) { Write-Host "Foods in the database: $("$foods".Trim())" }
$jobs = Invoke-Compose exec -T db psql -tAc "select count(*) from jobs where status in ('queued','running')"
if ($LASTEXITCODE -eq 0) { Write-Host "Waiting or running jobs: $("$jobs".Trim())" }

# No container may publish a port.
$open = $false
foreach ($cid in (Invoke-Compose ps -aq)) {
    if (-not $cid) { continue }
    $ports = docker inspect -f '{{json .HostConfig.PortBindings}}' "$cid"
    if ($ports -and $ports -ne '{}' -and $ports -ne 'null') {
        $name = docker inspect -f '{{.Name}}' "$cid"
        Write-Host "Published port on $name`: $ports" -ForegroundColor Yellow
        $open = $true
    }
}
if (-not $open) { Write-Host 'No published ports.' }

# The newest database dump.
$backups = Resolve-DeployFolder (Get-ComposeSetting 'CAL_BACKUP_DIR' './backups')
$latest = $null
if (Test-Path -LiteralPath $backups) {
    $latest = Get-ChildItem -LiteralPath $backups -Filter 'cal-db-*.dump' | Sort-Object Name -Descending | Select-Object -First 1
}
if ($latest) {
    $age = [math]::Round(((Get-Date) - $latest.LastWriteTime).TotalDays, 1)
    Write-Host "Newest database backup: $($latest.Name) ($age days old)"
} else {
    Write-Host 'No database backup yet. Run .\Backup.ps1.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Last tunnel log lines:'
$tid = Invoke-Compose ps -aq tunnel
if ($tid) { cmd /c "docker logs --tail 10 $tid 2>&1" } else { Write-Host '  (tunnel container not created yet)' }
