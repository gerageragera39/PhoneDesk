import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { AppError } from "../../shared/errors/AppError";
import type { IMouseStrategy } from "./IMouseStrategy";

interface WorkerReply {
  ready?: boolean;
  ok?: boolean;
  error?: string;
}

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
}

const WORKER_BOOTSTRAP_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MouseNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[PSCustomObject]@{ ready = $true } | ConvertTo-Json -Compress | Write-Output
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $payload = $line | ConvertFrom-Json
    switch ($payload.type) {
      "move" {
        $point = New-Object MouseNative+POINT
        [MouseNative]::GetCursorPos([ref]$point) | Out-Null
        [MouseNative]::SetCursorPos($point.X + [int]$payload.dx, $point.Y + [int]$payload.dy) | Out-Null
      }
      "click" {
        if ($payload.button -eq "right") {
          [MouseNative]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
          [MouseNative]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
        } else {
          [MouseNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
          [MouseNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        }
      }
      "scroll" {
        [MouseNative]::mouse_event(0x0800, 0, 0, [int]$payload.dy * 120, [UIntPtr]::Zero)
      }
      default {
        throw "Unknown mouse command type: $($payload.type)"
      }
    }

    [PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress | Write-Output
  } catch {
    [PSCustomObject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
  }
}
`.trim();

export class WindowsMouseStrategy implements IMouseStrategy {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly pendingCommands: PendingCommand[] = [];
  private stdoutBuffer = "";
  private stderrBuffer = "";

  public async move(dx: number, dy: number): Promise<void> {
    await this.sendCommand({ type: "move", dx, dy });
  }

  public async click(button: "left" | "right"): Promise<void> {
    await this.sendCommand({ type: "click", button });
  }

  public async scroll(dy: number): Promise<void> {
    if (dy === 0) {
      return;
    }

    await this.sendCommand({ type: "scroll", dy });
  }

  private async sendCommand(command: Record<string, unknown>): Promise<void> {
    const worker = this.ensureWorker();
    await this.ensureWorkerReady();

    return new Promise<void>((resolve, reject) => {
      this.pendingCommands.push({ resolve, reject });

      worker.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) {
          const pending = this.pendingCommands.pop();
          pending?.reject(new AppError("Failed to send mouse command to the Windows worker", 500, "MOUSE_PIPE_WRITE_FAILED"));
        }
      });
    });
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker && !this.worker.killed) {
      return this.worker;
    }

    const worker = spawn(
      "powershell",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.worker = worker;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const handleReply = (reply: WorkerReply): void => {
        if (reply.ready) {
          resolve();
          return;
        }

        if (reply.ok === false) {
          reject(new AppError(reply.error || "Windows mouse worker failed to start", 500, "MOUSE_WORKER_INIT_FAILED"));
        }
      };

      const onData = (chunk: Buffer): void => {
        this.stdoutBuffer += chunk.toString("utf-8");
        this.stdoutBuffer = this.drainStdout(this.stdoutBuffer, handleReply);
      };

      worker.stdout.on("data", onData);
      worker.stderr.on("data", (chunk: Buffer) => {
        this.stderrBuffer += chunk.toString("utf-8");
      });

      worker.once("exit", (code) => {
        if (code !== 0) {
          reject(
            new AppError(
              this.stderrBuffer.trim() || `Windows mouse worker exited with code ${code ?? "unknown"}`,
              500,
              "MOUSE_WORKER_EXITED",
            ),
          );
        }
      });
    });

    worker.once("close", () => {
      const failure = new AppError(
        this.stderrBuffer.trim() || "Windows mouse worker closed unexpectedly",
        500,
        "MOUSE_WORKER_CLOSED",
      );

      while (this.pendingCommands.length > 0) {
        this.pendingCommands.shift()?.reject(failure);
      }

      this.worker = null;
      this.readyPromise = null;
    });

    worker.stdin.write(`${WORKER_BOOTSTRAP_SCRIPT}\n`);
    return worker;
  }

  private async ensureWorkerReady(): Promise<void> {
    if (!this.readyPromise) {
      throw new AppError("Windows mouse worker is not available", 500, "MOUSE_WORKER_MISSING");
    }

    await this.readyPromise;
  }

  private drainStdout(buffer: string, onBootstrapReply: (reply: WorkerReply) => void): string {
    let rest = buffer;

    while (rest.includes("\n")) {
      const separatorIndex = rest.indexOf("\n");
      const line = rest.slice(0, separatorIndex).trim();
      rest = rest.slice(separatorIndex + 1);

      if (!line) {
        continue;
      }

      let reply: WorkerReply;
      try {
        reply = JSON.parse(line) as WorkerReply;
      } catch {
        continue;
      }

      if (reply.ready || (reply.ok === false && !this.pendingCommands.length)) {
        onBootstrapReply(reply);
        continue;
      }

      const pending = this.pendingCommands.shift();
      if (!pending) {
        continue;
      }

      if (reply.ok) {
        pending.resolve();
      } else {
        pending.reject(new AppError(reply.error || "Windows mouse command failed", 500, "MOUSE_COMMAND_FAILED"));
      }
    }

    return rest;
  }
}
