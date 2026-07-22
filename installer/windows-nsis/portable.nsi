Unicode true

!ifndef APP_PAYLOAD
  !error "APP_PAYLOAD must point to the win-unpacked directory"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "Airmonlink-Composer-Portable.exe"
!endif
!ifndef APP_ICON
  !define APP_ICON "../../assets/icon.ico"
!endif

Name "Airmonlink Composer Portable"
OutFile "${OUTPUT_FILE}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma
Icon "${APP_ICON}"

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\Airmonlink Composer"
  File /r "${APP_PAYLOAD}/*"
  ExecWait '"$PLUGINSDIR\Airmonlink Composer\Airmonlink Composer.exe"'
  SetOutPath "$TEMP"
SectionEnd
