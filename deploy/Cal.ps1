<#
.SYNOPSIS
  Accounts and food data for Cal. Run ON THE SERVER from the deploy folder while the app runs.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Cal.ps1 invite --admin --note first-admin
  powershell -ExecutionPolicy Bypass -File .\Cal.ps1 invite --note guest
  powershell -ExecutionPolicy Bypass -File .\Cal.ps1 users
  powershell -ExecutionPolicy Bypass -File .\Cal.ps1 reset alex
  powershell -ExecutionPolicy Bypass -File .\Cal.ps1 import-fdc
  powershell -ExecutionPolicy Bypass -File .\Cal.ps1 seed-dishes

.DESCRIPTION
  Passes everything to the server tool inside the app container (node dist/cal.mjs, the bundled
  scripts/cal.mjs). Run it without arguments for the list of commands:
    invite, reset, users, unlock, admin, disable, enable, invites, import-fdc, seed-dishes, vapid.
  import-fdc downloads the USDA FoodData Central files through the egress proxy into the
  fdc-cache volume and checks each file's SHA-256; run seed-dishes after it.
#>
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'Common.ps1')

Invoke-Compose exec -T app node dist/cal.mjs @args
exit $LASTEXITCODE
