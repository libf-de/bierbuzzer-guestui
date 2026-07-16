# MQTT Configuration Interface

Exposes **exactly two** settings over MQTT — nothing else is readable or writable
through this interface:

| Setting          | Source of truth (`AppConfig`) | JSON key      | Type                                            |
|------------------|-------------------------------|---------------|-------------------------------------------------|
| Ordered articles | `degaso.articles_json`        | `articles`    | JSON array `[{"_id":"…","combinedWith":["…"]}]` |
| Order mode       | `degaso.order_mode` (+params) | `order_mode`  | object (see below)                              |

"Order mode" here is the **degaso order mode** (`DegasoOrderMode`): how the device
picks what to order on each press. The press-behaviour modes (`immediate` /
`queued` / `long_press` from `OrderingCfg`) are **not** exposed over MQTT.

All other config (wifi, target, http, escpos, sound, ordering, name, …) is **not**
exposed — those keys are ignored on write and never published. Enforcement: the
device only subscribes to `config/set` and only maps the two whitelisted keys.

---

## Topics

`<topic_id>` = per-device topic identifier (default `deviceId`, e.g. `BIER-A3F2`).

| Topic                          | Direction       | Retained | QoS | Payload                        |
|--------------------------------|-----------------|----------|-----|--------------------------------|
| `devices/<topic_id>/config/set`| server → device | yes      | 1   | config JSON (see below)        |
| `devices/<topic_id>/config/ack`| device → server | no       | 1   | ack JSON (see below)           |
| `devices/<topic_id>/status`    | device → server | yes      | 1   | status JSON (LWT + telemetry)  |

- **`config/set`** — server publishes desired config. **Retained** so the device
  picks up the latest value on (re)connect, even if offline when written. QoS 1.
- **`config/ack`** — device confirms what it applied (or rejects with reason).
  Also serves as the readback: last ack = current effective config.
- **`status`** — availability (`online`/`offline` via LWT) plus optional telemetry.

The device **subscribes to only** `devices/<topic_id>/config/set`. That single
subscription is the whole surface of the MQTT write interface.

---

## Payloads

### `config/set` (server → device)

Partial or full. Only the two whitelisted keys are honored; unknown keys ignored.
Either key may be omitted → that setting left unchanged.

```json
{
  "order_mode": {
    "mode": "random_article",
    "roulette_percent": 50,
    "random_category": "Bier"
  },
  "articles": [
    { "_id": "664f…a1", "combinedWith": [] },
    { "_id": "664f…b2", "combinedWith": ["664f…c3"] }
  ]
}
```

**`order_mode`** — object mapping to `degaso.order_mode` and its params:

| Field              | Applies to           | Values / range                                        |
|--------------------|----------------------|-------------------------------------------------------|
| `mode`             | always               | `fixed` \| `random_article` \| `russian_roulette`     |
| `roulette_percent` | `russian_roulette`   | integer `0..100` (chance the order fires; clamped)    |
| `random_category`  | `random_article`     | category name string (≤ 63 chars)                     |

- `mode` — matches existing REST convention (`rest_api.cpp`). Unknown/empty →
  `order_mode` rejected, config unchanged.
- `roulette_percent` / `random_category` optional; omitted → left unchanged.
  Ignored (but not an error) for modes they don't apply to.
- Shorthand: a bare string `"order_mode": "fixed"` is also accepted and treated as
  `{ "mode": "fixed" }`.

**`articles`** — JSON array; must fit `articles_json` (**2048 bytes** incl. NUL).
In `fixed` / `russian_roulette` all entries are ordered; in `random_article` it is
the pool a single random entry is picked from.

An optional `rev` (integer/string) may be echoed back in the ack for correlation.

### `config/ack` (device → server)

Published after processing a `config/set`. Reports effective state + per-field result.

```json
{
  "rev": 7,
  "ok": true,
  "applied": {
    "order_mode": { "mode": "russian_roulette", "roulette_percent": 50, "random_category": "" },
    "articles": [ { "_id": "664f…a1", "combinedWith": [] } ]
  },
  "rejected": {}
}
```

Rejection example (invalid mode, articles too large):

```json
{
  "rev": 8,
  "ok": false,
  "applied": {
    "order_mode": { "mode": "fixed", "roulette_percent": 50, "random_category": "" }
  },
  "rejected": {
    "articles": "payload exceeds 2048 bytes"
  }
}
```

- `applied` — the two whitelisted values now in effect (full readback, always
  present regardless of what was in the `set`). `order_mode` is always the full
  object.
- `rejected` — map of key → reason for anything not applied.
- `ok` — `true` only if nothing was rejected.

