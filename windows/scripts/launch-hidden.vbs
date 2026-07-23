Option Explicit

Dim shell, fso, scriptDir, mode, port, restartMode, target, extra, powershell, command, trayCommand, startTray, portArgument

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
mode = "tray"
port = "9335"
restartMode = "prompt"
extra = ""
startTray = False

If WScript.Arguments.Count >= 1 Then
  mode = LCase(WScript.Arguments.Item(0))
End If

If WScript.Arguments.Count >= 2 Then
  port = WScript.Arguments.Item(1)
End If

If WScript.Arguments.Count >= 3 Then
  restartMode = LCase(WScript.Arguments.Item(2))
End If

Select Case mode
  Case "apply"
    target = "start-dream-skin.ps1"
    Select Case restartMode
      Case "restart", "force", "restartexisting"
        extra = " -RestartExisting"
      Case "none", "no-restart", "norestart"
        extra = ""
      Case Else
        extra = " -PromptRestart"
    End Select
    startTray = True
  Case "restore"
    target = "restore-dream-skin.ps1"
    extra = " -RestoreBaseTheme -PromptRestart"
  Case Else
    target = "tray-dream-skin.ps1"
End Select

powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
portArgument = ""
If port <> "9335" Then portArgument = " -Port " & port
command = """" & powershell & """ -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptDir & "\" & target & """" & portArgument & extra
trayCommand = """" & powershell & """ -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptDir & "\tray-dream-skin.ps1" & """" & portArgument

If startTray Then
  shell.Run trayCommand, 0, False
End If

shell.Run command, 0, False
