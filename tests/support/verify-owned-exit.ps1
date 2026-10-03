param(
  [Parameter(Mandatory=$true)][int]$RootPid,
  [Parameter(Mandatory=$true)][int]$OwnerPid,
  [Parameter(Mandatory=$true)][string]$Output,
  [int]$CdpPort = 9223
)
$ErrorActionPreference = 'Stop'
$All = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate
$ById = @{}
foreach($Process in $All) { $ById[[uint32]$Process.ProcessId] = $Process }
if (-not $ById.ContainsKey([uint32]$RootPid)) { throw 'Owned launch root is no longer running.' }
$Owned = [System.Collections.Generic.HashSet[uint32]]::new()
[void]$Owned.Add($RootPid)
do {
  $Changed = $false
  foreach($Process in $All) {
    # A stale ParentProcessId may refer to a reused PID from a newer launch.
    # An older process cannot be a child of that newer parent.
    $Parent = $ById[[uint32]$Process.ParentProcessId]
    if ($Parent -and $Owned.Contains($Parent.ProcessId) -and $Process.CreationDate -ge $Parent.CreationDate -and $Owned.Add($Process.ProcessId)) { $Changed = $true }
  }
} while ($Changed)
if (-not $Owned.Contains($OwnerPid)) { throw 'AZCine PID is not descended from this owned launch root.' }
$Before = @($All | Where-Object { $Owned.Contains($_.ProcessId) })
$Window = & (Join-Path $PSScriptRoot 'native-window.ps1') -OwnerPid $OwnerPid -Action close
$Tracked = foreach($Process in $Before) { Get-Process -Id $Process.ProcessId -ErrorAction SilentlyContinue }
# Wait on actual handles, not a fixed sleep. No killing; the normal WM_CLOSE path must clean itself.
$WaitDiagnostic = $null
if ($Tracked) {
  try { $Tracked | Wait-Process -Timeout 30 -ErrorAction SilentlyContinue }
  catch { $WaitDiagnostic = $_.Exception.Message } # Handle may exit between enumeration and wait; actual process/port checks below decide success.
}
$After = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate
$Remaining = @($After | Where-Object { $Now = $_; $Before | Where-Object { $_.ProcessId -eq $Now.ProcessId -and $_.CreationDate -eq $Now.CreationDate } })
$Ports = @(Get-NetTCPConnection -State Listen -LocalPort 1420,$CdpPort -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)
$Report = [ordered]@{ time=(Get-Date -Format o); operation='native WM_CLOSE; no forced kill'; waitDiagnostic=$WaitDiagnostic; before=$Before; native=($Window|ConvertFrom-Json); remaining=$Remaining; listeningPorts=$Ports; passed=($Remaining.Count -eq 0 -and $Ports.Count -eq 0) }
$Parent = Split-Path $Output -Parent
New-Item -ItemType Directory -Force -Path $Parent | Out-Null
$Report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $Output
$Report | ConvertTo-Json -Depth 6
if (-not $Report.passed) { exit 1 }
