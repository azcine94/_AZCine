param(
    [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$OwnerPid,
    [ValidateSet('inspect','cancel','select')][string]$Action = 'inspect',
    [string]$FolderPath
)
$ErrorActionPreference = 'Stop'
# Run standalone, preferably powershell.exe -NoProfile -NonInteractive -MTA -File ...
# Caller retains stdout/stderr under artifacts/validation/<run-id>.
# No test directories, report files, or cleanup operations are created here.
# Caller should also set a process timeout in case an OS UIA provider blocks.
$result = [ordered]@{
    success=$false; action=$Action; ownerPid=$OwnerPid; handle=$null; title=$null
    requestedFolder=$null; uiaAvailable=$false; controls=@(); uiaError=$null
    valueWritten=$false; invokeAttempted=$false; closePosted=$false
    dialogClosed=$false; selectionVerified=$false; outcome=$null; error=$null
}
$state = @{ Process=$null; Handle=[IntPtr]::Zero; Snapshot=$null }

function Resolve-TestFolder([string]$Path) {
    $base = 'E:\Coding_Work\_AZCine\artifacts\validation\'
    if ($Path -notmatch '\A[Ee]:[\\/]') {
        throw 'FolderPath must be an absolute E: path.'
    }
    foreach ($part in ($Path.Substring(3) -split '[\\/]')) {
        if ($part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or
            $part.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
            throw 'FolderPath contains an ambiguous or invalid component.'
        }
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char]'\')
    if (-not $full.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'FolderPath must be below artifacts/validation, not the validation root.'
    }
    # Existing directories only; reject junction/symlink escapes, including ancestors.
    $cursor = [IO.Path]::GetPathRoot($full)
    foreach ($part in $full.Substring($cursor.Length).Split([char]'\')) {
        $cursor = [IO.Path]::Combine($cursor,$part)
        $attributes = [IO.File]::GetAttributes($cursor)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            ($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
            throw 'FolderPath must use existing ordinary directories, without reparse points.'
        }
    }
    return $full
}

function Assert-Owner {
    $state.Process.Refresh()
    if ($state.Process.HasExited) {
        throw 'The original owned AZCine process exited.'
    }
}

function Assert-Dialog {
    Assert-Owner
    $matches = @([AZCineFolderPickerNative]::Find([uint32]$OwnerPid))
    if ($matches.Count -ne 1 -or $matches[0] -ne $state.Handle) {
        throw 'The original uniquely matched folder dialog is no longer available.'
    }
}

function Wait-Condition([scriptblock]$Condition,[string]$Description) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        Assert-Owner
        if (& $Condition) { return }
        if ($watch.ElapsedMilliseconds -ge 8000) {
            throw "Timed out waiting for $Description."
        }
        # Poll only after the actual condition failed; never sleep and assume success.
        Start-Sleep -Milliseconds 80
    }
}

function Get-ControlLabel([string]$Name) {
    return ($Name -replace '&','' -replace '\([A-Za-z]\)','' -replace '[:\uFF1A]\s*$','').Trim()
}

