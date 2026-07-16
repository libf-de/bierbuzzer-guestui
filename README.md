# bierbuzzer backend

Express + TypeScript server that mediates all MQTT config writes for ESP32
drink-buttons. See [`CLAUDE.md`](./CLAUDE.md) for the full threat model and
Mosquitto/dynsec setup. This repo is the **backend API** — the guest UI is a
separate frontend that talks to it over JSON.

## What it does

- Derives non-guessable per-device credentials from MAC + a server secret (HMAC).
- Provisions device clients/roles/ACLs in Mosquitto's dynamic-security plugin
  via `mosquitto_ctrl` (admin API).
- Owns the MQTT connection; guests never publish. Guest picks an article →
  server publishes `devices/<topicId>/config/set` (retained, QoS1).
- Current article is **not stored** — it's read live from the device via the
  `config/ack` / `status` topics.

## Layout

```
src/
  config.ts                 env config (fail-fast on missing vars)
  crypto/credentials.ts     HMAC derivation: mac -> topicId/username/password
  db/
    types.ts                Database interface + record types (swap target)
    NeDbDatabase.ts         nedb-promises impl (devices + articles datastores)
  auth/
    types.ts                AuthProvider + CredentialStore interfaces
    password.ts             scrypt hash/verify
    NeDbCredentialStore.ts  admin credential store (nedb-promises)
    BasicAuthProvider.ts    HTTP Basic auth strategy
    middleware.ts           requireAdmin(provider)
  services/
    MqttService.ts          publish config/set, track live ack/status state
    ProvisioningService.ts  mosquitto_ctrl wrapper (docker | native)
    DeviceService.ts        derive -> provision -> registry orchestration
  routes/
    guest.ts                /api/*        (no auth, scoped by topicId)
    admin.ts                /api/admin/*  (auth required)
  http/                     asyncHandler, validation, error handler
  index.ts                  wiring + admin seed + graceful shutdown
```

Swapping the store (Mongo/Postgres/…): implement `Database` (`db/types.ts`)
and `CredentialStore` (`auth/types.ts`); nothing else changes. Swapping auth
(Bearer/JWT/mTLS): implement `AuthProvider`.

## Run

```bash
cp .env.example .env      # fill in DEVICE_SECRET, MQTT + mosquitto creds
npm install
npm run dev               # tsx watch; or: npm run build && npm start
```

Prereqs: a reachable Mosquitto broker with the dynsec plugin (see `CLAUDE.md`
bootstrap), the server's own dynsec client (below), and `docker` on the host
(for `mosquitto_ctrl`, unless `MOSQUITTO_CTRL_MODE=native`).

### Server's MQTT identity (once, alongside broker bootstrap)

The server connects with `MQTT_SERVER_USERNAME/PASSWORD`. Create that dynsec
client with broader ACLs:

```bash
CTRL="docker run --rm --network traefik_net eclipse-mosquitto:2 \
  mosquitto_ctrl -h mosquitto -p 1883 -u admin -P <ADMIN_PASS> dynsec"

$CTRL createClient server --password <MQTT_SERVER_PASSWORD>
$CTRL createRole server_role
$CTRL addRoleACL server_role publishClientSend devices/+/config/set
$CTRL addRoleACL server_role subscribePattern  devices/+/config/ack
$CTRL addRoleACL server_role subscribePattern  devices/+/status
$CTRL addClientRole server server_role
```

## API

Guest (no auth; `topicId` comes from the QR):

| Method | Path                                | Body            | Notes |
|--------|-------------------------------------|-----------------|-------|
| GET    | `/api/articles`                     | —               | drink menu (whitelist) |
| GET    | `/api/devices/:topicId`             | —               | live current article (or `null`) |
| POST   | `/api/devices/:topicId/article`     | `{articleId}`   | 200 acked / 202 retained-unconfirmed |

Admin (HTTP Basic):

| Method | Path                          | Body                  |
|--------|-------------------------------|-----------------------|
| GET    | `/api/admin/devices`          | —                     |
| POST   | `/api/admin/devices`          | `{mac, label?}` → creds (once) |
| DELETE | `/api/admin/devices/:topicId` | —                     |
| GET    | `/api/admin/articles`         | —                     |
| POST   | `/api/admin/articles`         | `{id, name}`          |
| DELETE | `/api/admin/articles/:id`     | —                     |
| GET    | `/api/admin/admins`           | —                     |
| POST   | `/api/admin/admins`           | `{username, password}` |
| DELETE | `/api/admin/admins/:username` | —                     |

`GET /healthz` → `{ok:true}`.

### Example

```bash
# provision a device (returns username + password ONCE — flash them to the ESP32)
curl -u admin:secret -X POST localhost:3000/api/admin/devices \
  -H 'content-type: application/json' -d '{"mac":"AA:BB:CC:DD:EE:FF","label":"table 4"}'

# add a drink to the whitelist
curl -u admin:secret -X POST localhost:3000/api/admin/articles \
  -H 'content-type: application/json' -d '{"id":"pils","name":"Pilsner"}'

# guest changes the button's article
curl -X POST localhost:3000/api/devices/<topicId>/article \
  -H 'content-type: application/json' -d '{"articleId":"pils"}'
```

## Notes / deferred

- Device auth uses per-device topic ACLs (no wildcards); server uses `+`.
- MQTT admin pass is passed to `mosquitto_ctrl` as an argv `-P` flag — visible
  in child-process args. Fine on a single-tenant host.
- Auto-registration flow, TLS listener, and native bulk provisioning remain
  deferred per `CLAUDE.md`.
```
