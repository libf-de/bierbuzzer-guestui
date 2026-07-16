import mqtt, { MqttClient } from "mqtt";
import { AckState, DeviceConfig, DeviceStatus, parseAck, parseStatus } from "./deviceConfig";

export interface SetResult {
  /** true if the device acked this exact rev before the timeout */
  confirmed: boolean;
  /** latest known effective config (from config/ack) */
  ack: AckState | null;
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
 * config topics (config/set, retained QoS1 per MQTT.md). Effective config and
 * availability are not persisted — they are tracked in memory from device
 * config/ack and status messages.
 */
export class MqttService {
  private client: MqttClient | null = null;
  private readonly opts: MqttServiceOptions;

  /** Last config/ack per device (= current effective config). */
  private readonly acks = new Map<string, AckState>();
  /** Last status per device (online/offline + telemetry). */
  private readonly statuses = new Map<string, DeviceStatus>();
  /** In-flight config/set calls awaiting an ack, keyed by topicId. */
  private readonly pending = new Map<
    string,
    { rev: number; resolve: (r: SetResult) => void; timer: NodeJS.Timeout }
  >();
  private revSeq = 0;

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
    const parts = topic.split("/");
    if (parts.length < 3 || parts[0] !== "devices") return;
    const topicId = parts[1];
    const kind = parts.slice(2).join("/");
    const now = Date.now();

    if (kind === "config/ack") {
      const ack = parseAck(payload, now);
      if (!ack) return;
      this.acks.set(topicId, ack);
      const waiter = this.pending.get(topicId);
      if (waiter && String(ack.rev) === String(waiter.rev)) {
        clearTimeout(waiter.timer);
        this.pending.delete(topicId);
        waiter.resolve({ confirmed: true, ack });
      }
    } else if (kind === "status") {
      const status = parseStatus(payload, now);
      if (status) this.statuses.set(topicId, status);
    }
  }

  getAck(topicId: string): AckState | null {
    return this.acks.get(topicId) ?? null;
  }

  getStatus(topicId: string): DeviceStatus | null {
    return this.statuses.get(topicId) ?? null;
  }

  /**
   * Publish a config/set (retained, QoS1) with a fresh rev and wait for the
   * device to ack that rev. Resolves confirmed:false on timeout — the config
   * is retained and reaches the device on reconnect.
   */
  setConfig(topicId: string, config: DeviceConfig): Promise<SetResult> {
    if (!this.client) throw new Error("MQTT not connected");
    const client = this.client;
    const rev = ++this.revSeq;
    const payload = JSON.stringify({ rev, ...config });

    return new Promise<SetResult>((resolve, reject) => {
      client.publish(CONFIG_SET(topicId), payload, { qos: 1, retain: true }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        // Supersede any prior waiter for this device (last write wins).
        const prev = this.pending.get(topicId);
        if (prev) {
          clearTimeout(prev.timer);
          prev.resolve({ confirmed: false, ack: this.getAck(topicId) });
        }
        const timer = setTimeout(() => {
          this.pending.delete(topicId);
          resolve({ confirmed: false, ack: this.getAck(topicId) });
        }, this.opts.ackTimeoutMs);
        this.pending.set(topicId, { rev, resolve, timer });
      });
    });
  }

  /** Clear retained config + cached state for a removed device. */
  clearDevice(topicId: string): Promise<void> {
    this.acks.delete(topicId);
    this.statuses.delete(topicId);
    const waiter = this.pending.get(topicId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.pending.delete(topicId);
      waiter.resolve({ confirmed: false, ack: null });
    }
    if (!this.client) return Promise.resolve();
    const client = this.client;
    return new Promise((resolve, reject) => {
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
