# IoT Drink-Button MQTT Server — Spec

## Context
ESP32 buttons in restaurant order drinks. Guests change button's ordered article via QR code. Server mediates all config writes — no anon MQTT publish. Payload = article IDs only, no sensitive data. Threat model: nearby humans messing with other tables' buttons / internet scanning noise — not data leakage.

## Architecture
- Mosquitto broker, Docker, behind existing Traefik (TCP router, plain 1883, no TLS — see TLS note below).
- Mosquitto **dynamic security plugin** for runtime user/ACL management (no static passwd/acl files).
- Server software owns all MQTT publishes to device config topics. Guests interact via QR → server → server publishes to broker. Devices only read own topic + ack/status write.
- Per-device credentials + topic derived from MAC address, HMAC'd with a server-side (or firmware-baked) secret — not raw MAC, not guessable.

## Topic scheme
```
devices/<topic_id>/config/set     # server -> device, retained, QoS1
devices/<topic_id>/config/ack     # device -> server
devices/<topic_id>/status         # device -> server (optional telemetry)
```
`topic_id` = truncated HMAC-SHA256(secret, mac + "topic"), NOT the raw MAC (OUI leaks vendor, MAC search space ~24 bit, brute-forceable).

## Credential derivation
```
topic_id = HMAC-SHA256(SECRET, mac + ":topic")[:16 bytes -> hex]
password = HMAC-SHA256(SECRET, mac + ":pw")           [full 32 bytes -> hex]
username = "device_" + topic_id
```
- SECRET: 256-bit random (`openssl rand -hex 32`), generated once.
- Two deployment options discussed:
  1. **Server-side secret only** — server computes creds from MAC at provisioning time, flashes/configures device with resulting username/password/topic (one-time, e.g. via NVS at manufacturing/setup step).
  2. **Firmware-baked secret** — same HMAC computed on-device from MAC (efuse, `esp_efuse_mac_get_default()`) + secret baked into firmware. Zero-touch provisioning, but weak if firmware secret extracted from one device (needs ESP32 flash encryption + secure boot to be robust). Device would still need pre-registration with server (server needs to know MAC in advance, or device does one-time unauthenticated "hello, my MAC" registration).
- Chose to defer firmware-baked auto-registration flow; for now provisioning happens server-side per known MAC.

## Mosquitto — dynamic security plugin

### `mosquitto/config/mosquitto.conf`
```conf
listener 1883

per_listener_settings false

plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /mosquitto/data/dynamic-security.json

log_type error
log_type warning
connection_messages true

persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
```
Note: on Alpine-based `eclipse-mosquitto:2` image, plugin path is `/usr/lib/mosquitto_dynamic_security.so` — NOT `/usr/lib/mosquitto/...`.

