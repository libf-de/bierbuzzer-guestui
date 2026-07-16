import path from "path";
import fs from "fs";
import Datastore from "nedb-promises";
import { AdminRecord, CredentialStore } from "./types";

/** NeDB-backed admin credential store. */
export class NeDbCredentialStore implements CredentialStore {
  private readonly db: Datastore<AdminRecord>;

  constructor(filename: string) {
    const dir = path.dirname(path.resolve(filename));
    fs.mkdirSync(dir, { recursive: true });
    this.db = Datastore.create({ filename, autoload: false });
  }

  async init(): Promise<void> {
    await this.db.load();
    await this.db.ensureIndex({ fieldName: "username", unique: true });
  }

  async getByUsername(username: string): Promise<AdminRecord | null> {
    const doc = await this.db.findOne({ username });
    return doc ? strip(doc) : null;
  }

  async create(rec: AdminRecord): Promise<AdminRecord> {
    return strip(await this.db.insert(rec));
  }

  async delete(username: string): Promise<boolean> {
    const n = await this.db.remove({ username }, { multi: false });
    return n > 0;
  }

  async count(): Promise<number> {
    return this.db.count({});
  }

  async listUsernames(): Promise<string[]> {
    const docs = await this.db.find({}).sort({ createdAt: 1 });
    return docs.map((d) => d.username);
  }
}

function strip<T>(doc: T & { _id?: string }): T {
  const { _id, ...rest } = doc as T & { _id?: string };
  return rest as T;
}
