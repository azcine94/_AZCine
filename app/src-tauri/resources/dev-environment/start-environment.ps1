param([ValidateSet('herdr','opi')][string]$Tool='herdr', [switch]$Web, [Parameter(ValueFromRemainingArguments=$true)][string[]]$ToolArgs)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$openpi=Join-Path $root 'openpi'
$runtime=Join-Path $openpi 'runtime'
$env:PATH=@((Join-Path $root 'herdr'),(Join-Path $root 'tools\node'),(Join-Path $root 'tools\git\cmd'),(Join-Path $root 'tools\git\bin'),(Join-Path $root 'tools\powershell'),(Join-Path $openpi 'bin'),(Join-Path $runtime 'node_modules\.bin'),(Join-Path $env:APPDATA 'npm'),$env:PATH) -join ';'
if($Tool -eq 'herdr') {
    & (Join-Path $root 'herdr\herdr.exe') @ToolArgs
} else {
    # Only the launched process gets these settings; persistent host variables stay unchanged.
    $env:PI_CODING_AGENT_DIR=Join-Path $openpi 'agent'
    $env:OPENPI_PI_CODING_AGENT_ENTRY=Join-Path $runtime 'node_modules\@earendil-works\pi-coding-agent\dist\index.js'
    $env:NODE_OPTIONS=''; $env:NODE_PATH=''
    $node=Join-Path $root 'tools\node\node.exe'
    if($ToolArgs.Count -gt 0 -and $ToolArgs[0] -eq 'web'){
        $Web=$true
        $ToolArgs=@($ToolArgs | Select-Object -Skip 1)
    }
    if($Web) {
        & $node (Join-Path $runtime 'node_modules\@tt-a1i\openpi\bin\openpi.js') web (Get-Location).Path @ToolArgs
    } else {
        $packageRoot=Join-Path $runtime 'node_modules\@earendil-works\pi-coding-agent'
        $package=Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json
        $entry=if($package.bin -is [string]){$package.bin}else{$package.bin.pi}
        if(-not $entry -or $entry -match '(^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$))'){throw 'Pi 启动入口不正确。'}
        & $node (Join-Path $packageRoot $entry) @ToolArgs
    }
}
exit $LASTEXITCODE
