import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, isAppError } from "../errors/AppError";
import type { Logger } from "../utils/Logger";

export const notFoundHandler = (_request: Request, response: Response): void => {
  response.status(404).json({ message: "Not Found" });
};

export const errorHandler = (logger: Logger) => {
  return (error: unknown, _request: Request, response: Response, _next: NextFunction): void => {
    if (error instanceof ZodError) {
      logger.warn("Validation failed", {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });

      response.status(400).json({
        message: "Invalid request payload",
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      });
      return;
    }

    if (isAppError(error)) {
      logger.warn(error.message, {
        code: error.code,
        details: error.details,
      });

      response.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      });
      return;
    }

    if (error instanceof Error) {
      logger.error(error.message, { stack: error.stack });
    } else {
      logger.error("Unhandled unknown error");
    }

    const fallback = new AppError("Internal Server Error", 500);
    response.status(fallback.statusCode).json({
      message: fallback.message,
      code: fallback.code,
    });
  };
};
