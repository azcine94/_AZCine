param(
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [ValidateSet('measure','resize','close')][string]$Action = 'measure',
    [int]$Width = 1440,
    [int]$Height = 900
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AZCineNativeWindow {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
$Process = Get-Process -Id $OwnerPid
if ($Process.ProcessName -ne 'azcine') { throw 'Target PID is not the owned AZCine executable.' }
$Handle = & (Join-Path $PSScriptRoot 'find-native-window.ps1') -OwnerPid $OwnerPid
$OldDpiContext = [AZCineNativeWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
    if ($Action -eq 'resize' -and ([AZCineNativeWindow]::IsIconic($Handle) -or [AZCineNativeWindow]::IsZoomed($Handle))) {
        [void][AZCineNativeWindow]::ShowWindow($Handle,9)
        # Wait for Windows to finish restoring before measuring the frame.
        Start-Sleep -Milliseconds 200
    }
    $Outer = New-Object AZCineNativeWindow+Rect
    $Client = New-Object AZCineNativeWindow+Rect
    if (-not [AZCineNativeWindow]::GetWindowRect($Handle,[ref]$Outer)) { throw 'GetWindowRect failed.' }
    if (-not [AZCineNativeWindow]::GetClientRect($Handle,[ref]$Client)) { throw 'GetClientRect failed.' }
    $Scale = [AZCineNativeWindow]::GetDpiForWindow($Handle) / 96.0
    if ($Action -eq 'resize') {
        $NativeWidth = [int][Math]::Round($Width * $Scale) + ($Outer.Right-$Outer.Left) - ($Client.Right-$Client.Left)
        $NativeHeight = [int][Math]::Round($Height * $Scale) + ($Outer.Bottom-$Outer.Top) - ($Client.Bottom-$Client.Top)
        # Keep position and focus; resize this exact owned window, not the display settings.
        if (-not [AZCineNativeWindow]::SetWindowPos($Handle,[IntPtr]::Zero,0,0,$NativeWidth,$NativeHeight,0x16)) { throw 'SetWindowPos failed.' }
    }
    if ($Action -eq 'close') {
        if (-not [AZCineNativeWindow]::PostMessage($Handle,0x10,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'WM_CLOSE failed.' }
    }
    [ordered]@{ ownerPid=$OwnerPid; handle=$Handle.ToInt64(); action=$Action; scale=$Scale; clientWidth=$Client.Right-$Client.Left; clientHeight=$Client.Bottom-$Client.Top; outerWidth=$Outer.Right-$Outer.Left; outerHeight=$Outer.Bottom-$Outer.Top } | ConvertTo-Json -Compress
} finally { [void][AZCineNativeWindow]::SetThreadDpiAwarenessContext($OldDpiContext) }
