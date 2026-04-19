import { Router, type NextFunction, type Request, type Response } from "express";
import {
  createAppInputSchema,
  type CreateAppInput,
  type UpdateAppInput,
  updateAppInputSchema,
} from "./AppTypes";
import { AppsService } from "./AppsService";

export class AppsController {
  constructor(private readonly appsService: AppsService) {}

  public createUserRouter(): Router {
    const router = Router();

    router.get("/", (request, response, next) => this.getApps(request, response, next));

    return router;
  }

  public createAdminRouter(): Router {
    const router = Router();

    router.get("/", (request, response, next) => this.getApps(request, response, next));
    router.post("/", (request, response, next) => this.createApp(request, response, next));
    router.post("/pick-executable", (request, response, next) => this.pickExecutable(request, response, next));
    router.put("/:id", (request, response, next) => this.updateApp(request, response, next));
    router.delete("/:id", (request, response, next) => this.deleteApp(request, response, next));
    router.post("/scan", (request, response, next) => this.scanApps(request, response, next));

    return router;
  }

  private async getApps(_request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const apps = await this.appsService.getAppsForClient();
      response.status(200).json(apps);
    } catch (error) {
      next(error);
    }
  }

  private async createApp(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const payload = createAppInputSchema.parse(request.body) as CreateAppInput;
      const app = await this.appsService.createApp(payload);
      response.status(201).json(app);
    } catch (error) {
      next(error);
    }
  }

  private async pickExecutable(_request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const draft = await this.appsService.createDraftFromSystemPicker();
      response.status(200).json(draft);
    } catch (error) {
      next(error);
    }
  }

  private async updateApp(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const payload = updateAppInputSchema.parse(request.body) as UpdateAppInput;
      const app = await this.appsService.updateApp(request.params.id, payload);
      response.status(200).json(app);
    } catch (error) {
      next(error);
    }
  }

  private async deleteApp(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      await this.appsService.deleteApp(request.params.id);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  private async scanApps(_request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const scanned = await this.appsService.scanDefaultApps();
      response.status(200).json(scanned);
    } catch (error) {
      next(error);
    }
  }
}
