import mqtt, { MqttClient } from "mqtt";
import { Provisioner } from "./Provisioner";

const CONTROL_TOPIC = "$CONTROL/dynamic-security/v1";
const CONTROL_RESPONSE_TOPIC = "$CONTROL/dynamic-security/v1/response";

interface DynsecResponse {
  command: string;
  error?: string;
  data?: unknown;
}

interface MqttProvisioningOptions {
  url: string;
  /** dynsec admin identity (has ACL to the control topic) */
  username: string;
  password: string;
  timeoutMs: number;
}

/**
 * Provisions dynsec clients/roles/ACLs by publishing JSON command batches to
 * the dynamic-security control topic over a dedicated admin MQTT connection —
 * no mosquitto_ctrl / docker / mosquitto-clients dependency.
 *
 * dynsec replies to a batch with a single message on the response topic and
 * has no correlation id, so calls are serialized (one batch in flight).
 */
export class MqttProvisioningService implements Provisioner {
  private client: MqttClient | null = null;
  private waiter: ((responses: DynsecResponse[]) => void) | null = null;
  /** serializes command batches */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: MqttProvisioningOptions) {}

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
        client.subscribe(CONTROL_RESPONSE_TOPIC, { qos: 1 }, (err) => {
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

      client.on("message", (topic, payload) => {
        if (topic === CONTROL_RESPONSE_TOPIC) this.onResponse(payload);
      });

      client.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else {
          console.error("[mqtt-provision] error:", err.message);
        }
      });

      this.client = client;
    });
  }

  private onResponse(payload: Buffer): void {
    const waiter = this.waiter;
    this.waiter = null;
    if (!waiter) return;
    try {
      const obj = JSON.parse(payload.toString("utf8"));
      waiter(Array.isArray(obj?.responses) ? obj.responses : []);
    } catch {
      waiter([]);
    }
  }

  private send(commands: Record<string, unknown>[]): Promise<DynsecResponse[]> {
    const run = () =>
      new Promise<DynsecResponse[]>((resolve, reject) => {
        const client = this.client;
        if (!client) {
          reject(new Error("provisioning MQTT not connected"));
          return;
        }
        const timer = setTimeout(() => {
          this.waiter = null;
          reject(new Error("dynsec control timeout"));
        }, this.opts.timeoutMs);

        this.waiter = (responses) => {
          clearTimeout(timer);
          resolve(responses);
        };

        client.publish(CONTROL_TOPIC, JSON.stringify({ commands }), { qos: 1 }, (err) => {
          if (err) {
            clearTimeout(timer);
            this.waiter = null;
            reject(err);
          }
        });
      });

    // Chain after any in-flight batch so responses can't interleave.
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private ensureOk(responses: DynsecResponse[], tolerate?: (error: string) => boolean): void {
    for (const r of responses) {
      if (r.error && !(tolerate && tolerate(r.error))) {
        throw new Error(`dynsec ${r.command} failed: ${r.error}`);
      }
    }
  }

  /**
   * Ensure the backend's own least-privilege client + role exist, with the
   * configured password. Idempotent — safe to run on every startup. ACLs:
   * publish config/set, subscribe config/ack + status (wildcards).
   */
  async ensureServerClient(username: string, password: string): Promise<void> {
    const role = "server_role";
    const responses = await this.send([
      { command: "createClient", username, password },
      { command: "setClientPassword", username, password },
      { command: "createRole", rolename: role },
      {
        command: "addRoleACL",
        rolename: role,
        acltype: "publishClientSend",
        topic: "devices/+/config/set",
        allow: true,
      },
      {
        command: "addRoleACL",
        rolename: role,
        acltype: "subscribePattern",
        topic: "devices/+/config/ack",
        allow: true,
      },
      {
        command: "addRoleACL",
        rolename: role,
        acltype: "subscribePattern",
        topic: "devices/+/status",
        allow: true,
      },
      { command: "addClientRole", username, rolename: role },
    ]);
    // Re-runs re-send create/add commands — tolerate "already exists".
    this.ensureOk(responses, (e) => /exists|duplicate/i.test(e));
  }

  async createDeviceClient(topicId: string, password: string): Promise<void> {
    const username = `device_${topicId}`;
    const role = `role_${topicId}`;
    const responses = await this.send([
      { command: "createClient", username, password },
      { command: "createRole", rolename: role },
      {
        command: "addRoleACL",
        rolename: role,
        acltype: "subscribePattern",
        topic: `devices/${topicId}/config/set`,
        allow: true,
      },
      {
        command: "addRoleACL",
        rolename: role,
        acltype: "publishClientSend",
        topic: `devices/${topicId}/config/ack`,
        allow: true,
      },
      {
        command: "addRoleACL",
        rolename: role,
        acltype: "publishClientSend",
        topic: `devices/${topicId}/status`,
        allow: true,
      },
      { command: "addClientRole", username, rolename: role },
    ]);
    this.ensureOk(responses);
  }

  async deleteDeviceClient(topicId: string): Promise<void> {
    const username = `device_${topicId}`;
    const role = `role_${topicId}`;
    const responses = await this.send([
      { command: "deleteClient", username },
      { command: "deleteRole", rolename: role },
    ]);
    // Idempotent teardown: ignore "already gone".
    this.ensureOk(responses, (e) => /not\s*found|does not exist|not exist/i.test(e));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, () => resolve());
    });
  }
}
