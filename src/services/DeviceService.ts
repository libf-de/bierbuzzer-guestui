import { deriveCredentials, normalizeMac } from "../crypto/credentials";
import { Database, DeviceRecord } from "../db/types";
import { MqttService } from "./MqttService";
import { ProvisioningService } from "./ProvisioningService";

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

export interface ProvisionResult {
  device: DeviceRecord;
  /** Returned once, at creation time — the caller must flash/store it. */
  password: string;
}

/**
 * Orchestrates device lifecycle: derive creds -> provision in broker ->
 * record in registry, and the reverse on delete.
 */
export class DeviceService {
  constructor(
    private readonly db: Database,
    private readonly provisioning: ProvisioningService,
    private readonly mqtt: MqttService,
    private readonly secret: string,
  ) {}

  async provision(rawMac: string, label?: string): Promise<ProvisionResult> {
    const mac = normalizeMac(rawMac);

    if (await this.db.getDeviceByMac(mac)) {
      throw new ConflictError(`Device already provisioned for MAC ${mac}`);
    }

    const creds = deriveCredentials(mac, this.secret);

    // Provision in the broker first; only record it if that succeeds.
    await this.provisioning.createDeviceClient(creds.topicId, creds.password);

    let device: DeviceRecord;
    try {
      device = await this.db.createDevice({
        topicId: creds.topicId,
        username: creds.username,
        mac,
        label,
        createdAt: Date.now(),
      });
    } catch (err) {
      // Roll back the broker client so we don't orphan it.
      await this.provisioning.deleteDeviceClient(creds.topicId).catch(() => undefined);
      throw err;
    }

    return { device, password: creds.password };
  }

  async deprovision(topicId: string): Promise<void> {
    const device = await this.db.getDeviceByTopicId(topicId);
    if (!device) throw new NotFoundError(`Unknown device ${topicId}`);

    await this.provisioning.deleteDeviceClient(topicId);
    await this.mqtt.clearDevice(topicId).catch(() => undefined);
    await this.db.deleteDevice(topicId);
  }

  listDevices(): Promise<DeviceRecord[]> {
    return this.db.listDevices();
  }

  getDevice(topicId: string): Promise<DeviceRecord | null> {
    return this.db.getDeviceByTopicId(topicId);
  }
}
