!macro customInstall
  DetailPrint "Configuring resilient Spilled Verifier startup"
  nsExec::ExecToStack '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --configure-scheduled-task'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "Scheduled task configuration failed: $1"
    Abort "Could not configure Spilled Verifier automatic recovery."
  ${EndIf}
!macroend