function Read-Controls {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($state.Handle)
    if ($root.Current.ProcessId -ne $OwnerPid) { throw 'UIA root PID mismatch.' }
    $pidFilter = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,$OwnerPid)
    $typeFilter = [System.Windows.Automation.OrCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit),
        [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button))
    $filter = [System.Windows.Automation.AndCondition]::new($pidFilter,$typeFilter)
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$filter)
    $controls = @(); $edits = @(); $buttons = @()
    foreach ($element in $elements) {
        $current = $element.Current
        if ($current.ProcessId -ne $OwnerPid) { continue }
        $isEdit = $current.ControlType -eq [System.Windows.Automation.ControlType]::Edit
        $patternId = [System.Windows.Automation.InvokePattern]::Pattern
        if ($isEdit) { $patternId = [System.Windows.Automation.ValuePattern]::Pattern }
        $pattern = $null
        $available = $element.TryGetCurrentPattern($patternId,[ref]$pattern)
        $controls += [ordered]@{
            name=$current.Name; automationId=$current.AutomationId
            type=$current.ControlType.ProgrammaticName; processId=$current.ProcessId
            enabled=$current.IsEnabled; offscreen=$current.IsOffscreen
            pattern=$patternId.ProgrammaticName; patternAvailable=$available
        }
        # Metadata only: do not log edit values, list items, or file contents.
        if (-not $available -or -not $current.IsEnabled -or $current.IsOffscreen) { continue }
        $label = Get-ControlLabel $current.Name
        if ($isEdit -and -not $pattern.Current.IsReadOnly -and
            $label -match '^(Folder|File name|\u6587\u4ef6\u5939|\u6587\u4ef6\u540d|\u8cc7\u6599\u593e|\u6a94\u6848\u540d\u7a31)$') {
            $edits += [pscustomobject]@{ Element=$element; Pattern=$pattern }
        }
        if (-not $isEdit -and $current.AutomationId -eq '1' -and
            $label -match '^(Select Folder|\u9009\u62e9\u6587\u4ef6\u5939|\u9078\u64c7\u8cc7\u6599\u593e|\u9078\u53d6\u8cc7\u6599\u593e)$') {
            $buttons += [pscustomobject]@{ Element=$element; Pattern=$pattern }
        }
    }
    $result.controls = $controls
    return [pscustomobject]@{ Edits=$edits; Buttons=$buttons }
}

function Update-Controls {
    Assert-Dialog
    try {
        $state.Snapshot = Read-Controls
        $result.uiaError = $null
        return $true
    } catch {
        $state.Snapshot = $null
        $result.uiaError = $_.Exception.Message
        return $false
    }
}

function Test-SelectControls {
    if (-not (Update-Controls)) { return $false }
    return ($state.Snapshot.Edits.Count -eq 1 -and $state.Snapshot.Buttons.Count -eq 1)
}

