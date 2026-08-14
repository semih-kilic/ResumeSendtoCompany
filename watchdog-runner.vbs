Option Explicit

Dim shell, fso, scriptDir, watchdogPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
watchdogPath = fso.BuildPath(scriptDir, "watchdog.ps1")
shell.Run "powershell.exe -ExecutionPolicy Bypass -File """ & watchdogPath & """", 0, False
