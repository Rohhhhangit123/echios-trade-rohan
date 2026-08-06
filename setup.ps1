$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Join-Path $projectRoot "backend"
$dataRoot = Join-Path $projectRoot "data"
$activePython = if ($env:VIRTUAL_ENV) { Join-Path $env:VIRTUAL_ENV "Scripts\python.exe" } else { "" }
$projectPython = Join-Path $backendRoot "venv\Scripts\python.exe"
$python = if ($activePython -and (Test-Path -LiteralPath $activePython)) {
    $activePython
} elseif (Test-Path -LiteralPath $projectPython) {
    $projectPython
} else {
    (Get-Command python.exe -ErrorAction Stop).Source
}

$csvCount = @(Get-ChildItem -LiteralPath $dataRoot -Recurse -Filter "*.csv" -File -ErrorAction SilentlyContinue).Count
if ($csvCount -eq 0) {
    throw "No CSV files were found under data/. Clone or pull the data corpus first."
}

Push-Location $backendRoot
try {
    Write-Host "Initializing the local SQLite database..."
    & $python seed.py
    if ($LASTEXITCODE -ne 0) { throw "SQLite initialization failed." }

    Write-Host "Building the local assistant embedding index..."
    & $python -m scripts.build_market_vector_index
    if ($LASTEXITCODE -ne 0) { throw "Embedding index creation failed." }
} finally {
    Pop-Location
}

Write-Host "Assistant data setup complete." -ForegroundColor Green
