import compression from "compression";
import cors, { type CorsOptions } from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { ChildProcess } from "node:child_process";
import { chmodSync } from "node:fs";
import path from "node:path";
import { AppsController } from "./modules/apps/AppsController";
import type { AppEntry } from "./modules/apps/AppTypes";
import { AppsRepository } from "./modules/apps/AppsRepository";
import { AppsService } from "./modules/apps/AppsService";
import { AuthController } from "./modules/auth/AuthController";
import { AuthMiddleware } from "./modules/auth/AuthMiddleware";
import { AuthService, type AuthConfig } from "./modules/auth/AuthService";
import { LauncherController } from "./modules/launcher/LauncherController";
import { LauncherService } from "./modules/launcher/LauncherService";
import { LinuxLauncher } from "./modules/launcher/platform/LinuxLauncher";
import { WindowsLauncher } from "./modules/launcher/platform/WindowsLauncher";
import { MouseController } from "./modules/mouse/MouseController";
import { LinuxMouseStrategy } from "./modules/mouse/LinuxMouseStrategy";
import { MouseService } from "./modules/mouse/MouseService";
import { WindowsMouseStrategy } from "./modules/mouse/WindowsMouseStrategy";
import { AppConfig } from "./config/AppConfig";
import { errorHandler, notFoundHandler } from "./shared/middleware/ErrorHandler";
import { ipWhitelist } from "./shared/middleware/IpWhitelist";
import { apiRateLimiter, noStoreApiCache } from "./shared/middleware/RateLimiter";
import { Logger } from "./shared/utils/Logger";
import { PlatformDetector } from "./shared/utils/PlatformDetector";
import { JsonStorage } from "./storage/JsonStorage";

dotenv.config();

const isAllowedLocalOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    const host = url.hostname;

    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return true;
    }

    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
      return true;
    }

    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      return true;
    }

    return /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
};

const bootstrap = async (): Promise<void> => {
  const appConfig = new AppConfig();
  await appConfig.ensureRuntimeFiles();

  const logger = new Logger(appConfig.auditLogPath, appConfig.nodeEnv);
  const authStorage = new JsonStorage<AuthConfig>(appConfig.configFilePath, {});
  const appsStorage = new JsonStorage<AppEntry[]>(appConfig.platformAppsFilePath, []);

  const authService = new AuthService(authStorage, logger);
  const bootstrapAuthResult = await authService.bootstrap();

  if (process.platform !== "win32") {
    try {
      chmodSync(appConfig.configFilePath, 0o600);
    } catch (error) {
      logger.warn("Failed to apply 0600 permissions to config.json", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const appsRepository = new AppsRepository(appsStorage);
  const appsService = new AppsService(appsRepository, logger, appConfig.platform);

  const processMap = new Map<string, ChildProcess>();
  const launcherStrategy =
    appConfig.platform === "windows"
      ? new WindowsLauncher(processMap)
      : new LinuxLauncher(processMap, logger);

  const launcherService = new LauncherService(launcherStrategy, appsService, logger, processMap);
  const mouseStrategy =
    appConfig.platform === "windows" ? new WindowsMouseStrategy() : new LinuxMouseStrategy(logger);
  const mouseService = new MouseService(mouseStrategy, logger);

  const authController = new AuthController(authService);
  const appsController = new AppsController(appsService);
  const launcherController = new LauncherController(appsService, launcherService);
  const mouseController = new MouseController(mouseService);
  const authMiddleware = new AuthMiddleware(authService);

  const app = express();

  app.disable("x-powered-by");

  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      if (!origin || isAllowedLocalOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin not allowed"));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(compression());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "256kb" }));

  app.use("/api", noStoreApiCache);
  app.get("/api/health", (_request, response) => {
    response.status(200).json({
      status: "ok",
      platform: appConfig.platform,
      environment: appConfig.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api", (request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith("/mouse") || request.path === "/health") {
      next();
      return;
    }

    apiRateLimiter(request, response, next);
  });

  app.use("/api/auth", authController.createRouter(authMiddleware.requireAuth, ipWhitelist));
  app.use("/api/apps", authMiddleware.requireAuth, appsController.createUserRouter());
  app.use("/api/apps", authMiddleware.requireAuth, launcherController.createRouter());
  app.use("/api/mouse", authMiddleware.requireAuth, mouseController.createRouter());
  app.use("/api/admin/apps", ipWhitelist, authMiddleware.requireAuth, appsController.createAdminRouter());

  app.use(
    express.static(appConfig.publicDir, {
      maxAge: 86_400_000,
      index: false,
    }),
  );

  app.get("*", (request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith("/api")) {
      next();
      return;
    }

    const indexFilePath = path.resolve(appConfig.publicDir, "index.html");

    response.sendFile(indexFilePath, (error) => {
      if (error) {
        next();
      }
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  const server = app.listen(appConfig.port, appConfig.host, () => {
    logger.info(`PhoneDesk server is running on http://${appConfig.host}:${appConfig.port}`);

    const localIp = PlatformDetector.getLocalNetworkIp();

    if (bootstrapAuthResult.generatedPin) {
      console.log(
        `PhoneDesk is ready. Your temporary login PIN is ${bootstrapAuthResult.generatedPin}. Change it from the Admin page.`,
      );
    }

    console.log(`Open PhoneDesk on your phone: http://${localIp}:${appConfig.port}`);
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.warn(`Received ${signal}. Starting graceful shutdown...`);

    launcherService.closeAllSseConnections();

    server.close((error?: Error) => {
      if (error) {
        logger.error("HTTP server shutdown failed", { error: error.message });
        process.exit(1);
      }

      logger.warn("PhoneDesk stopped successfully");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced shutdown: graceful shutdown timeout reached");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(`PhoneDesk startup failed: ${message}`);
  process.exit(1);
});
