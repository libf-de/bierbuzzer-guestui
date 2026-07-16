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

  mosquittoCtrl: {
    mode: optional("MOSQUITTO_CTRL_MODE", "docker") as "docker" | "native",
    adminUser: required("MOSQUITTO_ADMIN_USER"),
    adminPass: required("MOSQUITTO_ADMIN_PASS"),
    host: optional("MOSQUITTO_BROKER_HOST", "mosquitto"),
    port: optional("MOSQUITTO_BROKER_PORT", "1883"),
    network: optional("MOSQUITTO_NETWORK", "traefik_net"),
    image: optional("MOSQUITTO_IMAGE", "eclipse-mosquitto:2"),
  },

  db: {
    devicesPath: optional("DB_DEVICES_PATH", "data/devices.db"),
    articlesPath: optional("DB_ARTICLES_PATH", "data/articles.db"),
    adminsPath: optional("DB_ADMINS_PATH", "data/admins.db"),
  },

  adminBootstrap: {
    user: process.env.ADMIN_BOOTSTRAP_USER?.trim() || null,
    pass: process.env.ADMIN_BOOTSTRAP_PASS?.trim() || null,
  },
} as const;

export type Config = typeof config;
