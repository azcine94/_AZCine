param([Parameter(Mandatory=$true)][int]$ConsoleOwnerPid)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AZCineConsoleSignal {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint signal, uint group);
}
'@
# Called only with the PID of a dedicated CREATE_NEW_CONSOLE test launch.
# No signal is sent to the agent's/user's shared console.
[void][AZCineConsoleSignal]::FreeConsole()
if (-not [AZCineConsoleSignal]::AttachConsole($ConsoleOwnerPid)) { throw 'Cannot attach to the owned test console.' }
try {
  if (-not [AZCineConsoleSignal]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)) { throw 'Cannot protect signal sender.' }
  if (-not [AZCineConsoleSignal]::GenerateConsoleCtrlEvent(0,0)) { throw 'Cannot send Ctrl+C to the owned test console.' }
} finally { [void][AZCineConsoleSignal]::FreeConsole() }
