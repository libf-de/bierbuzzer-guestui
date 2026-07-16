import { Router } from "express";
import { z } from "zod";
import { Database } from "../db/types";
import { DeviceService } from "../services/DeviceService";
import { AuthProvider, CredentialStore } from "../auth/types";
import { requireAdmin } from "../auth/middleware";
import { hashPassword } from "../auth/password";
import { asyncHandler, HttpError, parseBody } from "../http/helpers";

const macSchema = z.object({
  mac: z.string().min(1),
  label: z.string().min(1).optional(),
});

const articleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const adminSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
});

export interface AdminDeps {
  db: Database;
  devices: DeviceService;
  auth: AuthProvider;
  credentials: CredentialStore;
}

/** Authenticated admin API: device provisioning, menu + admin management. */
export function adminRoutes(deps: AdminDeps): Router {
  const router = Router();
  router.use(requireAdmin(deps.auth));

  // --- devices ---

  router.get(
    "/devices",
    asyncHandler(async (_req, res) => {
      res.json({ devices: await deps.devices.listDevices() });
    }),
  );

  router.post(
    "/devices",
    asyncHandler(async (req, res) => {
      const { mac, label } = parseBody(macSchema, req.body);
      const { device, password } = await deps.devices.provision(mac, label);
      // password + username returned once — flash them to the device now.
      res.status(201).json({
        device,
        credentials: { username: device.username, password },
      });
    }),
  );

  router.delete(
    "/devices/:topicId",
    asyncHandler(async (req, res) => {
      await deps.devices.deprovision(req.params.topicId);
      res.status(204).end();
    }),
  );

  // --- articles (menu / whitelist) ---

  router.get(
    "/articles",
    asyncHandler(async (_req, res) => {
      res.json({ articles: await deps.db.listArticles() });
    }),
  );

  router.post(
    "/articles",
    asyncHandler(async (req, res) => {
      const { id, name } = parseBody(articleSchema, req.body);
      if (await deps.db.getArticle(id)) throw new HttpError(409, `article exists: ${id}`);
      const article = await deps.db.createArticle({ id, name, createdAt: Date.now() });
      res.status(201).json({ article });
    }),
  );

  router.delete(
    "/articles/:id",
    asyncHandler(async (req, res) => {
      const ok = await deps.db.deleteArticle(req.params.id);
      if (!ok) throw new HttpError(404, "unknown article");
      res.status(204).end();
    }),
  );

  // --- admin users ---

  router.get(
    "/admins",
    asyncHandler(async (_req, res) => {
      res.json({ admins: await deps.credentials.listUsernames() });
    }),
  );

  router.post(
    "/admins",
    asyncHandler(async (req, res) => {
      const { username, password } = parseBody(adminSchema, req.body);
      if (await deps.credentials.getByUsername(username)) {
        throw new HttpError(409, `admin exists: ${username}`);
      }
      await deps.credentials.create({
        username,
        passwordHash: await hashPassword(password),
        createdAt: Date.now(),
      });
      res.status(201).json({ username });
    }),
  );

  router.delete(
    "/admins/:username",
    asyncHandler(async (req, res) => {
      const target = req.params.username;
      if (req.admin?.username === target) {
        throw new HttpError(400, "cannot delete the currently authenticated admin");
      }
      if ((await deps.credentials.count()) <= 1) {
        throw new HttpError(400, "cannot delete the last admin");
      }
      const ok = await deps.credentials.delete(target);
      if (!ok) throw new HttpError(404, "unknown admin");
      res.status(204).end();
    }),
  );

  return router;
}
