import { appendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "info" | "warn" | "error";

const MAX_AUDIT_SIZE_BYTES = 5 * 1024 * 1024;

export class Logger {
  constructor(
    private readonly auditLogPath: string,
    private readonly nodeEnv: string,
  ) {}

  public info(message: string, meta?: Record<string, unknown>): void {
    if (this.nodeEnv === "production") {
      return;
    }

    this.print("info", message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.print("warn", message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    this.print("error", message, meta);
  }

  public async audit(event: string, details: Record<string, unknown>): Promise<void> {
    await mkdir(path.dirname(this.auditLogPath), { recursive: true });
    await this.rotateAuditLogIfNeeded();

    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...details,
    });

    await appendFile(this.auditLogPath, `${line}\n`, "utf-8");
  }

  private print(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const payload = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...(meta ? { meta } : {}),
    };

    const output = JSON.stringify(payload);

    if (level === "error") {
      console.error(output);
      return;
    }

    if (level === "warn") {
      console.warn(output);
      return;
    }

    console.log(output);
  }

  private async rotateAuditLogIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.auditLogPath);

      if (info.size < MAX_AUDIT_SIZE_BYTES) {
        return;
      }

      const archivePath = `${this.auditLogPath}.1`;
      await rm(archivePath, { force: true });
      await rename(this.auditLogPath, archivePath);
      await writeFile(this.auditLogPath, "", "utf-8");
    } catch {
      // Nothing to rotate yet.
    }
  }
}
