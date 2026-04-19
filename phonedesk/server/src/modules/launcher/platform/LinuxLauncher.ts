import { execFile, execSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { Logger } from "../../../shared/utils/Logger";
import type { AppEntry, LaunchResult } from "../../apps/AppTypes";
import type { ILauncherStrategy } from "./ILauncherStrategy";

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface WindowInfo {
  id: string;
  pid: number | null;
  wmClass: string;
  title: string;
}

export class LinuxLauncher implements ILauncherStrategy {
  private readonly wmctrlAvailable: boolean;

  constructor(
    private readonly processMap: Map<string, ChildProcess>,
    private readonly logger: Logger,
  ) {
    this.wmctrlAvailable = this.checkDependencies();
  }

  public async launch(app: AppEntry): Promise<LaunchResult> {
    try {
      const child = spawn(app.executablePath, app.args ?? [], {
        cwd: app.workingDirectory || path.dirname(app.executablePath),
        shell: false,
        detached: true,
        stdio: "ignore",
      });

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
      const runningPids = await this.getRunningProcessIds(app);

      if (this.wmctrlAvailable) {
        const focusedByPid = await this.focusWindowByPid(runningPids);
        if (focusedByPid) {
          return {
            success: true,
            action: "focused",
            message: `${app.name} was brought to the foreground`,
          };
        }

        const focusedByClass = await this.focusWindowByClassOrTitle(app);
        if (focusedByClass) {
          return {
            success: true,
            action: "focused",
            message: `${app.name} was brought to the foreground`,
          };
        }
      }

      if (runningPids.length > 0) {
        return {
          success: true,
          action: "focus_failed",
          message: this.wmctrlAvailable
            ? "The application is already running, but its window could not be focused"
            : "wmctrl not installed, window focus unavailable",
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
    const pids = await this.getRunningProcessIds(app);
    if (pids.length > 0) {
      return true;
    }

    if (!this.wmctrlAvailable) {
      return false;
    }

    return this.hasWindowByClassOrTitle(app);
  }

  private checkDependencies(): boolean {
    try {
      execSync("which wmctrl", { stdio: "ignore" });
      return true;
    } catch {
      this.logger.warn(
        "wmctrl not found. Window focus on Linux is unavailable. Install it with: sudo apt install wmctrl",
      );
      return false;
    }
  }

  private async getRunningProcessIds(app: AppEntry): Promise<number[]> {
    const pids = new Set<number>();
    const processNames = this.getProcessNameCandidates(app.executablePath);

    for (const processName of processNames) {
      const matched = await this.collectPids("pgrep", ["-x", processName]);
      for (const pid of matched) {
        pids.add(pid);
      }
    }

    const commandPatterns = this.getCommandLinePatterns(app.executablePath);
    for (const pattern of commandPatterns) {
      const matched = await this.collectPids("pgrep", ["-f", pattern]);
      for (const pid of matched) {
        pids.add(pid);
      }
    }

    return Array.from(pids);
  }

  private async collectPids(command: string, args: string[]): Promise<number[]> {
    try {
      const result = await this.execFileAsync(command, args);
      return result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => Number.parseInt(entry, 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      return [];
    }
  }

  private async focusWindowByPid(pids: number[]): Promise<boolean> {
    if (pids.length === 0) {
      return false;
    }

    const windows = await this.listWindows();
    const pidSet = new Set<number>(pids);
    const window = windows.find((entry) => entry.pid !== null && pidSet.has(entry.pid));

    if (!window) {
      return false;
    }

    return this.focusWindow(window.id);
  }

  private async focusWindowByClassOrTitle(app: AppEntry): Promise<boolean> {
    const windows = await this.listWindows();
    const classTokens = this.getWindowClassTokens(app);
    const appTitle = app.name.trim().toLowerCase();

    const window = windows.find((entry) => {
      const wmClass = entry.wmClass.toLowerCase();
      const title = entry.title.toLowerCase();
      const classMatched = classTokens.some((token) => wmClass.includes(token));
      const titleMatched = appTitle.length >= 5 && title.includes(appTitle);
      return classMatched || titleMatched;
    });

    if (!window) {
      return false;
    }

    return this.focusWindow(window.id);
  }

  private async hasWindowByClassOrTitle(app: AppEntry): Promise<boolean> {
    const windows = await this.listWindows();
    const classTokens = this.getWindowClassTokens(app);
    const appTitle = app.name.trim().toLowerCase();

    return windows.some((entry) => {
      const wmClass = entry.wmClass.toLowerCase();
      const title = entry.title.toLowerCase();
      const classMatched = classTokens.some((token) => wmClass.includes(token));
      const titleMatched = appTitle.length >= 5 && title.includes(appTitle);
      return classMatched || titleMatched;
    });
  }

  private async listWindows(): Promise<WindowInfo[]> {
    if (!this.wmctrlAvailable) {
      return [];
    }

    let result: ExecResult;
    try {
      result = await this.execFileAsync("wmctrl", ["-lxp"]);
    } catch (error) {
      if (this.isCommandNotFoundError(error)) {
        return [];
      }

      return [];
    }

    const windows: WindowInfo[] = [];

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) {
        continue;
      }

      const id = parts[0];
      const pidRaw = parts[2];
      const wmClass = parts[4];
      const title = parts.slice(5).join(" ");

      const parsedPid = Number.parseInt(pidRaw, 10);
      windows.push({
        id,
        pid: Number.isInteger(parsedPid) ? parsedPid : null,
        wmClass,
        title,
      });
    }

    return windows;
  }

  private async focusWindow(windowId: string): Promise<boolean> {
    try {
      await this.execFileAsync("wmctrl", ["-i", "-a", windowId]);
      return true;
    } catch {
      return false;
    }
  }

  private getProcessNameCandidates(executablePath: string): string[] {
    const candidates = new Set<string>();

    const addCandidate = (value: string): void => {
      const normalized = value.trim();
      if (!normalized) {
        return;
      }

      candidates.add(normalized);
      const parsedName = path.parse(normalized).name.trim();
      if (parsedName) {
        candidates.add(parsedName);
      }
    };

    addCandidate(path.basename(executablePath));

    try {
      addCandidate(path.basename(realpathSync(executablePath)));
    } catch {
      // ignore: keep best-effort matching from executablePath.
    }

    const lowerCandidates = Array.from(candidates).map((entry) => entry.toLowerCase());
    if (lowerCandidates.some((entry) => entry.includes("firefox"))) {
      candidates.add("firefox");
      candidates.add("firefox-bin");
      candidates.add("firefox-esr");
    }

    return Array.from(candidates);
  }

  private getCommandLinePatterns(executablePath: string): string[] {
    const patterns = new Set<string>();

    const addPattern = (value: string): void => {
      const normalized = value.trim();
      if (!normalized) {
        return;
      }

      patterns.add(`(^|[[:space:]])${this.escapeRegex(normalized)}([[:space:]]|$)`);
    };

    addPattern(executablePath);

    try {
      addPattern(realpathSync(executablePath));
    } catch {
      // ignore: executable can be a symlink in environments where realpath fails.
    }

    const executableName = path.basename(executablePath);
    patterns.add(`(^|[[:space:]/])${this.escapeRegex(executableName)}([[:space:]]|$)`);

    return Array.from(patterns);
  }

  private getWindowClassTokens(app: AppEntry): string[] {
    const tokens = new Set<string>();
    const executableBase = path.parse(path.basename(app.executablePath)).name.toLowerCase();

    const addToken = (value: string): void => {
      const normalized = value.trim().toLowerCase();
      if (normalized.length < 3) {
        return;
      }

      tokens.add(normalized);
    };

    addToken(executableBase);

    if (executableBase.includes("firefox")) {
      addToken("navigator.firefox");
      addToken("firefox");
    }

    if (executableBase === "code") {
      addToken("code.code");
    }

    if (executableBase.includes("virtualbox")) {
      addToken("virtualbox");
    }

    return Array.from(tokens);
  }

  private isCommandNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const code = (error as { code?: unknown }).code;
    return code === "ENOENT";
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private execFileAsync(command: string, args: string[]): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile(command, args, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }
}
