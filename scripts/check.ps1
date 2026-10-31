# Verification complete locale : meme chaine que la CI (.github/workflows/ci.yml).
# Usage : powershell -ExecutionPolicy Bypass -File scripts/check.ps1
# (fichier volontairement en ASCII : Windows PowerShell 5.1 lit les .ps1 sans BOM en ANSI)
$ErrorActionPreference = 'Continue'   # les outils natifs signalent les erreurs par code de sortie
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')
$root = Split-Path -Parent $PSScriptRoot
$script:failed = @()

function Step([string]$name, [string]$dir, [scriptblock]$cmd) {
    Write-Host "`n=== $name" -ForegroundColor Cyan
    Push-Location $dir
    try {
        $global:LASTEXITCODE = 0
        & $cmd
        if ($LASTEXITCODE -ne 0) {
            $script:failed += $name
            Write-Host "[ECHEC] $name (code $LASTEXITCODE)" -ForegroundColor Red
        }
    } finally { Pop-Location }
}

Step 'ruff'    $root { uv run ruff check . }
Step 'pytest'  $root { uv run pytest -q }
Step 'schemas' $root { uv run python scripts/validate.py }

$web = Join-Path $root 'web'
if (Test-Path (Join-Path $web 'package.json')) {
    Step 'eslint' $web { pnpm lint }
    Step 'vitest' $web { pnpm test }
    Step 'build'  $web { pnpm build }
} else {
    Write-Host "`n[skip] web/package.json absent : etapes web ignorees" -ForegroundColor Yellow
}

if ($script:failed.Count) {
    Write-Host "`nEchecs : $($script:failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "`nTout est vert." -ForegroundColor Green
exit 0