### `docker-compose.yml`
```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    container_name: mosquitto
    restart: unless-stopped
    user: "1883:1883"
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - ./mosquitto/data:/mosquitto/data
      - ./mosquitto/log:/mosquitto/log
    networks:
      - traefik_net   # match actual traefik network name
    labels:
      - "traefik.enable=true"
      - "traefik.tcp.routers.mosquitto.rule=HostSNI(`*`)"
      - "traefik.tcp.routers.mosquitto.entrypoints=mqtt"
      - "traefik.tcp.services.mosquitto.loadbalancer.server.port=1883"
    security_opt:
      - no-new-privileges:true

networks:
  traefik_net:
    external: true
```
Traefik static config needs a TCP entrypoint added (can't be dynamic-only):
```
--entrypoints.mqtt.address=:1883
```
(or whatever host port desired, e.g. 7000 — entrypoint name must match router's `entrypoints` label).

### Directory layout
```
mosquitto/
├── config/mosquitto.conf
├── data/dynamic-security.json   # created by bootstrap, must be uid 1883
└── log/
```

### Bootstrap (once, before first real use)
```bash
mkdir -p mosquitto/config mosquitto/data mosquitto/log

docker run --rm -it \
  --user 1883:1883 \
  -v $(pwd)/mosquitto/data:/mosquitto/data \
  eclipse-mosquitto:2 \
  mosquitto_ctrl dynsec init /mosquitto/data/dynamic-security.json admin <ADMIN_PASSWORD>

docker compose up -d
```
Non-root: image already runs as uid 1883 by default; `user:` pin is belt-and-suspenders. If any file ends up root-owned (e.g. bootstrap run without `--user`), fix with:
```bash
sudo chown 1883:1883 mosquitto/data/dynamic-security.json
```

## Server-side provisioning (Python, subprocess wrapper around `mosquitto_ctrl`)
```python
import subprocess
import secrets

BROKER_HOST = "mosquitto"
BROKER_PORT = "1883"
ADMIN_USER = "admin"
ADMIN_PASS = "<from env, not hardcoded>"
NETWORK = "traefik_net"

def _ctrl(*args):
    cmd = [
        "docker", "run", "--rm", "--network", NETWORK,
        "eclipse-mosquitto:2",
        "mosquitto_ctrl", "-h", BROKER_HOST, "-p", BROKER_PORT,
        "-u", ADMIN_USER, "-P", ADMIN_PASS,
        "dynsec", *args
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"mosquitto_ctrl failed: {result.stderr}")
    return result.stdout

def create_device(topic_id: str, password: str = None):
    password = password or secrets.token_hex(16)
    username = f"device_{topic_id}"
    role = f"role_{topic_id}"

    _ctrl("createClient", username, "--password", password)
    _ctrl("createRole", role)
    _ctrl("addRoleACL", role, "subscribePattern", f"devices/{topic_id}/config/set")
    _ctrl("addRoleACL", role, "publishClientSend", f"devices/{topic_id}/config/ack")
    _ctrl("addClientRole", username, role)
    return username, password

def delete_device(topic_id: str):
    username = f"device_{topic_id}"
    role = f"role_{topic_id}"
    _ctrl("deleteClient", username)
    _ctrl("deleteRole", role)
```
Note: shelling out via `docker run` per call is slow for bulk — fine for occasional provisioning. For bulk, install `mosquitto-clients` natively on server host and call `mosquitto_ctrl` directly, skip the docker wrapper.

Server's own MQTT identity (for publishing config) needs its own dynsec client + role with broader ACL:
```
subscribePattern devices/+/config/ack
publishClientSend devices/+/config/set
```

## Security decisions locked in
- Anonymous publish disabled entirely — server does all writes, authed.
- Per-device ACL scoped to exact topic strings (no wildcards for device clients).
- Topic IDs are HMAC-derived, non-guessable — brute force / enumeration infeasible.
- No anon subscribe — dynsec means no anon anything by default.
- Mosquitto SUBACK behavior for denied topics returns success (no oracle leak) — verify empirically per version if paranoid:
  ```bash
  mosquitto_sub -h host -t 'devices/realid/config/set' -d
  mosquitto_sub -h host -t 'devices/fakeid/config/set' -d
  # diff wire output
  ```
- GeoIP filtering considered and rejected as primary control (mobile/VPN guests defeat it) — optional noise-reduction layer only, not implemented.
- TLS (mqtts/8883) considered; deferred for now given server-mediated writes already cover integrity concern. If added later: ESP32 handshake RAM cost ~35-55KB peak, ~15-25KB steady state, ~60-100KB flash for mbedTLS. PSK-TLS cheaper than cert-based if revisited.
- Client-side (ESP32) should validate article ID against a whitelist before applying — reject garbage payloads regardless of channel trust.

## Open / deferred items
- Auto-registration flow (device announces MAC once via bootstrap topic, server auto-provisions) — not yet designed, manual/scripted MAC-based provisioning used for now.
- TLS listener — not implemented, revisit if threat model changes (e.g. moving off server-mediated writes).
- Bulk/native (non-docker-wrapped) `mosquitto_ctrl` provisioning script — not yet written, needed if fleet size grows large.
