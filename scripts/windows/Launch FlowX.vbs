' Double-click FlowX launcher — no CMD window. Auto-stops servers when app window closes.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\launch.ps1"""
' True = wait until launch.ps1 exits (after user closes FlowX window)
sh.Run cmd, 0, True
