import type { NextFunction, Request, Response } from "express";

const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const extractIp = (request: Request): string => {
  const forwardedForHeader = request.headers["x-forwarded-for"];

  if (typeof forwardedForHeader === "string" && forwardedForHeader.length > 0) {
    const candidate = forwardedForHeader.split(",")[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  if (Array.isArray(forwardedForHeader) && forwardedForHeader.length > 0) {
    const candidate = forwardedForHeader[0]?.split(",")[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return request.ip || request.socket.remoteAddress || "";
};

export const ipWhitelist = (request: Request, response: Response, next: NextFunction): void => {
  const rawIp = extractIp(request);
  const ip = rawIp.startsWith("::ffff:") ? rawIp.slice("::ffff:".length) : rawIp;

  if (LOCALHOST_IPS.has(rawIp) || LOCALHOST_IPS.has(ip)) {
    next();
    return;
  }

  response.status(403).json({
    message: "Forbidden: admin endpoints are available only from localhost",
  });
};
