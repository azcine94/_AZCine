param([Parameter(Mandatory=$true)][int]$OwnerPid)
$ErrorActionPreference = 'Stop'
if (-not ('AZCineOwnedWindow' -as [type])) {
Add-Type @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class AZCineOwnedWindow {
  public delegate bool Callback(IntPtr handle,IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback,IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle,out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle,StringBuilder text,int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  public static IntPtr[] Find(uint owner) {
    var windows = new List<IntPtr>();
    EnumWindows((h,d) => { uint pid; GetWindowThreadProcessId(h,out pid); if(pid==owner && IsWindowVisible(h)) { var text=new StringBuilder(512); GetWindowText(h,text,512); if(text.ToString().StartsWith("AZCine")) windows.Add(h); } return true; },IntPtr.Zero);
    return windows.ToArray();
  }
}
'@
}
$Process = Get-Process -Id $OwnerPid
if ($Process.ProcessName -ne 'azcine') { throw 'Target PID is not AZCine.' }
$Windows = @([AZCineOwnedWindow]::Find($OwnerPid))
if ($Windows.Count -ne 1) { throw "Expected one titled AZCine window for owned PID, got $($Windows.Count)." }
$Windows[0]
