import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { Database, PresetRecord } from "../db/types";
import { DeviceService } from "../services/DeviceService";
import { CatalogSource } from "../services/CatalogSource";
import {
  ARTICLES_MAX_BYTES,
  assignPresetsSchema,
  presetSchema,
} from "../services/deviceConfig";
import { AuthProvider } from "../auth/types";
import { requireAdmin } from "../auth/middleware";
import { asyncHandler, HttpError, parseBody } from "../http/helpers";

const macSchema = z.object({
  mac: z.string().min(1),
  label: z.string().min(1).optional(),
});

const labelSchema = z.object({
  label: z.string().trim().max(100),
});

export interface AdminDeps {
  db: Database;
  devices: DeviceService;
  auth: AuthProvider;
  catalog: CatalogSource;
}

/** Authenticated admin API. Every route is scoped to req.admin.accountId. */
export function adminRoutes(deps: AdminDeps): Router {
  const router = Router();
  router.use(requireAdmin(deps.auth));

  const accountId = (req: { admin?: { accountId: string } }): string => {
    const id = req.admin?.accountId;
    if (!id) throw new HttpError(401, "unauthorized");
    return id;
  };

  // Load a preset and assert it belongs to the caller's account.
  const ownedPreset = async (id: string, acc: string): Promise<PresetRecord> => {
    const preset = await deps.db.getPreset(id);
    if (!preset || preset.accountId !== acc) throw new HttpError(404, "unknown preset");
    return preset;
  };

  const assertArticlesFit = (articles: unknown): void => {
    const bytes = Buffer.byteLength(JSON.stringify(articles));
    if (bytes > ARTICLES_MAX_BYTES) {
      throw new HttpError(400, `articles payload ${bytes} bytes exceeds ${ARTICLES_MAX_BYTES}`);
    }
  };

  // --- account (identity readback, used to validate the token) + catalog ---

  router.get(
    "/account",
    asyncHandler(async (req, res) => {
      accountId(req); // assert authenticated
      // Admin surface only. Returns the account name — never the apiKey.
      res.json({ name: req.admin?.name ?? null });
    }),
  );

  router.get(
    "/catalog",
    asyncHandler(async (req, res) => {
      // accountId == apiKey used to fetch the account's cloud catalog.
      res.json({ categories: await deps.catalog.listCategories(accountId(req)) });
    }),
  );

  // --- presets ---

  router.get(
    "/presets",
    asyncHandler(async (req, res) => {
      res.json({ presets: await deps.db.listPresetsByAccount(accountId(req)) });
    }),
  );

  router.post(
    "/presets",
    asyncHandler(async (req, res) => {
      const input = parseBody(presetSchema, req.body);
      const { articles, articlePrices } = splitArticles(input.articles);
      assertArticlesFit(articles);
      const preset = await deps.db.createPreset({
        id: randomUUID(),
        accountId: accountId(req),
        name: input.name,
        orderMode: input.orderMode,
        articles,
        articlePrices,
        createdAt: Date.now(),
      });
      res.status(201).json({ preset });
    }),
  );

  router.put(
    "/presets/:id",
    asyncHandler(async (req, res) => {
      const acc = accountId(req);
      await ownedPreset(req.params.id, acc);
      const input = parseBody(presetSchema, req.body);
      const { articles, articlePrices } = splitArticles(input.articles);
      assertArticlesFit(articles);
      const preset = await deps.db.updatePreset(req.params.id, {
        name: input.name,
        orderMode: input.orderMode,
        articles,
        articlePrices,
      });
      res.json({ preset });
    }),
  );

  router.delete(
    "/presets/:id",
    asyncHandler(async (req, res) => {
      await ownedPreset(req.params.id, accountId(req));
      await deps.db.deletePreset(req.params.id);
      res.status(204).end();
    }),
  );

  // --- devices ---

  router.get(
    "/devices",
    asyncHandler(async (req, res) => {
      res.json({ devices: await deps.devices.listDevices(accountId(req)) });
    }),
  );

  router.post(
    "/devices",
    asyncHandler(async (req, res) => {
      const { mac, label } = parseBody(macSchema, req.body);
      const { device, password } = await deps.devices.provision(mac, accountId(req), label);
      res.status(201).json({ device, credentials: { username: device.username, password } });
    }),
  );

  router.put(
    "/devices/:topicId/label",
    asyncHandler(async (req, res) => {
      await ownedDevice(deps, req.params.topicId, accountId(req));
      const { label } = parseBody(labelSchema, req.body);
      const device = await deps.db.setDeviceLabel(req.params.topicId, label);
      res.json({ device });
    }),
  );

  router.delete(
    "/devices/:topicId",
    asyncHandler(async (req, res) => {
      await ownedDevice(deps, req.params.topicId, accountId(req));
      await deps.devices.deprovision(req.params.topicId);
      res.status(204).end();
    }),
  );

  router.put(
    "/devices/:topicId/presets",
    asyncHandler(async (req, res) => {
      const acc = accountId(req);
      await ownedDevice(deps, req.params.topicId, acc);
      const { presetIds } = parseBody(assignPresetsSchema, req.body);

      // Every assigned preset must belong to this account.
      const found = await deps.db.getPresetsByIds(presetIds);
      const ownedIds = new Set(found.filter((p) => p.accountId === acc).map((p) => p.id));
      const bad = presetIds.filter((id) => !ownedIds.has(id));
      if (bad.length) throw new HttpError(400, `unknown preset(s): ${bad.join(", ")}`);

      const device = await deps.db.setDevicePresets(req.params.topicId, presetIds);
      res.json({ device });
    }),
  );

  return router;
}

/** Assert a device exists and belongs to the account. */
async function ownedDevice(deps: AdminDeps, topicId: string, accountId: string): Promise<void> {
  const device = await deps.db.getDeviceByTopicId(topicId);
  if (!device || device.accountId !== accountId) throw new HttpError(404, "unknown device");
}

/** Split incoming preset articles into device payload + a price map. */
function splitArticles(
  items: Array<{ _id: string; combinedWith: string[]; price?: number }>,
): { articles: Array<{ _id: string; combinedWith: string[] }>; articlePrices: Record<string, number> } {
  const articles = items.map((a) => ({ _id: a._id, combinedWith: a.combinedWith }));
  const articlePrices: Record<string, number> = {};
  for (const a of items) if (typeof a.price === "number") articlePrices[a._id] = a.price;
  return { articles, articlePrices };
}
