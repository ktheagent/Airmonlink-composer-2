//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	productName       = "Airmonlink Composer"
	mbOK              = 0x00000000
	mbOKCancel        = 0x00000001
	mbIconError       = 0x00000010
	mbIconQuestion    = 0x00000020
	mbIconInformation = 0x00000040
	idOK              = 1
)

var (
	user32     = syscall.NewLazyDLL("user32.dll")
	messageBox = user32.NewProc("MessageBoxW")
)

func utf16Ptr(value string) *uint16 { ptr, _ := syscall.UTF16PtrFromString(value); return ptr }
func showMessage(text, title string, flags uintptr) int {
	result, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(utf16Ptr(text))), uintptr(unsafe.Pointer(utf16Ptr(title))), flags)
	return int(result)
}
func runQuiet(name string, args ...string) {
	command := exec.Command(name, args...)
	_ = command.Run()
}
func processRunning(image string) bool {
	command := exec.Command("tasklist.exe", "/FI", "IMAGENAME eq "+image, "/NH")
	output, err := command.CombinedOutput()
	if err != nil {
		return false
	}
	text := strings.ToLower(string(output))
	return strings.Contains(text, strings.ToLower(image)) && !strings.Contains(text, "no tasks are running")
}
func removeIntegration() {
	runQuiet("reg.exe", "delete", `HKCU\Software\Classes\.airscore`, "/f")
	runQuiet("reg.exe", "delete", `HKCU\Software\Classes\AirmonlinkComposer.Score`, "/f")
	runQuiet("reg.exe", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer`, "/f")
	desktop := filepath.Join(os.Getenv("USERPROFILE"), "Desktop", productName+".lnk")
	startDir := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", productName)
	_ = os.Remove(desktop)
	_ = os.RemoveAll(startDir)
	runQuiet("ie4uinit.exe", "-show")
}
func scheduleRemoval(installDir string) error {
	tempDir := os.TempDir()
	script := filepath.Join(tempDir, fmt.Sprintf("airmonlink-composer-uninstall-%d.cmd", time.Now().UnixNano()))
	body := "@echo off\r\n" +
		"ping 127.0.0.1 -n 3 >nul\r\n" +
		"rmdir /s /q \"" + installDir + "\"\r\n" +
		"del /f /q \"%~f0\"\r\n"
	if err := os.WriteFile(script, []byte(body), 0o600); err != nil {
		return err
	}
	command := exec.Command("cmd.exe", "/C", "start", "", "/min", "cmd.exe", "/C", script)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Start()
}
func main() {
	if showMessage("Remove Airmonlink Composer 1.0.0 Phase 2 from this Windows user?\n\nYour score files and user-data folder will not be deleted.", productName+" Uninstall", mbOKCancel|mbIconQuestion) != idOK {
		return
	}
	if processRunning(productName + ".exe") {
		showMessage("Airmonlink Composer is still running. Close the application completely and try again.", productName+" Uninstall", mbOK|mbIconError)
		return
	}
	executable, err := os.Executable()
	if err != nil {
		showMessage("The installation directory could not be determined.", productName+" Uninstall", mbOK|mbIconError)
		return
	}
	installDir := filepath.Dir(executable)
	removeIntegration()
	if err := scheduleRemoval(installDir); err != nil {
		showMessage("The uninstaller could not schedule final file removal.\n\n"+err.Error(), productName+" Uninstall", mbOK|mbIconError)
		return
	}
	showMessage("Airmonlink Composer has been unregistered. Its application files will be removed after this window closes.", productName+" Uninstall", mbOK|mbIconInformation)
}
