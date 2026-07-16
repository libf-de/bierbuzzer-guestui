import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import express from "express";
import helmet from "helmet";
import { config } from "./config";
import { NeDbDatabase } from "./db/NeDbDatabase";
import { NeDbCredentialStore } from "./auth/NeDbCredentialStore";
import { BasicAuthProvider } from "./auth/BasicAuthProvider";
import { hashPassword } from "./auth/password";
import { MqttService } from "./services/MqttService";
import { MqttProvisioningService } from "./services/MqttProvisioningService";
import { DeviceService } from "./services/DeviceService";
import { MockCatalogSource } from "./services/CatalogSource";
import { guestRoutes } from "./routes/guest";
import { adminRoutes } from "./routes/admin";
import { errorHandler } from "./http/errorHandler";

async function main(): Promise<void> {
  // --- persistence ---
  const db = new NeDbDatabase({
    accountsPath: config.db.accountsPath,
    devicesPath: config.db.devicesPath,
    presetsPath: config.db.presetsPath,
  });
  await db.init();

  const credentials = new NeDbCredentialStore(config.db.adminsPath);
  await credentials.init();
  await seedAccountAndAdmin(db, credentials);

  // --- provisioning (dedicated admin dynsec connection) ---
  const provisioning = new MqttProvisioningService({
    url: config.mqtt.url,
    username: config.dynsec.adminUser,
    password: config.dynsec.adminPass,
    timeoutMs: config.dynsec.controlTimeoutMs,
  });
  await provisioning.connect();
  console.log("[provision] dynsec control over MQTT (admin connection)");

  // Self-provision the backend's own least-privilege MQTT client (idempotent),
  // so no manual mosquitto_ctrl bootstrap is needed — just admin creds.
  await provisioning.ensureServerClient(config.mqtt.username, config.mqtt.password);

  // --- MQTT (server identity, used for device pub/sub) ---
  const mqtt = new MqttService({
    url: config.mqtt.url,
    username: config.mqtt.username,
    password: config.mqtt.password,
    ackTimeoutMs: config.mqtt.ackTimeoutMs,
  });
  await mqtt.connect();
  console.log(`[mqtt] connected to ${config.mqtt.url}`);

  // --- services ---
  const devices = new DeviceService(db, provisioning, mqtt, config.deviceSecret);
  const auth = new BasicAuthProvider(credentials);
  const catalog = new MockCatalogSource();

  // --- HTTP ---
  const app = express();
  // CSP disabled for the PoC: Angular's inline critical-CSS trips the default
  // policy. Re-enable with a tailored policy (nonces/hashes) before prod.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api/admin", adminRoutes({ db, devices, auth, credentials, catalog }));
  app.use("/api", guestRoutes(db, mqtt));

  // Serve the built Angular SPA (if present) with a client-side-routing fallback.
  const frontendDir = path.resolve(config.frontendDir);
  const indexHtml = path.join(frontendDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(frontendDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(indexHtml);
    });
    console.log(`[http] serving frontend from ${frontendDir}`);
  } else {
    console.warn(`[http] frontend not found at ${frontendDir} — API only`);
  }

  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    console.log(`[http] listening on :${config.port}`);
  });

  const shutdown = async (sig: string) => {
    console.log(`[app] ${sig} received, shutting down`);
    server.close();
    await mqtt.close();
    await provisioning.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * Seed a default account + its bootstrap admin when the credential store is
 * empty. Multi-tenant: further accounts/admins are created via the API under
 * the existing admin's account.
 */
async function seedAccountAndAdmin(
  db: NeDbDatabase,
  store: NeDbCredentialStore,
): Promise<void> {
  if ((await store.count()) > 0) return;
  const { user, pass, accountName } = config.adminBootstrap;
  if (!user || !pass) {
    console.warn(
      "[auth] no admins exist and ADMIN_BOOTSTRAP_USER/PASS unset — admin API is unusable",
    );
    return;
  }
  const accountId = randomUUID();
  await db.createAccount({ id: accountId, name: accountName, createdAt: Date.now() });
  await store.create({
    username: user,
    passwordHash: await hashPassword(pass),
    accountId,
    createdAt: Date.now(),
  });
  console.log(`[auth] seeded account "${accountName}" + bootstrap admin "${user}"`);
}

main().catch((err) => {
  console.error("[app] fatal:", err);
  process.exit(1);
});
