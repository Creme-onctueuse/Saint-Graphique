# Installation idempotente de l'environnement Saint-Graphique (Windows).
# Usage : powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 [-SkipSystem] [-SkipVSCodeExt] [-NoResearch]
# (fichier volontairement en ASCII : Windows PowerShell 5.1 lit les .ps1 sans BOM en ANSI)
param([switch]$SkipSystem, [switch]$SkipVSCodeExt, [switch]$NoResearch)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

if (-not $SkipSystem) {
    $pkgs = 'Git.Git', 'OpenJS.NodeJS.LTS', 'Python.Python.3.12', 'Gyan.FFmpeg',
            'Microsoft.VisualStudioCode', 'astral-sh.uv'
    foreach ($p in $pkgs) {
        $installed = winget list --id $p -e --accept-source-agreements | Select-String -SimpleMatch $p
        if ($installed) { Write-Host "[ok] $p" }
        else {
            Write-Host "[install] $p"
            winget install --id $p -e --silent --accept-package-agreements --accept-source-agreements
        }
    }
    Update-SessionPath
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host '[install] pnpm'
    npm install -g pnpm@9
    Update-SessionPath
}

if (-not $SkipVSCodeExt -and (Get-Command code -ErrorAction SilentlyContinue)) {
    $exts = 'ms-python.python', 'charliermarsh.ruff', 'dbaeumer.vscode-eslint',
            'esbenp.prettier-vscode', 'vitest.explorer', 'ritwickdey.LiveServer',
            'redhat.vscode-yaml', 'editorconfig.editorconfig'
    $have = code --list-extensions
    foreach ($e in $exts) { if ($have -notcontains $e) { code --install-extension $e --force } }
}

Push-Location $root
try {
    if ($NoResearch) { Write-Host '[python] uv sync (dev)'; uv sync --extra dev }
    else { Write-Host '[python] uv sync (dev + research)'; uv sync --all-extras }
    if (Test-Path web/package.json) {
        Write-Host '[web] pnpm install'
        Push-Location web; pnpm install; Pop-Location
    }
} finally { Pop-Location }
Write-Host 'Setup termine.'
