<#
.SYNOPSIS
  Helpers shared by the scripts in this folder (Start.ps1, Status.ps1, Backup.ps1, Cal.ps1).
  Not run by itself: the other scripts dot-source it.

.NOTES
  Written for Windows PowerShell 5.1 (the powershell.exe that ships with Windows). ASCII only.
  Things that differ from newer PowerShell and are respected here:
    - $PSScriptRoot is empty inside param() defaults when a script runs under -File, so scripts
      set their defaults inside the body.
    - "powershell -File x.ps1 -Names A,B" passes ONE string "A,B", so list parameters are
      split on commas by the script that takes them.
    - 2>&1 on a native command turns each stderr line into an error record, so logs are read
      through cmd /c "... 2>&1".
    - 2>$null on a native command does the same before it discards them, which stops a script
      when $ErrorActionPreference is 'Stop' (a profile may set it). Invoke-Quiet runs such
      commands with 'Continue' for itself.
    - Set-Content -Encoding UTF8 writes a byte order mark, so env files are written with
      [System.IO.File]::WriteAllText and a UTF8Encoding that has none.
#>

$script:DeployDir = $PSScriptRoot

function Fail([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

function Step([string]$msg) {
    Write-Host ""
    Write-Host "== $msg" -ForegroundColor Cyan
}

# The compose files. docker-compose.override.yml is optional: it holds the address pools of a
# computer that has run out of them, or the settings of a test run. git ignores it.
function Get-ComposeFiles {
    $files = @('-f', 'docker-compose.yml')
    if (Test-Path -LiteralPath (Join-Path $script:DeployDir 'docker-compose.override.yml')) {
        $files += @('-f', 'docker-compose.override.yml')
    }
    return $files
}

# docker compose with the compose files of this folder. The exit code is left in $LASTEXITCODE.
function Invoke-Compose {
    $files = Get-ComposeFiles
    docker compose @files @args
}

# Runs a native command, or a function around one such as Invoke-Compose, with its output and its
# error stream discarded. The exit code is left in $LASTEXITCODE. Safe under any
# $ErrorActionPreference of the caller: the preference set here is local to this function.
function Invoke-Quiet {
    $ErrorActionPreference = 'Continue'
    $command = $args[0]
    $rest = @()
    if ($args.Count -gt 1) { $rest = @($args[1..($args.Count - 1)]) }
    & $command @rest 2>$null | Out-Null
}

function Test-DockerRunning {
    $ver = docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0 -or -not $ver) {
        Fail 'Docker is not running. Start Docker Desktop, wait until it says "running", and try again.'
    }
    return "$ver"
}

# Writes an env file as UTF-8 without a byte order mark and with plain line feeds.
function Write-EnvFile([string]$path, [string[]]$lines) {
    $text = ($lines -join "`n") + "`n"
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $text, $enc)
}

# The value of NAME in an env file, or '' when the file or the line is missing.
function Get-EnvValue([string]$path, [string]$name) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    $pattern = '^\s*' + [regex]::Escape($name) + '\s*='
    $line = Get-Content -LiteralPath $path | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if (-not $line) { return '' }
    return ($line -split '=', 2)[1].Trim().Trim('"', "'")
}

# A setting that Compose also reads: the environment first, then .env, then the default.
function Get-ComposeSetting([string]$name, [string]$default) {
    $fromEnv = [Environment]::GetEnvironmentVariable($name)
    if ($fromEnv) { return $fromEnv }
    $fromFile = Get-EnvValue (Join-Path $script:DeployDir '.env') $name
    if ($fromFile) { return $fromFile }
    return $default
}

# A folder named in a setting, made absolute against this folder when it is relative.
function Resolve-DeployFolder([string]$path) {
    if ([System.IO.Path]::IsPathRooted($path)) { return $path }
    return [System.IO.Path]::GetFullPath((Join-Path $script:DeployDir $path))
}

# Restricts a file or folder to the current user, SYSTEM and Administrators (by SID, so it works
# on any Windows language). Children of a folder are reset to inherit from it.
function Protect-Path([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $isDir = (Get-Item -LiteralPath $path).PSIsContainer
    $inh = ''
    if ($isDir) { $inh = '(OI)(CI)' }
    icacls $path /inheritance:r /grant:r "${me}:${inh}F" "*S-1-5-18:${inh}F" "*S-1-5-32-544:${inh}F" /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  warning: could not lock $path" -ForegroundColor Yellow
        return
    }
    if ($isDir -and (Get-ChildItem -LiteralPath $path -Force | Select-Object -First 1)) {
        icacls (Join-Path $path '*') /reset /T /C /Q | Out-Null
    }
    Write-Host "  locked $path"
}

# A random password of letters and digits (no look-alikes), from the system random generator.
function New-RandomText([int]$length) {
    $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $limit = 256 - (256 % $chars.Length)
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $buffer = New-Object byte[] 1
    $out = New-Object System.Text.StringBuilder
    while ($out.Length -lt $length) {
        $rng.GetBytes($buffer)
        if ($buffer[0] -lt $limit) { [void]$out.Append($chars[$buffer[0] % $chars.Length]) }
    }
    $rng.Dispose()
    return $out.ToString()
}

# The base64 of 32 random bytes (the key that encrypts saved AI keys).
function New-SecretKey {
    $bytes = New-Object byte[] 32
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return [Convert]::ToBase64String($bytes)
}

function ConvertTo-Base64Url([byte[]]$bytes) {
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# A Web Push (VAPID) key pair on curve P-256, both halves base64url: the public key is the
# uncompressed point (65 bytes), the private key the 32-byte scalar. Same format as
# "node dist/cal.mjs vapid".
function New-VapidKeys {
    $curve = [System.Security.Cryptography.ECCurve]::CreateFromValue('1.2.840.10045.3.1.7')
    $ec = [System.Security.Cryptography.ECDsa]::Create($curve)
    $p = $ec.ExportParameters($true)
    $ec.Dispose()
    $pub = New-Object byte[] 65
    $pub[0] = 4
    [Array]::Copy($p.Q.X, 0, $pub, 1, 32)
    [Array]::Copy($p.Q.Y, 0, $pub, 33, 32)
    # The scalar is always 32 bytes; pad on the left if a framework version ever trims zeros.
    $d = New-Object byte[] 32
    [Array]::Copy($p.D, 0, $d, 32 - $p.D.Length, $p.D.Length)
    return @{ Public = (ConvertTo-Base64Url $pub); Private = (ConvertTo-Base64Url $d) }
}
