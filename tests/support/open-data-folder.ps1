param([Parameter(Mandatory=$true)][string]$FolderPath,[ValidateSet('before','verify-and-close')][string]$Action='before',[Parameter(Mandatory=$true)][string]$Receipt)
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../artifacts/validation'))
$Folder=[IO.Path]::GetFullPath($FolderPath)
if(-not $Folder.StartsWith($Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Only isolated validation directory may be inspected.'}
if(-not [IO.Path]::GetFullPath($Receipt).StartsWith($Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Receipt outside validation tree.'}
function Matching-Windows {
  $Shell=New-Object -ComObject Shell.Application
  @($Shell.Windows() | ForEach-Object {
    try {
      $Uri=[Uri]$_.LocationURL
      if($Uri.IsFile -and [IO.Path]::GetFullPath($Uri.LocalPath).TrimEnd('\') -eq $Folder.TrimEnd('\')) { [pscustomobject]@{handle=[long]$_.HWND; window=$_; path=$Uri.LocalPath} }
    } catch { }
  })
}
if($Action -eq 'before') {
  [ordered]@{folder=$Folder;handles=@(Matching-Windows | ForEach-Object {$_.handle});time=(Get-Date -Format o)} | ConvertTo-Json | Out-File -Encoding utf8 -NoClobber $Receipt
  Get-Content $Receipt
} else {
  $Before=Get-Content $Receipt -Raw|ConvertFrom-Json
  $Deadline=[DateTime]::UtcNow.AddSeconds(15)
  do {
    $Windows=@(Matching-Windows)
    if($Windows.Count){break}
    # Conditional bounded native UI discovery, not a sleep-based success assertion.
    [Threading.Thread]::Sleep(100)
  }while([DateTime]::UtcNow -lt $Deadline)
  if(-not $Windows.Count){throw 'No Explorer window reached the exact requested test folder.'}
  $New=@($Windows|Where-Object {$_.handle -notin $Before.handles})
  foreach($Item in $New){$Item.window.Quit()}
  [ordered]@{passed=$true;folder=$Folder;observed=@($Windows|ForEach-Object {$_.handle});closedOnlyNew=@($New|ForEach-Object {$_.handle});existingLeftAlone=@($Before.handles)}|ConvertTo-Json
}
