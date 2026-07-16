import { NextFunction, Request, Response } from "express";
import { AdminIdentity, AuthProvider } from "./types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminIdentity;
    }
  }
}

/** Express middleware factory guarding routes behind an AuthProvider. */
export function requireAdmin(provider: AuthProvider) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identity = await provider.authenticate(req);
      if (!identity) {
        res.setHeader("WWW-Authenticate", `${provider.scheme} realm="admin"`);
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      req.admin = identity;
      next();
    } catch (err) {
      next(err);
    }
  };
}
