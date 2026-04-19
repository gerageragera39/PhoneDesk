import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import type { Logger } from "../../shared/utils/Logger";
import { JsonStorage } from "../../storage/JsonStorage";

export interface AuthConfig {
  pinHash?: string;
  jwtSecret?: string;
  forcePinChange?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface AttemptRecord {
  failures: number[];
  blockedUntil?: number;
}

export interface LoginResult {
  token: string;
  expiresInSeconds: number;
  mustChangePin: boolean;
}

const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const TOKEN_TTL = "8h";
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export class AuthService {
  private config: AuthConfig | null = null;
  private readonly attemptsByIp = new Map<string, AttemptRecord>();

  constructor(
    private readonly configStorage: JsonStorage<AuthConfig>,
    private readonly logger: Logger,
  ) {}

  public async bootstrap(): Promise<{ generatedPin?: string }> {
    try {
      await this.configStorage.ensureFile();
      const current = await this.configStorage.read();

      if (!current.pinHash || !current.jwtSecret) {
        const configuredInitialPin = process.env.INITIAL_PIN?.trim();
        const generatedPin =
          configuredInitialPin && /^\d{4,8}$/.test(configuredInitialPin)
            ? configuredInitialPin
            : this.generatePin(6);

        if (configuredInitialPin && !/^\d{4,8}$/.test(configuredInitialPin)) {
          this.logger.warn("INITIAL_PIN is invalid. Falling back to a generated PIN.");
        }

        const pinHash = await bcrypt.hash(generatedPin, 10);
        const jwtSecret = randomBytes(64).toString("hex");
        const createdAt = new Date().toISOString();

        this.config = {
          pinHash,
          jwtSecret,
          forcePinChange: true,
          createdAt,
          updatedAt: createdAt,
        };

        await this.configStorage.write(this.config);
        return { generatedPin };
      }

      this.config = {
        pinHash: current.pinHash,
        jwtSecret: current.jwtSecret,
        forcePinChange: current.forcePinChange ?? false,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      };

      return {};
    } catch (error) {
      this.logger.error("Failed to bootstrap authentication", {
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new AppError("Failed to initialize authentication", 500, "AUTH_INIT_FAILED");
    }
  }

  public async login(pin: string, ip: string): Promise<LoginResult> {
    try {
      const cfg = await this.getConfigOrThrow();
      this.assertNotBlocked(ip);

      const isValid = await bcrypt.compare(pin, cfg.pinHash);

      if (!isValid) {
        const retryAfterSeconds = this.registerFailureAndGetRetryAfter(ip);

        await this.logger.audit("auth.login.failed", {
          ip,
          reason: "invalid_pin",
          retryAfterSeconds,
        });

        if (retryAfterSeconds > 0) {
          throw new AppError("Too many failed attempts. Login is temporarily blocked.", 429, "AUTH_BLOCKED", {
            retryAfterSeconds,
          });
        }

        throw new AppError("Invalid PIN", 401, "AUTH_INVALID_PIN");
      }

      this.attemptsByIp.delete(ip);

      const token = jwt.sign({ sub: "phonedesk", role: "user" }, cfg.jwtSecret, { expiresIn: TOKEN_TTL });

      await this.logger.audit("auth.login.success", { ip });

      return {
        token,
        expiresInSeconds: TOKEN_TTL_SECONDS,
        mustChangePin: cfg.forcePinChange ?? false,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Authentication failed", 500, "AUTH_LOGIN_FAILED");
    }
  }

  public async verifyToken(token: string): Promise<JwtPayload & { sub: string; role: "user" | "admin" }> {
    try {
      const cfg = await this.getConfigOrThrow();
      const decoded = jwt.verify(token, cfg.jwtSecret);

      if (typeof decoded === "string") {
        throw new AppError("Invalid token", 401, "AUTH_TOKEN_INVALID");
      }

      const role = decoded.role === "admin" ? "admin" : "user";

      return {
        ...decoded,
        sub: String(decoded.sub ?? "phonedesk"),
        role,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Token is invalid or expired", 401, "AUTH_TOKEN_INVALID");
    }
  }

  public async changePin(currentPin: string, newPin: string, confirmPin: string): Promise<void> {
    try {
      if (newPin !== confirmPin) {
        throw new AppError("PIN confirmation does not match", 400, "AUTH_PIN_CONFIRM_MISMATCH");
      }

      if (!/^\d{4,8}$/.test(newPin)) {
        throw new AppError("PIN must contain 4 to 8 digits", 400, "AUTH_PIN_INVALID_FORMAT");
      }

      const cfg = await this.getConfigOrThrow();
      const isCurrentValid = await bcrypt.compare(currentPin, cfg.pinHash);

      if (!isCurrentValid) {
        throw new AppError("Current PIN is invalid", 401, "AUTH_CURRENT_PIN_INVALID");
      }

      const nextPinHash = await bcrypt.hash(newPin, 10);
      const nextConfig: AuthConfig = {
        ...cfg,
        pinHash: nextPinHash,
        forcePinChange: false,
        updatedAt: new Date().toISOString(),
      };

      await this.configStorage.write(nextConfig);
      this.config = nextConfig;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Failed to change PIN", 500, "AUTH_CHANGE_PIN_FAILED");
    }
  }

  public async isForcePinChangeEnabled(): Promise<boolean> {
    const cfg = await this.getConfigOrThrow();
    return cfg.forcePinChange ?? false;
  }

  private async getConfigOrThrow(): Promise<Required<Pick<AuthConfig, "pinHash" | "jwtSecret">> & AuthConfig> {
    if (this.config?.pinHash && this.config?.jwtSecret) {
      return this.config as Required<Pick<AuthConfig, "pinHash" | "jwtSecret">> & AuthConfig;
    }

    const loaded = await this.configStorage.read();

    if (!loaded.pinHash || !loaded.jwtSecret) {
      throw new AppError("Authentication configuration is missing", 500, "AUTH_CONFIG_MISSING");
    }

    this.config = loaded;
    return loaded as Required<Pick<AuthConfig, "pinHash" | "jwtSecret">> & AuthConfig;
  }

  private generatePin(length: number): string {
    let pin = "";

    for (let index = 0; index < length; index += 1) {
      pin += Math.floor(Math.random() * 10).toString();
    }

    return pin;
  }

  private assertNotBlocked(ip: string): void {
    const current = this.attemptsByIp.get(ip);

    if (!current?.blockedUntil) {
      return;
    }

    if (current.blockedUntil <= Date.now()) {
      this.attemptsByIp.delete(ip);
      return;
    }

    const retryAfterSeconds = Math.ceil((current.blockedUntil - Date.now()) / 1000);
    throw new AppError("Too many failed attempts. Login is temporarily blocked.", 429, "AUTH_BLOCKED", {
      retryAfterSeconds,
    });
  }

  private registerFailureAndGetRetryAfter(ip: string): number {
    const now = Date.now();
    const existing = this.attemptsByIp.get(ip) ?? { failures: [] };

    const recentFailures = existing.failures.filter((timestamp) => now - timestamp <= FAILURE_WINDOW_MS);
    recentFailures.push(now);

    const next: AttemptRecord = { failures: recentFailures };

    if (recentFailures.length >= MAX_FAILURES) {
      next.blockedUntil = now + BLOCK_DURATION_MS;
    }

    this.attemptsByIp.set(ip, next);

    if (!next.blockedUntil) {
      return 0;
    }

    return Math.ceil((next.blockedUntil - now) / 1000);
  }
}
