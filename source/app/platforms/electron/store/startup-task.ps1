# Spec 010 T030 — Start at Login for the Microsoft Store build (contracts/packaged-runtime.md, research R5).
#
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File startup-task.ps1 get|enable|disable
#
# Talks to the package's own startup task (TaskId ReadmateReaderStartup, declared in appx-extensions.xml) through the
# WinRT Windows.ApplicationModel.StartupTask API. A child process of a packaged app runs with the package identity,
# so GetAsync finds the app's task. Prints exactly ONE line:
#   {"state":"Enabled|Disabled|DisabledByUser|DisabledByPolicy|EnabledByPolicy"}   (exit 0)
#   {"error":"<message>"}                                                         (exit 1)
# Windows PowerShell 5.1 only, no module. Shipped as a real file through extraResources (PowerShell cannot read inside
# app.asar): {resources}/store/startup-task.ps1. Called by background/store-startup-task.ts.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('get', 'enable', 'disable')]
  [string]$Op
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$TaskId = 'ReadmateReaderStartup'

function Write-Line([hashtable]$value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress))
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.ApplicationModel.StartupTask, Windows.ApplicationModel, ContentType = WindowsRuntime]
  $null = [Windows.ApplicationModel.StartupTaskState, Windows.ApplicationModel, ContentType = WindowsRuntime]

  # IAsyncOperation<T> → Task<T> → result (PowerShell cannot await WinRT operations directly).
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Wait-Op($operation, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $null = $task.Wait(-1)
    return $task.Result
  }

  $startup = Wait-Op ([Windows.ApplicationModel.StartupTask]::GetAsync($TaskId)) ([Windows.ApplicationModel.StartupTask])
  switch ($Op) {
    'enable' { $null = Wait-Op ($startup.RequestEnableAsync()) ([Windows.ApplicationModel.StartupTaskState]) }
    'disable' { $startup.Disable() }
  }
  # Read the state again: after enable / disable it is what Windows decided (e.g. DisabledByUser stays disabled).
  $startup = Wait-Op ([Windows.ApplicationModel.StartupTask]::GetAsync($TaskId)) ([Windows.ApplicationModel.StartupTask])
  Write-Line @{ state = $startup.State.ToString() }
  exit 0
}
catch {
  $message = $_.Exception.Message
  if ($_.Exception.InnerException) { $message = $_.Exception.InnerException.Message }
  Write-Line @{ error = ($message -replace '\s+', ' ').Trim() }
  exit 1
}
