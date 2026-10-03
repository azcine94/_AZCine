param([Parameter(Mandatory=$true)][int]$OwnerPid,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AZCineDrag {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit, Size=40)] public struct Input { [FieldOffset(0)] public uint Type; [FieldOffset(8)] public MouseInput Mouse; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count,Input[] input,int size);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  public static void PointerButton(uint flag) { var input = new Input { Type=0, Mouse=new MouseInput { Flags=flag } }; if(SendInput(1,new[]{input},40)!=1) throw new Exception("Native SendInput refused: "+Marshal.GetLastWin32Error()); }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
}
'@
$Process = Get-Process -Id $OwnerPid
if ($Process.ProcessName -ne 'azcine') { throw 'Not AZCine.' }
$Handle = & (Join-Path $PSScriptRoot 'find-native-window.ps1') -OwnerPid $OwnerPid
$OldContext = [AZCineDrag]::SetThreadDpiAwarenessContext([IntPtr](-4))
$Before = New-Object AZCineDrag+Rect
$After = New-Object AZCineDrag+Rect
$Cursor = New-Object AZCineDrag+Point
[void][AZCineDrag]::GetCursorPos([ref]$Cursor)
$Down = $false
try {
  if (-not [AZCineDrag]::GetWindowRect($Handle,[ref]$Before)) { throw 'Window bounds unavailable.' }
  [void][AZCineDrag]::SetForegroundWindow($Handle)
  if ([AZCineDrag]::GetForegroundWindow() -ne $Handle) { throw 'Owned window is not foreground; refusing pointer input.' }
  $X = [int](($Before.Left+$Before.Right)/2)
  $Y = $Before.Top+16
  $Hit = [AZCineDrag]::SendMessage($Handle,0x84,[IntPtr]::Zero,[IntPtr](($Y -shl 16) -bor ($X -band 0xffff))).ToInt64()
  if ($Hit -ne 2) { throw "Test position is not native caption: hit=$Hit" }
  [void][AZCineDrag]::SetCursorPos($X,$Y)
  Start-Sleep -Milliseconds 100
  [AZCineDrag]::PointerButton(2)
  $Down=$true
  # Real titlebar drag; intervals pace pointer input so the native move loop sees down before motion.
  Start-Sleep -Milliseconds 150
  foreach($Step in 1..8) { [void][AZCineDrag]::SetCursorPos(($X+$Step*8),($Y+$Step*4)); Start-Sleep -Milliseconds 50 }
  [AZCineDrag]::PointerButton(4)
  $Down=$false
  $Watch=[System.Diagnostics.Stopwatch]::StartNew()
  do { [void][AZCineDrag]::GetWindowRect($Handle,[ref]$After); if($After.Left -ne $Before.Left -or $After.Top -ne $Before.Top){break}; Start-Sleep -Milliseconds 20 } while($Watch.Elapsed.TotalSeconds -lt 3)
  $Result=[ordered]@{ ownerPid=$OwnerPid; method='native caption pointer drag'; captionHit=$Hit; before=$Before; after=$After; moved=($After.Left -ne $Before.Left -or $After.Top -ne $Before.Top) }
  $Result|ConvertTo-Json -Depth 4|Set-Content -Encoding utf8 $Output
  $Result|ConvertTo-Json -Depth 4
  if(-not $Result.moved){exit 1}
} finally {
  if($Down){[AZCineDrag]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
  [void][AZCineDrag]::SetCursorPos($Cursor.X,$Cursor.Y)
  [void][AZCineDrag]::SetThreadDpiAwarenessContext($OldContext)
}
