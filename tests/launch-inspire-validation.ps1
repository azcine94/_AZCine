param([switch]$Reuse)
$ErrorActionPreference = 'Stop'
if ($Reuse) {
    $InspireRun = (Get-Content .tooling/instance/validation-run.txt -Raw).Trim()
    $InspireLaunch = Get-Content (Join-Path $InspireRun 'launch.json') -Raw | ConvertFrom-Json
    $env:AZCINE_CDP_PORT = [string]$InspireLaunch.cdpPort
} else {
    $InspireRun = Join-Path (Get-Location) ('artifacts/validation/inspire-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $InspireRun | Out-Null
    $InspireRun | Set-Content .tooling/instance/validation-run.txt
    $env:AZCINE_CDP_PORT = node --input-type=module -e "import {availablePort} from './scripts/dev-environment.mjs'; console.log(await availablePort());"
    @{run=$InspireRun;cdpPort=[int]$env:AZCINE_CDP_PORT} | ConvertTo-Json | Set-Content (Join-Path $InspireRun 'launch.json')
}
$env:AZCINE_TEST_CONFIG_DIR = Join-Path $InspireRun 'local-config'
$env:AZCINE_TEST_DEFAULT_ROOT = Join-Path $InspireRun 'data'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $InspireRun 'webview'
npm run dev -- --no-watch
exit $LASTEXITCODE
