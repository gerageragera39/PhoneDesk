import { execFile, execSync } from "node:child_process";
import { AppError } from "../../shared/errors/AppError";
import type { Logger } from "../../shared/utils/Logger";
import type { IMouseStrategy } from "./IMouseStrategy";

interface ExecResult {
  stdout: string;
  stderr: string;
}

export class LinuxMouseStrategy implements IMouseStrategy {
  private readonly xdotoolAvailable: boolean;

  constructor(private readonly logger: Logger) {
    this.xdotoolAvailable = this.checkDependencies();
  }

  public async move(dx: number, dy: number): Promise<void> {
    this.ensureAvailable();

    const locationResult = await this.execFileAsync("xdotool", ["getmouselocation"], { shell: false });
    const match = locationResult.stdout.match(/x:(-?\d+)\s+y:(-?\d+)/);

    if (!match) {
      throw new AppError("Failed to read the current mouse position", 500, "MOUSE_POSITION_READ_FAILED");
    }

    const currentX = Number.parseInt(match[1], 10);
    const currentY = Number.parseInt(match[2], 10);

    await this.execFileAsync(
      "xdotool",
      ["mousemove", "--", String(currentX + dx), String(currentY + dy)],
      { shell: false },
    );
  }

  public async click(button: "left" | "right"): Promise<void> {
    this.ensureAvailable();
    await this.execFileAsync("xdotool", ["click", button === "left" ? "1" : "3"], { shell: false });
  }

  public async scroll(dy: number): Promise<void> {
    this.ensureAvailable();

    const rounded = Math.round(dy);
    if (rounded === 0) {
      return;
    }

    const clickCode = rounded > 0 ? "5" : "4";
    const steps = Math.abs(rounded);

    for (let index = 0; index < steps; index += 1) {
      await this.execFileAsync("xdotool", ["click", clickCode], { shell: false });
    }
  }

  private checkDependencies(): boolean {
    try {
      execSync("which xdotool", { stdio: "ignore" });
      return true;
    } catch {
      this.logger.warn("xdotool not found. Mouse control is unavailable. Install it with: sudo apt install xdotool");
      return false;
    }
  }

  private ensureAvailable(): void {
    if (this.xdotoolAvailable) {
      return;
    }

    throw new AppError(
      "Mouse control is unavailable because xdotool is not installed",
      503,
      "MOUSE_CONTROL_UNAVAILABLE",
    );
  }

  private execFileAsync(command: string, args: string[], options: { shell: false }): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }
}
