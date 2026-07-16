import { Router } from "express";
import { z } from "zod";
import { Database, PresetRecord } from "../db/types";
import { MqttService } from "../services/MqttService";
import { ARTICLES_MAX_BYTES } from "../services/deviceConfig";
import { asyncHandler, HttpError, parseBody } from "../http/helpers";

const selectSchema = z.object({ presetId: z.string().min(1) });

/**
 * Price shown per preset: a total sum for fixed / russian_roulette (all
 * articles ordered), or a min–max span for random_article (one is picked).
 * null when no article prices are known.
 */
function presetPrice(p: PresetRecord): { total?: number; min?: number; max?: number } | null {
  const prices = p.articles
    .map((a) => p.articlePrices?.[a._id])
    .filter((n): n is number => typeof n === "number");
  if (!prices.length) return null;
  if (p.orderMode.mode === "random_article") {
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }
  return { total: prices.reduce((sum, n) => sum + n, 0) };
}

/**
 * Guest-facing API (reached via QR -> frontend). The QR encodes the
 * non-guessable topicId. No auth. A guest can only select one of the presets
 * the admin assigned to this device.
 */
export function guestRoutes(db: Database, mqtt: MqttService): Router {
  const router = Router();

  // Device's assigned presets + live effective config/status, for rendering.
  router.get(
    "/devices/:topicId",
    asyncHandler(async (req, res) => {
      const device = await db.getDeviceByTopicId(req.params.topicId);
      if (!device) throw new HttpError(404, "unknown device");

      const presets = await db.getPresetsByIds(device.assignedPresetIds);
      // Preserve assignment order and drop any dangling (deleted) presets.
      const byId = new Map(presets.map((p) => [p.id, p]));
      const ordered = device.assignedPresetIds
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({
          id: p.id,
          name: p.name,
          orderMode: p.orderMode,
          articles: p.articles,
          price: presetPrice(p),
        }));

      res.json({
        topicId: device.topicId,
        label: device.label ?? null,
        presets: ordered,
        applied: mqtt.getAck(device.topicId),
        status: mqtt.getStatus(device.topicId),
      });
    }),
  );

  // Apply a preset (must be assigned to this device).
  router.post(
    "/devices/:topicId/select",
    asyncHandler(async (req, res) => {
      const { presetId } = parseBody(selectSchema, req.body);

      const device = await db.getDeviceByTopicId(req.params.topicId);
      if (!device) throw new HttpError(404, "unknown device");
      if (!device.assignedPresetIds.includes(presetId)) {
        throw new HttpError(400, "preset not available for this device");
      }

      const preset = await db.getPreset(presetId);
      if (!preset || preset.accountId !== device.accountId) {
        throw new HttpError(404, "unknown preset");
      }

      const bytes = Buffer.byteLength(JSON.stringify(preset.articles));
      if (bytes > ARTICLES_MAX_BYTES) {
        throw new HttpError(400, `articles payload ${bytes} bytes exceeds ${ARTICLES_MAX_BYTES}`);
      }

      const result = await mqtt.setConfig(device.topicId, {
        order_mode: preset.orderMode,
        articles: preset.articles,
      });
      res.status(result.confirmed ? 200 : 202).json({
        presetId,
        confirmed: result.confirmed,
        ack: result.ack,
      });
    }),
  );

  return router;
}
