// Coreza Setup & Launcher
//
// Thin Windows launcher that:
//   1. Runs `node setup/setup.js` (interactive — uses inherited stdio).
//   2. Spawns the three dev servers in their own console windows.
//   3. Waits for the frontend to be reachable, then opens the default browser.
//
// Build (from any OS):
//   GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o setup.exe ./installer/launcher
//
// Place the resulting setup.exe at the repo root next to package.json.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"time"
)

const (
	defaultFrontendPort = 8080
	backendPort         = 8000
	marketStreamPort    = 8090
)

func main() {
	setupOnly := flag.Bool("setup-only", false, "Run setup only; do not launch services")
	startOnly := flag.Bool("start-only", false, "Skip setup; just launch services")
	noBrowser := flag.Bool("no-browser", false, "Do not open the browser after launch")
	flag.Parse()

	root, err := repoRoot()
	if err != nil {
		fail("Could not resolve repository root: %v", err)
	}
	if err := os.Chdir(root); err != nil {
		fail("Could not change directory to %s: %v", root, err)
	}

	banner()
	fmt.Printf("Repository: %s\n\n", root)

	if !*startOnly {
		if err := ensureNode(); err != nil {
			fail("%v\n\nInstall Node.js 18+ from https://nodejs.org and re-run setup.exe.", err)
		}
		if err := runSetup(root); err != nil {
			fail("Setup failed: %v", err)
		}
	}
	if *setupOnly {
		fmt.Println("\nSetup-only mode complete.")
		pause()
		return
	}

	port := detectFrontendPort(root)

	fmt.Println("\n=== Launching dev servers ===")
	launchService("Coreza Frontend", root, "npm run dev")
	launchService("Coreza Backend", filepath.Join(root, "coreza-backend"), "npm run dev")
	launchService("Coreza Market Stream",
		filepath.Join(root, "coreza-backend", "market-stream-service"), "npm run dev")

	url := fmt.Sprintf("http://localhost:%d", port)
	fmt.Printf("\nWaiting for frontend at %s ...\n", url)
	if waitForHTTP(url, 60*time.Second) {
		fmt.Println("Frontend is up.")
		if !*noBrowser {
			openBrowser(url)
		}
	} else {
		fmt.Println("Frontend did not respond within 60s. Check the Frontend console window.")
	}

	fmt.Println("\n=== Coreza is running ===")
	fmt.Printf("  Frontend:      %s\n", url)
	fmt.Printf("  Backend:       http://localhost:%d\n", backendPort)
	fmt.Printf("  Market stream: http://localhost:%d\n", marketStreamPort)
	fmt.Println("\nClose any of the three console windows to stop that service.")
	fmt.Println("Re-run setup.exe to start everything again (use --start-only to skip the setup check).")
	pause()
}

// ---------------------------------------------------------------- helpers

func repoRoot() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

func banner() {
	fmt.Println("============================================")
	fmt.Println(" Coreza Trading Platform - Setup & Launcher ")
	fmt.Println("============================================")
}

func ensureNode() error {
	if _, err := exec.LookPath("node"); err != nil {
		return fmt.Errorf("Node.js was not found on PATH")
	}
	return nil
}

func runSetup(root string) error {
	fmt.Println("=== Running setup/setup.js ===")
	cmd := exec.Command("node", filepath.Join("setup", "setup.js"))
	cmd.Dir = root
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// launchService opens a new cmd.exe window running the given npm command in cwd.
// `cmd /k` keeps the window open after the process exits so users can read errors.
func launchService(title, cwd, command string) {
	if runtime.GOOS != "windows" {
		// Fallback for non-Windows dev/testing of the launcher.
		fmt.Printf("[launch] %s :: cd %s && %s\n", title, cwd, command)
		c := exec.Command("sh", "-c", command)
		c.Dir = cwd
		_ = c.Start()
		return
	}
	// `start "title" /D "<cwd>" cmd /k "<command>"`
	args := []string{"/c", "start", title, "/D", cwd, "cmd", "/k", command}
	c := exec.Command("cmd", args...)
	if err := c.Start(); err != nil {
		fmt.Printf("Failed to launch %s: %v\n", title, err)
		return
	}
	fmt.Printf("  -> %s\n", title)
}

// detectFrontendPort parses vite.config.ts for `port: <n>`; falls back to 8080.
func detectFrontendPort(root string) int {
	data, err := os.ReadFile(filepath.Join(root, "vite.config.ts"))
	if err != nil {
		return defaultFrontendPort
	}
	re := regexp.MustCompile(`port\s*:\s*(\d+)`)
	if m := re.FindStringSubmatch(string(data)); len(m) == 2 {
		if p, err := strconv.Atoi(m[1]); err == nil && p > 0 {
			return p
		}
	}
	return defaultFrontendPort
}

func waitForHTTP(url string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	host := url[len("http://"):]
	for time.Now().Before(deadline) {
		// Try a TCP connect first (cheaper than HTTP) then a real GET.
		conn, err := net.DialTimeout("tcp", host, 1*time.Second)
		if err == nil {
			_ = conn.Close()
			resp, err := client.Get(url)
			if err == nil {
				resp.Body.Close()
				return true
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

func openBrowser(url string) {
	fmt.Printf("Opening %s in your default browser...\n", url)
	var c *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		c = exec.Command("open", url)
	default:
		c = exec.Command("xdg-open", url)
	}
	_ = c.Start()
}

func pause() {
	fmt.Print("\nPress Enter to close this window...")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

func fail(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "\n[ERROR] "+format+"\n", args...)
	pause()
	os.Exit(1)
}
