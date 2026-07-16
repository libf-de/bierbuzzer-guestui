import { z } from "zod";
import { ArticleRef, OrderMode, OrderModeName } from "../db/types";

/**
 * The MQTT config surface (see MQTT.md): exactly two settings are exchanged
 * with a device — `order_mode` and `articles`. A guest never sends these
 * directly; they are derived from the preset the guest selects.
 */
export interface DeviceConfig {
  order_mode?: OrderMode;
  articles?: ArticleRef[];
}

/** Effective config read back from a device's `config/ack`. */
export interface AckState {
  rev?: number | string;
  ok: boolean;
  orderMode: OrderMode | null;
  articles: ArticleRef[] | null;
  rejected: Record<string, string>;
  at: number;
}

/** `status` topic payload (availability via LWT + optional telemetry). */
export interface DeviceStatus {
  state: "online" | "offline";
  ip?: string;
  battery_mv?: number;
  rssi?: number;
  at: number;
}

/** Max serialized `articles` size the device accepts (incl. NUL). */
export const ARTICLES_MAX_BYTES = 2048;

/** All order modes (a freshly provisioned device allows all until narrowed). */
export const ALL_ORDER_MODES: OrderModeName[] = ["fixed", "random_article", "russian_roulette"];

const modeEnum = z.enum(["fixed", "random_article", "russian_roulette"]);

// Accepts the full object or the bare-string shorthand ("fixed" -> {mode:"fixed"}).
const orderModeSchema = z.union([
  modeEnum.transform((mode) => ({ mode })),
  z.object({
    mode: modeEnum,
    roulette_percent: z.number().int().min(0).max(100).optional(),
    random_category: z.string().max(63).optional(),
  }),
]);

const articleRefSchema = z.object({
  _id: z.string().min(1),
  combinedWith: z.array(z.string()).default([]),
  // Unit price captured from the catalog (display only; not sent to devices).
  price: z.number().optional(),
});

// --- admin: preset definition + device assignment ---

export const presetSchema = z.object({
  name: z.string().min(1),
  orderMode: orderModeSchema,
  articles: z.array(articleRefSchema),
});
export type PresetInput = z.infer<typeof presetSchema>;

export const assignPresetsSchema = z.object({
  presetIds: z.array(z.string().min(1)),
});

/** Parse a raw `config/ack` payload into an AckState (tolerant of shape). */
export function parseAck(payload: Buffer, at: number): AckState | null {
  let obj: any;
  try {
    obj = JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const applied = obj.applied ?? {};
  return {
    rev: obj.rev,
    ok: obj.ok === true,
    orderMode: applied.order_mode ?? null,
    articles: Array.isArray(applied.articles) ? applied.articles : null,
    rejected: obj.rejected && typeof obj.rejected === "object" ? obj.rejected : {},
    at,
  };
}

/** Parse a raw `status` payload into a DeviceStatus. */
export function parseStatus(payload: Buffer, at: number): DeviceStatus | null {
  let obj: any;
  try {
    obj = JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
  if (!obj || (obj.state !== "online" && obj.state !== "offline")) return null;
  return {
    state: obj.state,
    ip: typeof obj.ip === "string" ? obj.ip : undefined,
    battery_mv: typeof obj.battery_mv === "number" ? obj.battery_mv : undefined,
    rssi: typeof obj.rssi === "number" ? obj.rssi : undefined,
    at,
  };
}
