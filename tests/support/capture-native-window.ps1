param([Parameter(Mandatory=$true)][int]$OwnerPid, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AZCineCapture {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
$Process = Get-Process -Id $OwnerPid
if ($Process.ProcessName -ne 'azcine') { throw 'Target PID is not AZCine.' }
$Handle = & (Join-Path $PSScriptRoot 'find-native-window.ps1') -OwnerPid $OwnerPid
$OldContext = [AZCineCapture]::SetThreadDpiAwarenessContext([IntPtr](-4))
$Bitmap = $null
$Graphics = $null
try {
    $Rect = New-Object AZCineCapture+Rect
    if (-not [AZCineCapture]::GetWindowRect($Handle,[ref]$Rect)) { throw 'Window bounds unavailable.' }
    $Bitmap = New-Object System.Drawing.Bitmap(($Rect.Right-$Rect.Left),($Rect.Bottom-$Rect.Top))
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    $Dc = $Graphics.GetHdc()
    try { if (-not [AZCineCapture]::PrintWindow($Handle,$Dc,2)) { throw 'Native PrintWindow failed.' } }
    finally { $Graphics.ReleaseHdc($Dc) }
    $Bitmap.Save($Output,[System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $Output
} finally {
    if ($Graphics) { $Graphics.Dispose() }
    if ($Bitmap) { $Bitmap.Dispose() }
    [void][AZCineCapture]::SetThreadDpiAwarenessContext($OldContext)
}
