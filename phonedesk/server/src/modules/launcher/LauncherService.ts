import type { Response } from "express";
import type { ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, statSync } from "node:fs";
import { AppError } from "../../shared/errors/AppError";
import type { Logger } from "../../shared/utils/Logger";
import { PlatformDetector } from "../../shared/utils/PlatformDetector";
import { AppsService } from "../apps/AppsService";
import type { AppEntry, AppStatusSnapshot, LaunchResult } from "../apps/AppTypes";
import type { ILauncherStrategy } from "./platform/ILauncherStrategy";

const STATUS_CHECK_INTERVAL_MS = 5000;

export class LauncherService {
  private readonly sseClients = new Set<Response>();
  private statusTimer: NodeJS.Timeout | null = null;
  private statusInFlight = false;

  constructor(
    private readonly strategy: ILauncherStrategy,
    private readonly appsService: AppsService,
    private readonly logger: Logger,
    private readonly processMap: Map<string, ChildProcess>,
  ) {}

  public async focusOrLaunch(app: AppEntry, ip: string): Promise<LaunchResult> {
    try {
      await this.validateExecutablePath(app, ip);
      const result = await this.strategy.focusOrLaunch(app);

      await this.logger.audit("launcher.request", {
        ip,
        appId: app.id,
        appName: app.name,
        success: result.success,
        action: result.action,
        pid: result.pid ?? null,
        trackedProcesses: this.processMap.size,
      });

      return result;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      this.logger.error("Application launch failed", {
        appId: app.id,
        error: error instanceof Error ? error.message : "unknown",
      });

      throw new AppError("Failed to launch application", 500, "LAUNCH_FAILED", {
        appId: app.id,
      });
    }
  }

  private async validateExecutablePath(app: AppEntry, ip: string): Promise<void> {
    const executablePath = app.executablePath;
    const fileSystemPath = this.resolveExecutablePathForCurrentRuntime(executablePath);
    const hasForbiddenCharacters =
      /[;$`|\n\r]/.test(executablePath) || executablePath.includes("&&") || executablePath.includes("||");

    if (hasForbiddenCharacters) {
      await this.logger.audit("launch_blocked.invalid_path", {
        ip,
        appId: app.id,
        appName: app.name,
        executablePath,
        reason: "forbidden_characters",
      });

      throw new AppError(`Invalid executable path: ${executablePath}`, 400, "INVALID_EXECUTABLE_PATH");
    }

    if (!existsSync(fileSystemPath)) {
      await this.logger.audit("launch_blocked.invalid_path", {
        ip,
        appId: app.id,
        appName: app.name,
        executablePath,
        reason: "not_found",
      });

      throw new AppError(`Executable not found: ${executablePath}`, 400, "EXECUTABLE_NOT_FOUND");
    }

    const stats = statSync(fileSystemPath);
    if (!stats.isFile()) {
      await this.logger.audit("launch_blocked.invalid_path", {
        ip,
        appId: app.id,
        appName: app.name,
        executablePath,
        reason: "not_a_file",
      });

      throw new AppError(`Executable not found: ${executablePath}`, 400, "EXECUTABLE_NOT_FOUND");
    }

    if (PlatformDetector.detectPlatform() !== "windows") {
      try {
        accessSync(fileSystemPath, fsConstants.X_OK);
      } catch {
        await this.logger.audit("launch_blocked.invalid_path", {
          ip,
          appId: app.id,
          appName: app.name,
          executablePath,
          reason: "not_executable",
        });

        throw new AppError(`Executable not found: ${executablePath}`, 400, "EXECUTABLE_NOT_FOUND");
      }
    }
  }

  private resolveExecutablePathForCurrentRuntime(executablePath: string): string {
    if (!PlatformDetector.isWsl() || !/^[A-Za-z]:\\/.test(executablePath)) {
      return executablePath;
    }

    try {
      return execFileSync("wslpath", ["-u", executablePath], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      const driveLetter = executablePath[0]?.toLowerCase();
      const normalizedRest = executablePath.slice(2).replace(/\\/g, "/");
      return `/mnt/${driveLetter}${normalizedRest}`;
    }
  }

  public async getStatusSnapshot(): Promise<AppStatusSnapshot> {
    try {
      const apps = await this.appsService.getApps();
      const statusEntries = await Promise.all(
        apps.map(async (app) => {
          const running = await this.strategy.isRunning(app);
          return [app.id, running] as const;
        }),
      );

      return Object.fromEntries(statusEntries);
    } catch (error) {
      this.logger.warn("Failed to collect application status snapshot", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return {};
    }
  }

  public async addSseClient(response: Response): Promise<void> {
    this.sseClients.add(response);
    await this.pushStatusUpdate();
    this.startStatusLoop();
  }

  public removeSseClient(response: Response): void {
    this.sseClients.delete(response);

    if (this.sseClients.size === 0) {
      this.stopStatusLoop();
    }
  }

  public closeAllSseConnections(): void {
    this.stopStatusLoop();

    for (const client of this.sseClients) {
      client.end();
    }

    this.sseClients.clear();
  }

  private startStatusLoop(): void {
    if (this.statusTimer || this.sseClients.size === 0) {
      return;
    }

    this.statusTimer = setInterval(() => {
      void this.pushStatusUpdate();
    }, STATUS_CHECK_INTERVAL_MS);
  }

  private stopStatusLoop(): void {
    if (!this.statusTimer) {
      return;
    }

    clearInterval(this.statusTimer);
    this.statusTimer = null;
  }

  private async pushStatusUpdate(): Promise<void> {
    if (this.statusInFlight || this.sseClients.size === 0) {
      return;
    }

    this.statusInFlight = true;

    try {
      const snapshot = await this.getStatusSnapshot();
      const payload = `event: statuses\ndata: ${JSON.stringify(snapshot)}\n\n`;

      for (const client of this.sseClients) {
        try {
          client.write(payload);
        } catch {
          this.sseClients.delete(client);
        }
      }
    } finally {
      this.statusInFlight = false;
    }
  }
}
