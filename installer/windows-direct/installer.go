//go:build windows

package main

import (
	"archive/zip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed installer-assets/windows-app.zip "installer-assets/Uninstall Airmonlink Composer.exe"
var embedded embed.FS

const (
	productName       = "Airmonlink Composer"
	version           = "1.0.0"
	buildNumber       = "12"
	appPayloadSHA     = "2bd78a729c4828286b02a6c87b7690a403804d41b7f69f41cdfbe9f28858da83"
	uninstallerSHA    = "4f75e73dffc02c1aefb5fe22151f811a47ff8d2a5dee29dfd26c8bf0a88cd8a2"
	mbOK              = 0x00000000
	mbOKCancel        = 0x00000001
	mbYesNo           = 0x00000004
	mbYesNoCancel     = 0x00000003
	mbIconError       = 0x00000010
	mbIconQuestion    = 0x00000020
	mbIconInformation = 0x00000040
	idOK              = 1
	idCancel          = 2
	idYes             = 6
	idNo              = 7
)

var (
	user32     = syscall.NewLazyDLL("user32.dll")
	messageBox = user32.NewProc("MessageBoxW")
	logFile    *os.File
)

func utf16Ptr(value string) *uint16 { ptr, _ := syscall.UTF16PtrFromString(value); return ptr }
func showMessage(text, title string, flags uintptr) int {
	result, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(utf16Ptr(text))), uintptr(unsafe.Pointer(utf16Ptr(title))), flags)
	return int(result)
}
func logf(format string, args ...any) {
	if logFile == nil {
		return
	}
	fmt.Fprintf(logFile, "%s "+format+"\r\n", append([]any{time.Now().Format(time.RFC3339)}, args...)...)
	_ = logFile.Sync()
}
func sha256Bytes(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func readVerified(name, expected string) ([]byte, error) {
	data, err := embedded.ReadFile(name)
	if err != nil {
		return nil, err
	}
	if actual := sha256Bytes(data); !strings.EqualFold(actual, expected) {
		return nil, fmt.Errorf("embedded payload checksum mismatch for %s: %s", name, actual)
	}
	return data, nil
}
func processRunning(image string) bool {
	output, err := exec.Command("tasklist.exe", "/FI", "IMAGENAME eq "+image, "/NH").CombinedOutput()
	if err != nil {
		logf("tasklist warning: %v", err)
		return false
	}
	text := strings.ToLower(string(output))
	return strings.Contains(text, strings.ToLower(image)) && !strings.Contains(text, "no tasks are running")
}
func runQuiet(name string, args ...string) {
	command := exec.Command(name, args...)
	if output, err := command.CombinedOutput(); err != nil {
		logf("command warning: %s %v: %v (%s)", name, args, err, strings.TrimSpace(string(output)))
	}
}
func quotePowerShell(value string) string { return strings.ReplaceAll(value, "'", "''") }
func chooseParent(defaultParent string) (string, bool) {
	script := "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; " +
		"$d.Description='Choose the parent folder for Airmonlink Composer'; $d.SelectedPath='" + quotePowerShell(defaultParent) + "'; " +
		"if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write($d.SelectedPath)}"
	command := exec.Command("powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.Output()
	if err != nil {
		logf("folder picker warning: %v", err)
		return "", false
	}
	selected := strings.TrimSpace(string(output))
	return selected, selected != ""
}
func extractPayload(data []byte, destination string) error {
	tempZip := filepath.Join(os.TempDir(), fmt.Sprintf("airmonlink-composer-%d.zip", time.Now().UnixNano()))
	if err := os.WriteFile(tempZip, data, 0o600); err != nil {
		return err
	}
	defer os.Remove(tempZip)
	reader, err := zip.OpenReader(tempZip)
	if err != nil {
		return err
	}
	defer reader.Close()
	root, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	for _, item := range reader.File {
		target := filepath.Join(root, item.Name)
		clean, err := filepath.Abs(target)
		if err != nil || (clean != root && !strings.HasPrefix(clean, root+string(os.PathSeparator))) {
			return fmt.Errorf("unsafe archive path: %s", item.Name)
		}
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(clean, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(clean), 0o755); err != nil {
			return err
		}
		input, err := item.Open()
		if err != nil {
			return err
		}
		output, err := os.Create(clean)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		input.Close()
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}
func createShortcut(shortcut, target, workingDir string) {
	_ = os.MkdirAll(filepath.Dir(shortcut), 0o755)
	script := "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('" + quotePowerShell(shortcut) + "'); " +
		"$s.TargetPath='" + quotePowerShell(target) + "'; $s.WorkingDirectory='" + quotePowerShell(workingDir) + "'; " +
		"$s.IconLocation='" + quotePowerShell(target) + ",0'; $s.Description='Airmonlink Composer music notation software'; $s.Save()"
	command := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := command.CombinedOutput(); err != nil {
		logf("shortcut warning: %v (%s)", err, strings.TrimSpace(string(output)))
	}
}
func configureIntegration(target string) {
	executable := filepath.Join(target, productName+".exe")
	uninstaller := filepath.Join(target, "Uninstall "+productName+".exe")
	classes := `HKCU\Software\Classes`
	runQuiet("reg.exe", "add", classes+`\.airscore`, "/ve", "/t", "REG_SZ", "/d", "AirmonlinkComposer.Score", "/f")
	runQuiet("reg.exe", "add", classes+`\AirmonlinkComposer.Score`, "/ve", "/t", "REG_SZ", "/d", "Airmonlink Composer Score", "/f")
	runQuiet("reg.exe", "add", classes+`\AirmonlinkComposer.Score\DefaultIcon`, "/ve", "/t", "REG_SZ", "/d", executable+",0", "/f")
	runQuiet("reg.exe", "add", classes+`\AirmonlinkComposer.Score\shell\open\command`, "/ve", "/t", "REG_SZ", "/d", `"`+executable+`" "%1"`, "/f")
	key := `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Airmonlink Composer`
	runQuiet("reg.exe", "add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", productName, "/f")
	runQuiet("reg.exe", "add", key, "/v", "DisplayVersion", "/t", "REG_SZ", "/d", version, "/f")
	runQuiet("reg.exe", "add", key, "/v", "Publisher", "/t", "REG_SZ", "/d", "Airmonlink", "/f")
	runQuiet("reg.exe", "add", key, "/v", "InstallLocation", "/t", "REG_SZ", "/d", target, "/f")
	runQuiet("reg.exe", "add", key, "/v", "DisplayIcon", "/t", "REG_SZ", "/d", executable+",0", "/f")
	runQuiet("reg.exe", "add", key, "/v", "UninstallString", "/t", "REG_SZ", "/d", `"`+uninstaller+`"`, "/f")
	runQuiet("reg.exe", "add", key, "/v", "NoModify", "/t", "REG_DWORD", "/d", "1", "/f")
	runQuiet("reg.exe", "add", key, "/v", "NoRepair", "/t", "REG_DWORD", "/d", "1", "/f")
	desktop := filepath.Join(os.Getenv("USERPROFILE"), "Desktop", productName+".lnk")
	startDir := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", productName)
	createShortcut(desktop, executable, target)
	createShortcut(filepath.Join(startDir, productName+".lnk"), executable, target)
	createShortcut(filepath.Join(startDir, "Uninstall "+productName+".lnk"), uninstaller, target)
	runQuiet("ie4uinit.exe", "-show")
}
func install() error {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return fmt.Errorf("Windows LOCALAPPDATA is unavailable")
	}
	logDir := filepath.Join(localAppData, productName)
	_ = os.MkdirAll(logDir, 0o755)
	var err error
	logFile, err = os.OpenFile(filepath.Join(logDir, "install-1.0.0.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err == nil {
		defer logFile.Close()
	}
	if processRunning(productName + ".exe") {
		return fmt.Errorf("Airmonlink Composer is still running. Close it completely, confirm it has left Task Manager, and run Setup again")
	}
	defaultParent := filepath.Join(localAppData, "Programs")
	target := filepath.Join(defaultParent, productName)
	choice := showMessage("Install Airmonlink Composer 1.0.0 Phase 2 to:\n\n"+target+"\n\nChoose Yes for this location, No to select another parent folder, or Cancel to stop Setup.", productName+" Setup", mbYesNoCancel|mbIconQuestion)
	if choice == idCancel {
		return fmt.Errorf("installation canceled")
	}
	if choice == idNo {
		parent, ok := chooseParent(defaultParent)
		if !ok {
			return fmt.Errorf("installation canceled")
		}
		target = filepath.Join(parent, productName)
	}
	appData, err := readVerified("installer-assets/windows-app.zip", appPayloadSHA)
	if err != nil {
		return err
	}
	uninstallData, err := readVerified("installer-assets/Uninstall Airmonlink Composer.exe", uninstallerSHA)
	if err != nil {
		return err
	}
	staging := target + ".installing"
	backup := target + ".previous"
	_ = os.RemoveAll(staging)
	_ = os.RemoveAll(backup)
	logf("extracting application to %s", staging)
	if err := extractPayload(appData, staging); err != nil {
		return fmt.Errorf("extract application: %w", err)
	}
	if err := os.WriteFile(filepath.Join(staging, "Uninstall "+productName+".exe"), uninstallData, 0o700); err != nil {
		return err
	}
	marker := "Airmonlink Composer 1.0.0\r\nPhase 2 Build 12\r\nApplication ID: com.airmonlink.composer\r\nElectron 37.10.3 Windows x64\r\n"
	if err := os.WriteFile(filepath.Join(staging, "PHASE-2-VERSION.txt"), []byte(marker), 0o600); err != nil {
		return err
	}
	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			return fmt.Errorf("prepare existing installation: %w", err)
		}
	}
	if err := os.Rename(staging, target); err != nil {
		_ = os.Rename(backup, target)
		return fmt.Errorf("activate installation: %w", err)
	}
	_ = os.RemoveAll(backup)
	configureIntegration(target)
	executable := filepath.Join(target, productName+".exe")
	if _, err := os.Stat(executable); err != nil {
		return fmt.Errorf("installed executable is missing: %w", err)
	}
	logf("installation completed: %s", target)
	if showMessage("Airmonlink Composer 1.0.0 Phase 2 installed successfully.\n\nLaunch it now?", productName+" Setup", mbYesNo|mbIconInformation) == idYes {
		_ = exec.Command(executable).Start()
	}
	return nil
}
func main() {
	if showMessage("Install Airmonlink Composer 1.0.0 Phase 2 for the current Windows user?\n\nSetup installs the real Electron desktop application, official launcher identity, shortcuts, uninstaller and .airscore file association.", productName+" Setup", mbOKCancel|mbIconInformation) != idOK {
		return
	}
	if err := install(); err != nil {
		if err.Error() == "installation canceled" {
			return
		}
		showMessage("Installation could not be completed.\n\n"+err.Error()+"\n\nSee Local AppData\\Airmonlink Composer\\install-1.0.0.log for details.", productName+" Setup Error", mbOK|mbIconError)
	}
}
