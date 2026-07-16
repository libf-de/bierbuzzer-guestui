import path from "path";
import fs from "fs";
import Datastore from "nedb-promises";
import { Database, DeviceRecord, PresetPatch, PresetRecord } from "./types";

export interface NeDbPaths {
  devicesPath: string;
  presetsPath: string;
}

/** NeDB-backed Database: one datastore each for devices, presets. */
export class NeDbDatabase implements Database {
  private readonly devices: Datastore<DeviceRecord>;
  private readonly presets: Datastore<PresetRecord>;

  constructor(paths: NeDbPaths) {
    for (const p of [paths.devicesPath, paths.presetsPath]) ensureDir(p);
    this.devices = Datastore.create({ filename: paths.devicesPath, autoload: false });
    this.presets = Datastore.create({ filename: paths.presetsPath, autoload: false });
  }

  async init(): Promise<void> {
    await this.devices.load();
    await this.presets.load();
    await this.devices.ensureIndex({ fieldName: "topicId", unique: true });
    await this.devices.ensureIndex({ fieldName: "mac", unique: true });
    await this.presets.ensureIndex({ fieldName: "id", unique: true });
  }

  // --- devices ---

  async createDevice(rec: DeviceRecord): Promise<DeviceRecord> {
    return strip(await this.devices.insert(rec));
  }

  async getDeviceByTopicId(topicId: string): Promise<DeviceRecord | null> {
    const doc = await this.devices.findOne({ topicId });
    return doc ? strip(doc) : null;
  }

  async getDeviceByMac(mac: string): Promise<DeviceRecord | null> {
    const doc = await this.devices.findOne({ mac });
    return doc ? strip(doc) : null;
  }

  async listDevicesByAccount(accountId: string): Promise<DeviceRecord[]> {
    const docs = await this.devices.find({ accountId }).sort({ createdAt: 1 });
    return docs.map(strip);
  }

  async deleteDevice(topicId: string): Promise<boolean> {
    const n = await this.devices.remove({ topicId }, { multi: false });
    return n > 0;
  }

  async setDevicePresets(topicId: string, presetIds: string[]): Promise<DeviceRecord | null> {
    const n = await this.devices.update(
      { topicId },
      { $set: { assignedPresetIds: presetIds } },
      {},
    );
    if (!n) return null;
    return this.getDeviceByTopicId(topicId);
  }

  // --- presets ---

  async createPreset(rec: PresetRecord): Promise<PresetRecord> {
    return strip(await this.presets.insert(rec));
  }

  async getPreset(id: string): Promise<PresetRecord | null> {
    const doc = await this.presets.findOne({ id });
    return doc ? strip(doc) : null;
  }

  async getPresetsByIds(ids: string[]): Promise<PresetRecord[]> {
    const docs = await this.presets.find({ id: { $in: ids } });
    return docs.map(strip);
  }

  async listPresetsByAccount(accountId: string): Promise<PresetRecord[]> {
    const docs = await this.presets.find({ accountId }).sort({ createdAt: 1 });
    return docs.map(strip);
  }

  async updatePreset(id: string, patch: PresetPatch): Promise<PresetRecord | null> {
    const n = await this.presets.update(
      { id },
      { $set: { name: patch.name, orderMode: patch.orderMode, articles: patch.articles } },
      {},
    );
    if (!n) return null;
    return this.getPreset(id);
  }

  async deletePreset(id: string): Promise<boolean> {
    const n = await this.presets.remove({ id }, { multi: false });
    return n > 0;
  }
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(path.resolve(filePath));
  fs.mkdirSync(dir, { recursive: true });
}

/** Drop NeDB's internal `_id` so records match the public record shape. */
function strip<T>(doc: T & { _id?: string }): T {
  const { _id, ...rest } = doc as T & { _id?: string };
  return rest as T;
}