On connect (before any write) the device publishes one ack with current state so a
late-joining server can read effective config without writing.

### `status` (device → server)

Availability via LWT; telemetry optional.

```json
{ "state": "online", "ip": "192.168.1.44", "battery_mv": 3920, "rssi": -58 }
```

- LWT registered at connect: retained `{"state":"offline"}`, fired by broker on
  ungraceful disconnect.
- Clean disconnect: publish `offline` before closing.

---

## Write / apply flow

```
server ── PUB config/set {order_mode, articles} (retained, QoS1) ──► device
device:
  1. parse JSON
  2. for each of the 2 whitelisted keys present:
       validate → update AppConfig (degaso.order_mode / *_percent / *_category,
                                     degaso.articles_json)
  3. Config::save()  (persist to NVS)
  4. PUB config/ack {ok, applied, rejected}  ──► server
```

Invalid fields are skipped (never partially corrupt config); the ack lists them in
`rejected` with reasons, and `applied` still reflects true current state so the
server can reconcile.

---

## Connection config (new — persisted in NVS, local-only)

Broker connection settings live in `AppConfig` like every other block. Configured
**locally only** (REST / setup wizard), never over MQTT itself.

```c
struct MqttCfg {
    bool     enabled       = false;   ///< Master on/off. Off = no client started.
    char     host[128]     = {};      ///< Broker hostname or IP
    uint32_t port          = 1883;    ///< 1883 plain, 8883 TLS
    char     username[64]  = {};      ///< Optional
    char     password[128] = {};      ///< Optional
    char     topic_id[96]  = {};      ///< <topic_id>; default deviceId if empty
    bool     tls           = false;   ///< mqtts:// (port 8883 typical)
};
```

Added to `AppConfig`:

```c
struct AppConfig {
    WifiCfg          wifi;
    TargetType       target      = TargetType::Degaso;
    HttpTargetCfg    http_target;
    DegasoCfg        degaso;
    EscPosPrinterCfg escpos;
    OrderingCfg      ordering;
    SoundCfg         sound;
    MqttCfg          mqtt;          // <-- new
    bool             first_start     = true;
};
```

`topic_id` resolves at runtime: empty → `deviceId` (`BIER-XXYY`, from
`utils/device_id`). MQTT client id = `deviceId`.

---

## Lifecycle

```
Boot ─ mqtt.enabled? ─No─► no MQTT client
        └Yes
          └ WiFi STA up? ─No─► wait for got-IP event
             └Yes
               └ connect broker (LWT armed: status=offline retained)
                  └ on connect:
                      • PUB status  = online (retained)
                      • PUB config/ack = current effective config (readback)
                      • SUB devices/<topic_id>/config/set   (QoS1)
                  └ on disconnect: auto-reconnect (mirror wifi_manager pattern)
```

---

## Example session

```
# Device announces itself on connect
devices/BIER-A3F2/status     {"state":"online","ip":"192.168.1.44"}                    (retained)
devices/BIER-A3F2/config/ack {"ok":true,"applied":{"order_mode":{"mode":"fixed",…},"articles":[…]}}

# Server switches to russian roulette at 30%
PUB devices/BIER-A3F2/config/set {"rev":7,"order_mode":{"mode":"russian_roulette","roulette_percent":30}}

# Device applies + confirms
devices/BIER-A3F2/config/ack {"rev":7,"ok":true,
  "applied":{"order_mode":{"mode":"russian_roulette","roulette_percent":30,"random_category":""},"articles":[…]},
  "rejected":{}}

# Server replaces the article pool
PUB devices/BIER-A3F2/config/set {"rev":8,"articles":[{"_id":"9aa…","combinedWith":[]}]}
devices/BIER-A3F2/config/ack {"rev":8,"ok":true,"applied":{"order_mode":{…},"articles":[{"_id":"9aa…","combinedWith":[]}]},"rejected":{}}
```

---

## Implementation notes (not implemented yet — design only)

- New module `main/network/mqtt_manager.{h,cpp}` using ESP-IDF `esp-mqtt`
  (`mqtt_client.h`) — bundled with IDF, no extra dependency.
- After an `order_mode` write, reconfigure the degaso path the same way the REST
  degaso handler does (`rest_api.cpp` ~374–414).
- Persistence via existing `Config::instance().save()`.
- Whitelist enforced in one place: a single `applySet(json)` that reads only
  `order_mode` and `articles`. No wildcard subscribe, no other keys mapped.
- MQTT never publishes wifi/broker credentials — only status + the two config keys.
- REST additions for the broker connection (local config, not exposed via MQTT):
  `GET /api/config/mqtt` (password omitted) and `POST /api/config/mqtt`.
```
