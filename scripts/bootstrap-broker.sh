#!/usr/bin/env bash
#
# One-time broker bootstrap:
#   1. init the dynamic-security config + admin client
#   2. start the Mosquitto container
#   3. create the server's own dynsec client + role (the identity the
#      backend uses to publish config/set and read acks/status)
#
# Idempotent: re-running skips dynsec init if the config already exists and
# tolerates "already exists" on client/role creation.
#
# Reads the same env vars as the backend (loads .env if present). Requires:
#   MOSQUITTO_ADMIN_PASS, MQTT_SERVER_PASSWORD
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env if present so this matches the backend's config.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

ADMIN_USER="${MOSQUITTO_ADMIN_USER:-admin}"
ADMIN_PASS="${MOSQUITTO_ADMIN_PASS:?set MOSQUITTO_ADMIN_PASS (see .env)}"
SERVER_USER="${MQTT_SERVER_USERNAME:-server}"
SERVER_PASS="${MQTT_SERVER_PASSWORD:?set MQTT_SERVER_PASSWORD (see .env)}"
NETWORK="${MOSQUITTO_NETWORK:-traefik_net}"
IMAGE="${MOSQUITTO_IMAGE:-eclipse-mosquitto:2}"
HOST="${MOSQUITTO_BROKER_HOST:-mosquitto}"
PORT="${MOSQUITTO_BROKER_PORT:-1883}"
DYNSEC_FILE="mosquitto/data/dynamic-security.json"

mkdir -p mosquitto/config mosquitto/data mosquitto/log

# Ensure the network exists (no-op if Traefik already created it).
docker network inspect "$NETWORK" >/dev/null 2>&1 || {
  echo "[bootstrap] creating docker network $NETWORK"
  docker network create "$NETWORK"
}

# 1. Init dynsec config offline (creates admin with dynsec-control ACLs).
if [ ! -f "$DYNSEC_FILE" ]; then
  echo "[bootstrap] initialising dynsec config + admin '$ADMIN_USER'"
  docker run --rm --user 1883:1883 \
    -v "$(pwd)/mosquitto/data:/mosquitto/data" \
    "$IMAGE" \
    mosquitto_ctrl dynsec init /mosquitto/data/dynamic-security.json "$ADMIN_USER" "$ADMIN_PASS"
else
  echo "[bootstrap] $DYNSEC_FILE exists — skipping dynsec init"
fi

# 2. Start the broker.
echo "[bootstrap] starting broker"
docker compose up -d mosquitto

# Run a dynsec command against the live broker as admin.
ctrl() {
  docker run --rm --network "$NETWORK" "$IMAGE" \
    mosquitto_ctrl -h "$HOST" -p "$PORT" -u "$ADMIN_USER" -P "$ADMIN_PASS" dynsec "$@"
}

# 3. Wait until the broker accepts authenticated dynsec commands.
echo "[bootstrap] waiting for broker to accept admin..."
for _ in $(seq 1 30); do
  if ctrl listClients >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ -z "${ready:-}" ]; then
  echo "[bootstrap] broker did not become ready in time" >&2
  exit 1
fi

# 4. Server client + role. Broad ACLs (wildcards) — the server mediates all
#    device writes and reads all acks/status.
echo "[bootstrap] creating server client '$SERVER_USER' + role"
ctrl createClient "$SERVER_USER" --password "$SERVER_PASS" 2>/dev/null || \
  echo "  client exists — skipping"
ctrl createRole server_role 2>/dev/null || echo "  role exists — skipping"
ctrl addRoleACL server_role publishClientSend devices/+/config/set || true
ctrl addRoleACL server_role subscribePattern  devices/+/config/ack || true
ctrl addRoleACL server_role subscribePattern  devices/+/status     || true
ctrl addClientRole "$SERVER_USER" server_role 2>/dev/null || true

echo "[bootstrap] done. Broker up, admin + server client provisioned."
