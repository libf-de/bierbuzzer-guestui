export interface DeviceRecord {
  topicId: string;
  username: string;
  mac: string; // canonical 12-hex, no separators
  label?: string;
  createdAt: number;
}

export interface ArticleRecord {
  id: string; // article id used as MQTT payload
  name: string;
  createdAt: number;
}

/**
 * Persistence abstraction. Swap NeDbDatabase for a Mongo/Postgres impl
 * by implementing this interface — nothing else in the app touches the store.
 * Current article state is intentionally NOT stored here: it is read live
 * from the device over MQTT.
 */
export interface Database {
  init(): Promise<void>;

  // devices
  createDevice(rec: DeviceRecord): Promise<DeviceRecord>;
  getDeviceByTopicId(topicId: string): Promise<DeviceRecord | null>;
  getDeviceByMac(mac: string): Promise<DeviceRecord | null>;
  listDevices(): Promise<DeviceRecord[]>;
  deleteDevice(topicId: string): Promise<boolean>;

  // articles (the drink whitelist / menu)
  createArticle(rec: ArticleRecord): Promise<ArticleRecord>;
  getArticle(id: string): Promise<ArticleRecord | null>;
  listArticles(): Promise<ArticleRecord[]>;
  deleteArticle(id: string): Promise<boolean>;
}
