import { Router } from "express";
import { z } from "zod";
import { Database } from "../db/types";
import { MqttService } from "../services/MqttService";
import { asyncHandler, HttpError, parseBody } from "../http/helpers";

const setArticleSchema = z.object({
  articleId: z.string().min(1),
});

/**
 * Guest-facing API (reached via QR -> frontend). The QR encodes the
 * non-guessable topicId; no auth, but every action is scoped to that device
 * and article IDs are validated against the whitelist.
 */
export function guestRoutes(db: Database, mqtt: MqttService): Router {
  const router = Router();

  // Drink menu (whitelist).
  router.get(
    "/articles",
    asyncHandler(async (_req, res) => {
      const articles = await db.listArticles();
      res.json({ articles });
    }),
  );

  // Current device state — read live from device (via cached ack/status).
  router.get(
    "/devices/:topicId",
    asyncHandler(async (req, res) => {
      const device = await db.getDeviceByTopicId(req.params.topicId);
      if (!device) throw new HttpError(404, "unknown device");
      res.json({
        topicId: device.topicId,
        label: device.label ?? null,
        currentArticle: mqtt.getState(device.topicId),
      });
    }),
  );

  // Change the device's ordered article.
  router.post(
    "/devices/:topicId/article",
    asyncHandler(async (req, res) => {
      const { articleId } = parseBody(setArticleSchema, req.body);

      const device = await db.getDeviceByTopicId(req.params.topicId);
      if (!device) throw new HttpError(404, "unknown device");

      const article = await db.getArticle(articleId);
      if (!article) throw new HttpError(400, `unknown article: ${articleId}`);

      const result = await mqtt.setArticle(device.topicId, articleId);
      res.status(result.confirmed ? 200 : 202).json({
        articleId,
        confirmed: result.confirmed,
        state: result.state,
      });
    }),
  );

  return router;
}
