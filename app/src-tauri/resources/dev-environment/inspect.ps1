param([Parameter(Mandatory=$true)][string]$RequestFile)
. (Join-Path $PSScriptRoot 'common.ps1')
try {
    $request = Read-Json $RequestFile
    $result = Discover $request
    $result | ConvertTo-Json -Depth 20 -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
