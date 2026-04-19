import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { AuthService } from "./AuthService";

const loginSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/),
});

const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{4,8}$/),
  newPin: z.string().regex(/^\d{4,8}$/),
  confirmPin: z.string().regex(/^\d{4,8}$/),
});

const getClientIp = (request: Request): string => {
  const forwardedForHeader = request.headers["x-forwarded-for"];

  if (typeof forwardedForHeader === "string" && forwardedForHeader.length > 0) {
    const first = forwardedForHeader.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return request.ip || request.socket.remoteAddress || "unknown";
};

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  public createRouter(authMiddleware: RequestHandler, localhostOnlyMiddleware: RequestHandler): Router {
    const router = Router();

    router.post("/login", (request, response, next) => this.login(request, response, next));
    router.get("/verify", authMiddleware, (request, response, next) => this.verify(request, response, next));
    router.post(
      "/change-pin",
      authMiddleware,
      localhostOnlyMiddleware,
      (request, response, next) => this.changePin(request, response, next),
    );

    return router;
  }

  private async login(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const payload = loginSchema.parse(request.body);
      const result = await this.authService.login(payload.pin, getClientIp(request));

      response.status(200).json({
        token: result.token,
        expiresInSeconds: result.expiresInSeconds,
        mustChangePin: result.mustChangePin,
      });
    } catch (error) {
      next(error);
    }
  }

  private async verify(_request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const mustChangePin = await this.authService.isForcePinChangeEnabled();
      response.status(200).json({ valid: true, mustChangePin });
    } catch (error) {
      next(error);
    }
  }

  private async changePin(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const payload = changePinSchema.parse(request.body);
      await this.authService.changePin(payload.currentPin, payload.newPin, payload.confirmPin);
      response.status(200).json({ message: "PIN updated successfully" });
    } catch (error) {
      next(error);
    }
  }
}
