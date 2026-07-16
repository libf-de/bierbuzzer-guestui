import { Router } from "express";
import { z } from "zod";
import { externalLogin } from "../auth/externalAuth";
import { asyncHandler, HttpError, parseBody } from "../http/helpers";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Unauthenticated login endpoint. Proxies credentials to the external auth
 * API and returns the apiKey (== accountId) the admin UI then sends as a
 * Bearer token. NOTE: this is the admin surface only — never used by guests.
 */
export function authRoutes(loginUrl: string, timeoutMs: number): Router {
  const router = Router();

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { username, password } = parseBody(loginSchema, req.body);
      const apiKey = await externalLogin(loginUrl, username, password, timeoutMs);
      if (!apiKey) throw new HttpError(401, "login failed");
      res.json({ apiKey });
    }),
  );

  return router;
}
