<#
.SYNOPSIS
  Backs up Cal: a database dump, the secret keys that go with it, and the photos. Run ON THE
  SERVER from the deploy folder while the stack runs.

.DESCRIPTION
  1. Dumps the database with pg_dump inside the db container (a dump is always consistent, so
     there is no downtime) into backups\cal-db-<date>.dump.
  2. Copies app.env (the key that encrypts the saved AI keys) and vapid.env next to the dump:
     a restored database cannot read the saved keys without app.env. If a copy already exists
     with different content, the old copy is kept under another name.
  3. Copies the photo folder to backups\photos with robocopy. Only new files are copied and
     nothing is ever removed from the copy, so photos a person deleted in Cal stay in the
     backup (photos are never changed once written).
  4. With -Destination, the same three things are also copied to that folder (another disk or a
     share).

  Nothing is deleted unless -Keep is given.

.PARAMETER Destination
  Extra folder for a copy of the dump, the key files and the photos.

.PARAMETER Keep
  If given, keeps only the newest N database dumps in backups\ (and in Destination) and deletes
  the older dumps. The photo copies are never pruned.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Backup.ps1
  powershell -ExecutionPolicy Bypass -File .\Backup.ps1 -Destination X:\Backups\Cal -Keep 14
#>
[CmdletBinding()]
param(
    [string]$Destination = '',
    [int]$Keep = 0
)

Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'Common.ps1')

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "cal-db-$stamp.dump"
$backups = Resolve-DeployFolder (Get-ComposeSetting 'CAL_BACKUP_DIR' './backups')
$photos = Resolve-DeployFolder (Get-ComposeSetting 'CAL_PHOTOS_DIR' './photos')
New-Item -ItemType Directory -Force -Path $backups | Out-Null

# Custom format: compressed, restorable with pg_restore. Written by the database container
# straight into backups\ (mounted at /backups), so no binary data passes through PowerShell.
Invoke-Compose exec -T db pg_dump -Fc -f "/backups/$name"
if ($LASTEXITCODE -ne 0) { Fail 'pg_dump failed (is the stack running?).' }

$dump = Join-Path $backups $name
if (-not (Test-Path -LiteralPath $dump) -or (Get-Item -LiteralPath $dump).Length -eq 0) {
    Fail "$dump is missing or empty."
}
$sizeKB = [math]::Round((Get-Item -LiteralPath $dump).Length / 1KB, 1)
Write-Host "Backup written: $dump ($sizeKB KB)" -ForegroundColor Green
Write-Host 'It holds the password fingerprints (scrypt hashes) and every meal: keep it somewhere private.'

$folders = @($backups)
if ($Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -LiteralPath $dump -Destination $Destination
    Write-Host "Dump copied to $Destination"
    $folders += $Destination
}

# The keys that go with the dump. An existing copy with other content is kept under a new name.
foreach ($f in $folders) {
    foreach ($file in 'app.env', 'vapid.env') {
        $source = Join-Path $PSScriptRoot $file
        if (-not (Test-Path -LiteralPath $source)) { continue }
        $target = Join-Path $f $file
        if (Test-Path -LiteralPath $target) {
            $same = (Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $target).Hash
            if ($same) { continue }
            Move-Item -LiteralPath $target -Destination "$target.$stamp"
        }
        Copy-Item -LiteralPath $source -Destination $target
    }
}
Write-Host 'app.env and vapid.env (the keys that go with the dump) are next to it.'

# Photos: add what is new, remove nothing (no /MIR, no /PURGE).
if ((Test-Path -LiteralPath $photos) -and (Get-ChildItem -LiteralPath $photos -Force | Select-Object -First 1)) {
    foreach ($f in $folders) {
        $copy = Join-Path $f 'photos'
        robocopy $photos $copy /E /XO /R:1 /W:1 /NFL /NDL /NJH /NP /NS /NC | Out-Null
        if ($LASTEXITCODE -ge 8) { Fail "Copying the photos to $copy failed (robocopy exit code $LASTEXITCODE)." }
        Write-Host "Photos copied to $copy (new files only; nothing is removed there)"
    }
    $global:LASTEXITCODE = 0
} else {
    Write-Host 'No photos yet.'
}

if ($Keep -gt 0) {
    foreach ($f in $folders) {
        Get-ChildItem -LiteralPath $f -Filter 'cal-db-*.dump' |
            Sort-Object Name -Descending | Select-Object -Skip $Keep |
            ForEach-Object { Write-Host "  removing old dump $($_.FullName)"; Remove-Item -LiteralPath $_.FullName }
    }
}
