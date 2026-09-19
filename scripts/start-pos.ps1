[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$clientDirectory = Split-Path -Parent $PSScriptRoot
$apiDirectory = Join-Path (Split-Path -Parent $clientDirectory) 'Apis'
$apiUrl = 'http://127.0.0.1:8000/api/v1/health'
$clientUrl = 'http://127.0.0.1:5173'

function Test-PosService {
    param([string]$Url, [string]$Kind)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        if ($Kind -eq 'api') {
            $health = $response.Content | ConvertFrom-Json
            return $health.status -eq 'ok' -and $health.service -eq 'impulsa-pos-api'
        }
        return $response.StatusCode -eq 200 -and $response.Content -match '<title>Impulsa POS</title>'
    }
    catch { return $false }
}

function Assert-FreePort {
    param([int]$Port)
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "El puerto $Port esta ocupado, pero el POS no responde correctamente. No se detuvo ningun proceso."
    }
}

function Wait-PosService {
    param([string]$Url, [string]$Kind, [System.Diagnostics.Process]$Process, [string]$Log)
    $deadline = (Get-Date).AddSeconds(45)
    do {
        if ($Process.HasExited) {
            throw "No se pudo iniciar $Kind. Revisa el registro local: $Log"
        }
        if (Test-PosService -Url $Url -Kind $Kind) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "El servicio $Kind no esta listo. Revisa el registro local: $Log"
}

$apiReady = Test-PosService -Url $apiUrl -Kind 'api'
$clientReady = Test-PosService -Url $clientUrl -Kind 'client'

# Check both ports and dependencies before starting either service; never kill other apps.
if (-not $apiReady) {
    Assert-FreePort -Port 8000
    if (-not (Test-Path -LiteralPath (Join-Path $apiDirectory 'main.py'))) {
        throw 'No se encontro Apis junto a CLIENTES.'
    }
    $python = Join-Path $apiDirectory '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        $python = (Get-Command python.exe -ErrorAction Stop).Source
    }
}
if (-not $clientReady) {
    Assert-FreePort -Port 5173
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath (Join-Path $clientDirectory 'node_modules/vite/bin/vite.js'))) {
        throw 'Faltan dependencias de CLIENTES. Ejecuta npm install y vuelve a iniciar el POS.'
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
if (-not $apiReady) {
    $apiLog = Join-Path $apiDirectory "pos-api-$stamp-error.log"
    Write-Host 'Iniciando API y comprobando su conexion...'
    $apiProcess = Start-Process -FilePath $python -WorkingDirectory $apiDirectory -WindowStyle Hidden -PassThru `
        -ArgumentList '-m uvicorn main:app --reload --host 127.0.0.1 --port 8000 --log-level warning --no-access-log' `
        -RedirectStandardOutput (Join-Path $apiDirectory "pos-api-$stamp.log") -RedirectStandardError $apiLog
    Wait-PosService -Url $apiUrl -Kind 'api' -Process $apiProcess -Log $apiLog
}

if (-not $clientReady) {
    $clientLog = Join-Path $clientDirectory "pos-client-$stamp-error.log"
    Write-Host 'Iniciando CLIENTES...'
    $clientProcess = Start-Process -FilePath $node -WorkingDirectory $clientDirectory -WindowStyle Hidden -PassThru `
        -ArgumentList 'node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort' `
        -RedirectStandardOutput (Join-Path $clientDirectory "pos-client-$stamp.log") -RedirectStandardError $clientLog
    Wait-PosService -Url $clientUrl -Kind 'client' -Process $clientProcess -Log $clientLog
}

if (-not (Test-PosService -Url $apiUrl -Kind 'api')) {
    throw 'La API dejo de responder durante el arranque. No se confirmo el acceso al POS.'
}
Write-Host "POS listo: $clientUrl/pedidos"
Write-Host 'Los servicios quedan en segundo plano. Puedes cerrar esta terminal.'
