import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}

export const config = {
  port: num("PORT", 3000),

  // Built Angular SPA (CSR). Served if the dir exists; skipped otherwise.
  frontendDir: optional("FRONTEND_DIR", "frontend/dist/frontend/browser"),

  deviceSecret: required("DEVICE_SECRET"),

  mqtt: {
    url: optional("MQTT_URL", "mqtt://mosquitto:1883"),
    username: required("MQTT_SERVER_USERNAME"),
    password: required("MQTT_SERVER_PASSWORD"),
    ackTimeoutMs: num("ACK_TIMEOUT_MS", 5000),
  },

  // dynsec admin identity — used only for the provisioning MQTT connection
  // that publishes dynamic-security control commands.
  dynsec: {
    adminUser: required("MOSQUITTO_ADMIN_USER"),
    adminPass: required("MOSQUITTO_ADMIN_PASS"),
    controlTimeoutMs: num("DYNSEC_CONTROL_TIMEOUT_MS", 5000),
  },

  db: {
    accountsPath: optional("DB_ACCOUNTS_PATH", "data/accounts.db"),
    devicesPath: optional("DB_DEVICES_PATH", "data/devices.db"),
    presetsPath: optional("DB_PRESETS_PATH", "data/presets.db"),
    adminsPath: optional("DB_ADMINS_PATH", "data/admins.db"),
  },

  adminBootstrap: {
    user: process.env.ADMIN_BOOTSTRAP_USER?.trim() || null,
    pass: process.env.ADMIN_BOOTSTRAP_PASS?.trim() || null,
    // account the bootstrap admin is created under
    accountName: optional("ADMIN_BOOTSTRAP_ACCOUNT", "default"),
  },
} as const;

export type Config = typeof config;
