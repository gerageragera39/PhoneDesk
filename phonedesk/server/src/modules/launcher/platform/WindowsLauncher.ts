import { execFile, spawn } from "node:child_process";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { PlatformDetector } from "../../../shared/utils/PlatformDetector";
import type { AppEntry, LaunchResult } from "../../apps/AppTypes";
import type { ILauncherStrategy } from "./ILauncherStrategy";

interface ExecResult {
  stdout: string;
  stderr: string;
}

export class WindowsLauncher implements ILauncherStrategy {
  private readonly tasklistCommand = PlatformDetector.resolveWindowsCommand("tasklist");
  private readonly cmdCommand = PlatformDetector.resolveWindowsCommand("cmd.exe");
  private readonly powerShellCommand = PlatformDetector.resolveWindowsCommand("powershell");

  constructor(private readonly processMap: Map<string, ChildProcess>) {}

  public async launch(app: AppEntry): Promise<LaunchResult> {
    try {
      const child = this.spawnApp(app);

      child.unref();
      this.processMap.set(app.id, child);
      child.once("exit", () => {
        this.processMap.delete(app.id);
      });

      return {
        success: true,
        action: "launched",
        message: `${app.name} launched successfully`,
        pid: child.pid,
      };
    } catch (error) {
      return {
        success: false,
        action: "error",
        message: error instanceof Error ? error.message : "Failed to launch application",
      };
    }
  }

  public async focusOrLaunch(app: AppEntry): Promise<LaunchResult> {
    try {
      const running = await this.isRunning(app);

      if (!running) {
        return this.launch(app);
      }

      const focused = await this.focusWindow(app);

      if (focused) {
        return {
          success: true,
          action: "focused",
          message: `${app.name} was brought to the foreground`,
        };
      }

      return this.launch(app);
    } catch (error) {
      return {
        success: false,
        action: "error",
        message: error instanceof Error ? error.message : "Failed to focus or launch application",
      };
    }
  }

  public async isRunning(app: AppEntry): Promise<boolean> {
    try {
      const extension = path.win32.extname(app.executablePath).toLowerCase();
      if (extension && extension !== ".exe") {
        return false;
      }

      const imageName = path.win32.basename(app.executablePath);
      const result = await this.execFileAsync(this.tasklistCommand, ["/FI", `IMAGENAME eq ${imageName}`]);
      const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
      return output.includes(imageName.toLowerCase());
    } catch {
      return false;
    }
  }

  private spawnApp(app: AppEntry): ChildProcess {
    const cwd = app.workingDirectory || path.win32.dirname(app.executablePath);
    const extension = path.win32.extname(app.executablePath).toLowerCase();

    if (PlatformDetector.isWsl()) {
      return spawn(this.cmdCommand, ["/c", "start", "", "/d", cwd, app.executablePath, ...(app.args ?? [])], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
    }

    if (extension === ".bat" || extension === ".cmd" || extension === ".com") {
      return spawn(this.cmdCommand, ["/c", "start", "", "/d", cwd, app.executablePath, ...(app.args ?? [])], {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
    }

    return spawn(app.executablePath, app.args ?? [], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
  }

  private async focusWindow(app: AppEntry): Promise<boolean> {
    const executablePath = app.executablePath;
    const extension = path.win32.extname(executablePath).toLowerCase();
    if (extension && extension !== ".exe") {
      return false;
    }

    const executableName = path.win32.basename(executablePath, path.win32.extname(executablePath));
    const escapedExecutablePath = executablePath.replace(/'/g, "''");
    const escapedAppName = app.name.replace(/'/g, "''");
    const script = `
$signature = @"
using System;
using System.Runtime.InteropServices;
public static class WinApi {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
Add-Type -TypeDefinition $signature
$shell = New-Object -ComObject WScript.Shell
$targetPath = '${escapedExecutablePath}'.ToLowerInvariant()
$targetName = '${executableName}'.ToLowerInvariant()
$targetBase = [System.IO.Path]::GetFileNameWithoutExtension($targetName)
$targetBaseNoProxy = [regex]::Replace($targetBase, '(_proxy|proxy)$', '')
$appName = '${escapedAppName}'.ToLowerInvariant()

$candidate = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
  ForEach-Object {
    $score = 0
    $procPath = ''

    try {
      if ($_.Path) {
        $procPath = $_.Path.ToLowerInvariant()
      }
    } catch {
      $procPath = ''
    }

    $procName = $_.ProcessName.ToLowerInvariant()
    $title = $_.MainWindowTitle.ToLowerInvariant()
    $procBase = if ($procPath) { [System.IO.Path]::GetFileNameWithoutExtension($procPath) } else { $procName }

    if ($procPath -eq $targetPath) { $score += 140 }
    if ($procBase -eq $targetBase) { $score += 100 }
    if ($procName -eq $targetBase) { $score += 90 }
    if ($targetBaseNoProxy -and $procBase -eq $targetBaseNoProxy) { $score += 75 }
    if ($targetBaseNoProxy -and $procName -eq $targetBaseNoProxy) { $score += 70 }
    if ($targetBase.Length -ge 3 -and $title.Contains($targetBase)) { $score += 35 }
    if ($targetBaseNoProxy.Length -ge 3 -and $title.Contains($targetBaseNoProxy)) { $score += 45 }
    if ($appName.Length -ge 3 -and $title.Contains($appName)) { $score += 80 }
    if ($appName.Length -ge 3 -and $procName.Contains($appName.Replace(' ', ''))) { $score += 20 }

    [PSCustomObject]@{
      Process = $_
      Score = $score
    }
  } |
  Where-Object { $_.Score -gt 0 } |
  Sort-Object Score -Descending |
  Select-Object -First 1

if ($null -eq $candidate -or $null -eq $candidate.Process) { exit 1 }

$proc = $candidate.Process
$hwnd = [IntPtr]::new($proc.MainWindowHandle)
if ($hwnd -eq [IntPtr]::Zero) { exit 1 }

if ([WinApi]::IsIconic($hwnd)) {
  [WinApi]::ShowWindowAsync($hwnd, 9) | Out-Null
} else {
  [WinApi]::ShowWindowAsync($hwnd, 5) | Out-Null
}

Start-Sleep -Milliseconds 120
[void]$shell.AppActivate($proc.Id)
Start-Sleep -Milliseconds 120
[void]$shell.SendKeys('%')
Start-Sleep -Milliseconds 60
[void]$shell.AppActivate($proc.Id)
[WinApi]::ShowWindowAsync($hwnd, 5) | Out-Null
[WinApi]::BringWindowToTop($hwnd) | Out-Null

if (-not [WinApi]::SetForegroundWindow($hwnd)) {
  exit 1
}

exit 0
`.trim();

    try {
      await this.execFileAsync(this.powerShellCommand, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
      return true;
    } catch {
      return false;
    }
  }

  private execFileAsync(command: string, args: string[]): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }
}
