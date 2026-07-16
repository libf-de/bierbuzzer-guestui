import mqtt, { MqttClient } from "mqtt";

export interface DeviceState {
  articleId: string;
  at: number;
  source: "ack" | "status";
}

export interface SetResult {
  confirmed: boolean;
  state: DeviceState | null;
}

interface MqttServiceOptions {
  url: string;
  username: string;
  password: string;
  ackTimeoutMs: number;
}

const CONFIG_SET = (topicId: string) => `devices/${topicId}/config/set`;
const ACK_WILDCARD = "devices/+/config/ack";
const STATUS_WILDCARD = "devices/+/status";

/**
 * Owns the server's MQTT connection. Only the server publishes to device
 * config topics. Current article state is not persisted — it is tracked in
 * memory from device-published ack/status messages (live from device).
 */
export class MqttService {
  private client: MqttClient | null = null;
  private readonly opts: MqttServiceOptions;

  /** Last known state per device, learned from ack/status. */
  private readonly states = new Map<string, DeviceState>();
  /** In-flight config/set calls awaiting an ack, keyed by topicId. */
  private readonly pending = new Map<
    string,
    { articleId: string; resolve: (r: SetResult) => void; timer: NodeJS.Timeout }
  >();

  constructor(opts: MqttServiceOptions) {
    this.opts = opts;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(this.opts.url, {
        username: this.opts.username,
        password: this.opts.password,
        reconnectPeriod: 2000,
        clean: true,
      });

      let settled = false;

      client.on("connect", () => {
        client.subscribe([ACK_WILDCARD, STATUS_WILDCARD], { qos: 1 }, (err) => {
          if (err && !settled) {
            settled = true;
            reject(err);
            return;
          }
          if (!settled) {
            settled = true;
            resolve();
          }
        });
      });

      client.on("message", (topic, payload) => this.onMessage(topic, payload));

      client.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else {
          console.error("[mqtt] error:", err.message);
        }
      });

      this.client = client;
    });
  }

  private onMessage(topic: string, payload: Buffer): void {
    // devices/<topicId>/config/ack   or   devices/<topicId>/status
    const parts = topic.split("/");
    if (parts.length < 3 || parts[0] !== "devices") return;
    const topicId = parts[1];
    const kind = parts.slice(2).join("/");
    const source: DeviceState["source"] =
      kind === "config/ack" ? "ack" : kind === "status" ? "status" : null!;
    if (!source) return;

    const articleId = parseArticleId(payload);
    if (articleId == null) return;

    const state: DeviceState = { articleId, at: Date.now(), source };
    this.states.set(topicId, state);

    const waiter = this.pending.get(topicId);
    if (waiter && (source === "ack" || waiter.articleId === articleId)) {
      clearTimeout(waiter.timer);
      this.pending.delete(topicId);
      waiter.resolve({ confirmed: true, state });
    }
  }

  /** Last known state for a device, or null if none seen yet. */
  getState(topicId: string): DeviceState | null {
    return this.states.get(topicId) ?? null;
  }

  /**
   * Publish a new article to the device (retained, QoS1) and wait for the
   * device to ack. Resolves confirmed:false on ack timeout — the config is
   * still retained by the broker and will reach the device on reconnect.
   */
  setArticle(topicId: string, articleId: string): Promise<SetResult> {
    if (!this.client) throw new Error("MQTT not connected");
    const client = this.client;
    const payload = JSON.stringify({ articleId });

    return new Promise<SetResult>((resolve, reject) => {
      client.publish(CONFIG_SET(topicId), payload, { qos: 1, retain: true }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        // Replace any prior waiter for this device (last write wins).
        const prev = this.pending.get(topicId);
        if (prev) {
          clearTimeout(prev.timer);
          prev.resolve({ confirmed: false, state: this.getState(topicId) });
        }
        const timer = setTimeout(() => {
          this.pending.delete(topicId);
          resolve({ confirmed: false, state: this.getState(topicId) });
        }, this.opts.ackTimeoutMs);
        this.pending.set(topicId, { articleId, resolve, timer });
      });
    });
  }

  /** Clear retained config for a removed device and drop cached state. */
  clearDevice(topicId: string): Promise<void> {
    this.states.delete(topicId);
    const waiter = this.pending.get(topicId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.pending.delete(topicId);
      waiter.resolve({ confirmed: false, state: null });
    }
    if (!this.client) return Promise.resolve();
    const client = this.client;
    return new Promise((resolve, reject) => {
      // Empty retained payload deletes the retained message.
      client.publish(CONFIG_SET(topicId), "", { qos: 1, retain: true }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async close(): Promise<void> {
    for (const w of this.pending.values()) clearTimeout(w.timer);
    this.pending.clear();
    await new Promise<void>((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, () => resolve());
    });
  }
}

function parseArticleId(payload: Buffer): string | null {
  const text = payload.toString("utf8").trim();
  if (text === "") return null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.articleId === "string") return obj.articleId;
    return null;
  } catch {
    // tolerate a bare string payload
    return text;
  }
}