function Assert-Control($Element) {
    Assert-Dialog
    $current = $Element.Current
    if ($current.ProcessId -ne $OwnerPid -or -not $current.IsEnabled -or $current.IsOffscreen) {
        throw 'The matched control is no longer an enabled, visible owned control.'
    }
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Windows is required.'
    }
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    if ($FolderPath) { $result.requestedFolder = Resolve-TestFolder $FolderPath }
    if ($Action -eq 'select' -and -not $result.requestedFolder) {
        throw 'select requires FolderPath.'
    }
    $state.Process = Get-Process -Id $OwnerPid -ErrorAction Stop
    # Pin the original process handle: never follow a reused PID after process exit.
    [void]$state.Process.Handle
    $image = $state.Process.Path
    if ($state.Process.ProcessName -ine 'azcine' -or [string]::IsNullOrEmpty($image) -or
        [IO.Path]::GetFileName($image) -ine 'azcine.exe' -or
        -not ([IO.Path]::GetFullPath($image).StartsWith(
            'E:\Coding_Work\_AZCine\',[StringComparison]::OrdinalIgnoreCase))) {
        throw 'OwnerPid is not an AZCine executable from this project.'
    }
    if (-not ('AZCineFolderPickerNative' -as [type])) {
        Add-Type @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class AZCineFolderPickerNative {
    public const string Title = "\u9009\u62e9 AZCine \u6570\u636e\u76ee\u5f55";
    private delegate bool Callback(IntPtr h, IntPtr data);
    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    private static extern int GetClassName(IntPtr h, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    public static bool Matches(IntPtr h, uint owner) {
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid != owner || !IsWindowVisible(h)) return false;
        var text = new StringBuilder(512);
        var kind = new StringBuilder(64);
        GetWindowText(h, text, text.Capacity);
        GetClassName(h, kind, kind.Capacity);
        return text.ToString() == Title && kind.ToString() == "#32770";
    }
    public static IntPtr[] Find(uint owner) {
        var found = new List<IntPtr>();
        if (!EnumWindows((h,d) => {
            if (Matches(h,owner)) found.Add(h);
            return true;
        }, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return found.ToArray();
    }
    public static void Cancel(IntPtr h, uint owner) {
        if (!Matches(h,owner))
            throw new InvalidOperationException("Dialog ownership/title changed.");
        if (!PostMessage(h,0x0010,IntPtr.Zero,IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
    }
    Wait-Condition {
        $found = @([AZCineFolderPickerNative]::Find([uint32]$OwnerPid))
        if ($found.Count -gt 1) {
            throw 'More than one matching owned folder dialog; refusing ambiguity.'
        }
        if ($found.Count -eq 0) { return $false }
        $state.Handle = $found[0]
        return $true
    } 'the uniquely titled owned folder dialog'
    $result.handle = $state.Handle.ToInt64()
    $result.title = [AZCineFolderPickerNative]::Title
    try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $result.uiaAvailable = $true
    } catch { $result.uiaError = $_.Exception.Message }

    if ($Action -eq 'inspect') {
        if ($result.uiaAvailable) {
            Wait-Condition {
                (Update-Controls) -and $result.controls.Count -gt 0
            } 'owned UIA controls'
            $result.outcome = 'dialog-and-controls-observed'
        } else {
            $result.outcome = 'native-dialog-observed-uia-unavailable'
        }
    } elseif ($Action -eq 'cancel') {
        if ($result.uiaAvailable) { [void](Update-Controls) }
        Assert-Dialog
        [AZCineFolderPickerNative]::Cancel($state.Handle,[uint32]$OwnerPid)
        $result.closePosted = $true
        Wait-Condition {
            -not [AZCineFolderPickerNative]::IsWindow($state.Handle)
        } 'matched dialog destruction'
        $result.dialogClosed = $true
        $result.outcome = 'wm-close-posted-dialog-closed'
    } else {
        if (-not $result.uiaAvailable) {
            throw 'Selection unavailable: UIAutomation assemblies could not load.'
        }
        Wait-Condition {
            Test-SelectControls
        } 'one writable File name/Folder edit and Select Folder button'
        # No coordinate, SendKeys, address-bar, guessed-ID, or repeated-click fallback.
        $folder = Resolve-TestFolder $result.requestedFolder
        $edit = $state.Snapshot.Edits[0]
        Assert-Control $edit.Element
        $edit.Pattern.SetValue($folder)
        $result.valueWritten = $true
        Wait-Condition {
            if (-not (Test-SelectControls)) { return $false }
            try {
                return [string]::Equals(
                    $state.Snapshot.Edits[0].Pattern.Current.Value,
                    $folder,[StringComparison]::OrdinalIgnoreCase)
            } catch {
                $result.uiaError = $_.Exception.Message
                return $false
            }
        } 'the supplied directory to be read back from the Folder edit'
        $button = $state.Snapshot.Buttons[0]
        [void](Resolve-TestFolder $folder)
        if (-not [string]::Equals(
            $state.Snapshot.Edits[0].Pattern.Current.Value,
            $folder,[StringComparison]::OrdinalIgnoreCase)) {
            throw 'Folder edit changed before Invoke.'
        }
        Assert-Control $button.Element
        $result.invokeAttempted = $true
        $button.Pattern.Invoke()
        Wait-Condition {
            -not [AZCineFolderPickerNative]::IsWindow($state.Handle)
        } 'dialog destruction after Select Folder'
        $result.dialogClosed = $true
        $result.outcome = 'select-invoked-dialog-closed'
        # Closure proves only this UI action; the parent must assert the returned
        # path and preserved input in AZCine. It does not prove a saved data root.
    }
    $result.success = $true
} catch {
    $result.error = $_.Exception.Message
} finally {
    if ($null -ne $state.Process) { $state.Process.Dispose() }
}
$result | ConvertTo-Json -Depth 6 -Compress
if (-not $result.success) { exit 1 }
