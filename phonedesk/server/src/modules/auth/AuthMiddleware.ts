import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { AuthService } from "./AuthService";

export class AuthMiddleware {
  constructor(private readonly authService: AuthService) {}

  public requireAuth = async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    try {
      const authorization = request.headers.authorization;

      if (!authorization || !authorization.startsWith("Bearer ")) {
        throw new AppError("Authorization is required", 401, "AUTH_REQUIRED");
      }

      const token = authorization.slice("Bearer ".length).trim();
      if (!token) {
        throw new AppError("Authorization is required", 401, "AUTH_REQUIRED");
      }

      request.auth = await this.authService.verifyToken(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}
