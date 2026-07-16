import { NextFunction, Request, Response } from "express";
import { HttpError } from "./helpers";
import { ConflictError, NotFoundError } from "../services/DeviceService";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "internal error";
  console.error("[error]", err);
  res.status(500).json({ error: message });
}
