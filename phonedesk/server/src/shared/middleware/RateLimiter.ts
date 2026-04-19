import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many requests. Please try again in a minute.",
  },
});

export const mouseRateLimiter = rateLimit({
  windowMs: 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many mouse requests. Please try again in a second.",
  },
});

export const noStoreApiCache = (_request: Request, response: Response, next: NextFunction): void => {
  response.setHeader("Cache-Control", "no-store");
  next();
};
