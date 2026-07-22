Unicode true
!include "MUI2.nsh"

!ifndef APP_PAYLOAD
  !error "APP_PAYLOAD must point to the win-unpacked directory"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "Airmonlink-Composer-Setup.exe"
!endif
!ifndef APP_ICON
  !define APP_ICON "../../assets/icon.ico"
!endif

Name "Airmonlink Composer"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Airmonlink Composer"
InstallDirRegKey HKCU "Software\Airmonlink\Composer" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"

!define MUI_ABORTWARNING
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Airmonlink Composer.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Airmonlink Composer"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Airmonlink Composer" SEC_MAIN
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${APP_PAYLOAD}/*"

  WriteUninstaller "$INSTDIR\Uninstall Airmonlink Composer.exe"
  WriteRegStr HKCU "Software\Airmonlink\Composer" "InstallDir" "$INSTDIR"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer" "DisplayName" "Airmonlink Composer"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer" "DisplayVersion" "1.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer" "Publisher" "Airmonlink"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer" "DisplayIcon" "$INSTDIR\Airmonlink Composer.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer" "UninstallString" '"$INSTDIR\Uninstall Airmonlink Composer.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer" "NoRepair" 1

  WriteRegStr HKCU "Software\Classes\.airscore" "" "AirmonlinkComposer.Score"
  WriteRegStr HKCU "Software\Classes\AirmonlinkComposer.Score" "" "Airmonlink Composer score"
  WriteRegStr HKCU "Software\Classes\AirmonlinkComposer.Score\DefaultIcon" "" "$INSTDIR\Airmonlink Composer.exe,0"
  WriteRegStr HKCU "Software\Classes\AirmonlinkComposer.Score\shell\open\command" "" '"$INSTDIR\Airmonlink Composer.exe" "%1"'

  CreateDirectory "$SMPROGRAMS\Airmonlink Composer"
  CreateShortcut "$SMPROGRAMS\Airmonlink Composer\Airmonlink Composer.lnk" "$INSTDIR\Airmonlink Composer.exe"
  CreateShortcut "$SMPROGRAMS\Airmonlink Composer\Uninstall Airmonlink Composer.lnk" "$INSTDIR\Uninstall Airmonlink Composer.exe"
  CreateShortcut "$DESKTOP\Airmonlink Composer.lnk" "$INSTDIR\Airmonlink Composer.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Airmonlink Composer.lnk"
  RMDir /r "$SMPROGRAMS\Airmonlink Composer"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer"
  DeleteRegKey HKCU "Software\Classes\AirmonlinkComposer.Score"
  DeleteRegKey HKCU "Software\Classes\.airscore"
  DeleteRegKey HKCU "Software\Airmonlink\Composer"
  RMDir /r "$INSTDIR"
SectionEnd
