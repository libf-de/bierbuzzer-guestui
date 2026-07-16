// ---- domain value types ----

export type OrderModeName = "fixed" | "random_article" | "russian_roulette";

export interface OrderMode {
  mode: OrderModeName;
  roulette_percent?: number;
  random_category?: string;
}

/** An article as sent to a device (MQTT.md). `combinedWith` = extras. */
export interface ArticleRef {
  _id: string;
  combinedWith: string[];
}

/** An article/category in the (mock) source catalog the admin picks from. */
export interface CatalogArticle {
  _id: string;
  name: string;
}

export interface CatalogCategory {
  name: string;
  articles: CatalogArticle[];
}

// ---- records ----

export interface AccountRecord {
  id: string;
  name: string;
  createdAt: number;
}

export interface DeviceRecord {
  topicId: string;
  username: string;
  mac: string; // canonical 12-hex, no separators
  label?: string;
  accountId: string;
  /** Presets (of the same account) a guest may choose at this device. */
  assignedPresetIds: string[];
  createdAt: number;
}

/**
 * An account-level, admin-defined configuration a guest can select as a whole.
 * Selecting a preset publishes `{ order_mode, articles }` to the device.
 */
export interface PresetRecord {
  id: string;
  accountId: string;
  name: string;
  orderMode: OrderMode;
  articles: ArticleRef[];
  createdAt: number;
}

export interface PresetPatch {
  name: string;
  orderMode: OrderMode;
  articles: ArticleRef[];
}

/**
 * Persistence abstraction. Swap NeDbDatabase for a Mongo/Postgres impl by
 * implementing this interface. All admin-facing reads are account-scoped.
 * Effective device config is NOT stored — it is read live over MQTT.
 */
export interface Database {
  init(): Promise<void>;

  // accounts
  createAccount(rec: AccountRecord): Promise<AccountRecord>;
  getAccount(id: string): Promise<AccountRecord | null>;
  countAccounts(): Promise<number>;

  // devices
  createDevice(rec: DeviceRecord): Promise<DeviceRecord>;
  getDeviceByTopicId(topicId: string): Promise<DeviceRecord | null>;
  getDeviceByMac(mac: string): Promise<DeviceRecord | null>;
  listDevicesByAccount(accountId: string): Promise<DeviceRecord[]>;
  deleteDevice(topicId: string): Promise<boolean>;
  setDevicePresets(topicId: string, presetIds: string[]): Promise<DeviceRecord | null>;

  // presets
  createPreset(rec: PresetRecord): Promise<PresetRecord>;
  getPreset(id: string): Promise<PresetRecord | null>;
  getPresetsByIds(ids: string[]): Promise<PresetRecord[]>;
  listPresetsByAccount(accountId: string): Promise<PresetRecord[]>;
  updatePreset(id: string, patch: PresetPatch): Promise<PresetRecord | null>;
  deletePreset(id: string): Promise<boolean>;
}
