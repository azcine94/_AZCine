param([ValidateSet('inspect','invoke')][string]$Action='inspect',[string]$Name='')
$ErrorActionPreference='Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$expectedBinary = Join-Path $workspaceRoot 'app/src-tauri/target/debug/azcine.exe'
$owned = @(Get-CimInstance Win32_Process -Filter "Name = 'azcine.exe'" | Where-Object { $_.ExecutablePath -eq $expectedBinary })
if ($owned.Count -ne 1) { throw 'Expected exactly one normal desktop process for this Worktree.' }
$windowHandle = & (Join-Path $PSScriptRoot 'find-native-window.ps1') -OwnerPid $owned[0].ProcessId
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$windowRoot = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
if ($Action -eq 'invoke') {
  $allowedNames = @('设置','还原窗口','资讯','采集资料','清空采集与全部资讯','确认清空','手动采集','处理与记录','当前筛选全部')
  if ($Name -notin $allowedNames -and $Name -notmatch '^整理当前范围 [0-9]+ 条$') { throw 'Only the explicitly authorized news actions are supported.' }
  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$Name)
  $matches = @($windowRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition))
  $matches = @($matches | Where-Object { $_.Current.ControlType -in @([System.Windows.Automation.ControlType]::Button,[System.Windows.Automation.ControlType]::Hyperlink) })
  # The sidebar and page header link to the same fixed news destination.
  # Never relax uniqueness for destructive actions or task submission.
  if ($matches.Count -eq 2 -and $Name -in @('采集资料','处理与记录')) { $matches = @($matches[0]) }
  if ($matches.Count -ne 1) { throw "Expected exactly one matching action: $Name; found $($matches.Count)." }
  if (-not $matches[0].Current.IsEnabled) { throw 'Action is disabled; no operation performed.' }
  if ($Name -eq '确认清空') {
    $titleCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'清空采集与全部资讯？')
    if ($null -eq $windowRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$titleCondition)) { throw 'Expected news-only full-reset confirmation title.' }
  }
  $pattern = $null
  if ($matches[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
    $pattern.Invoke()
  } elseif ($Name -eq '当前筛选全部' -and $matches[0].TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) {
    if ($pattern.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) { $pattern.Toggle() }
  } else { throw 'Action has no supported activation pattern; no operation performed.' }
  [pscustomobject]@{ owner=$owned[0].ProcessId; action=$Name; invoked=$true } | ConvertTo-Json
} else {
  $all = $windowRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $all | ForEach-Object {
    $value=$_.Current.Name
    if ($value -match '^(AZCine ·|全部报道|精选报道|资讯|清空|将删除|同时删除|保留全部|已清空|采集范围|最近24小时|手动采集|正在采集|整理当前范围|当前筛选全部|待处理资料|处理状态|处理失败|已完成|任务进行中|本次范围|本次耗时|当前批次|已保存资料|收到模型文本|使用模型|LYAPI|最近一次任务|当前任务|没有符合|正在准备|模型请求|复用|未报告|已有资讯|已有一轮|已请求取消)' -or $value -match '条已保存资料|^\d+\s*/\s*\d+$') {
      [pscustomobject]@{ name=$value; type=$_.Current.ControlType.ProgrammaticName; enabled=$_.Current.IsEnabled }
    }
  } | ConvertTo-Json -Depth 3
}
