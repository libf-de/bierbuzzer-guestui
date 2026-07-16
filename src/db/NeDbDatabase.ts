import path from "path";
import fs from "fs";
import Datastore from "nedb-promises";
import { ArticleRecord, Database, DeviceRecord } from "./types";

export interface NeDbPaths {
  devicesPath: string;
  articlesPath: string;
}

/**
 * NeDB-backed implementation of the Database interface.
 * Holds two independent datastores (devices, articles) — one class, two DBs.
 */
export class NeDbDatabase implements Database {
  private readonly devices: Datastore<DeviceRecord>;
  private readonly articles: Datastore<ArticleRecord>;

  constructor(paths: NeDbPaths) {
    ensureDir(paths.devicesPath);
    ensureDir(paths.articlesPath);
    this.devices = Datastore.create({ filename: paths.devicesPath, autoload: false });
    this.articles = Datastore.create({ filename: paths.articlesPath, autoload: false });
  }

  async init(): Promise<void> {
    await this.devices.load();
    await this.articles.load();
    await this.devices.ensureIndex({ fieldName: "topicId", unique: true });
    await this.devices.ensureIndex({ fieldName: "mac", unique: true });
    await this.articles.ensureIndex({ fieldName: "id", unique: true });
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

  async listDevices(): Promise<DeviceRecord[]> {
    const docs = await this.devices.find({}).sort({ createdAt: 1 });
    return docs.map(strip);
  }

  async deleteDevice(topicId: string): Promise<boolean> {
    const n = await this.devices.remove({ topicId }, { multi: false });
    return n > 0;
  }

  // --- articles ---

  async createArticle(rec: ArticleRecord): Promise<ArticleRecord> {
    return strip(await this.articles.insert(rec));
  }

  async getArticle(id: string): Promise<ArticleRecord | null> {
    const doc = await this.articles.findOne({ id });
    return doc ? strip(doc) : null;
  }

  async listArticles(): Promise<ArticleRecord[]> {
    const docs = await this.articles.find({}).sort({ createdAt: 1 });
    return docs.map(strip);
  }

  async deleteArticle(id: string): Promise<boolean> {
    const n = await this.articles.remove({ id }, { multi: false });
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
