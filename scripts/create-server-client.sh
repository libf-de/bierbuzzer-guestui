#!/usr/bin/env bash
#
# Create the backend's own dynsec client + role on an EXISTING Mosquitto
# broker (one that already has the dynamic-security plugin + an admin client).
#
# This is the only broker-side setup the backend needs when Mosquitto is
# already running. It does NOT touch your mosquitto.conf or start a broker.
#
# Connection + admin creds come from env (loads .env). Reuses the same
# MOSQUITTO_CTRL_MODE the backend uses for device provisioning:
#   native  -> calls mosquitto_ctrl directly (needs mosquitto-clients installed)
#   docker  -> wraps it in `docker run --network <MOSQUITTO_NETWORK>`
#
# Requires: MOSQUITTO_ADMIN_PASS, MQTT_SERVER_PASSWORD
#
set -euo pipefail

cd "$(dirname "$0")/.."

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
HOST="${MOSQUITTO_BROKER_HOST:-mosquitto}"
PORT="${MOSQUITTO_BROKER_PORT:-1883}"
MODE="${MOSQUITTO_CTRL_MODE:-docker}"
NETWORK="${MOSQUITTO_NETWORK:-traefik_net}"
IMAGE="${MOSQUITTO_IMAGE:-eclipse-mosquitto:2}"

ctrl() {
  if [ "$MODE" = "native" ]; then
    mosquitto_ctrl -h "$HOST" -p "$PORT" -u "$ADMIN_USER" -P "$ADMIN_PASS" dynsec "$@"
  else
    docker run --rm --network "$NETWORK" "$IMAGE" \
      mosquitto_ctrl -h "$HOST" -p "$PORT" -u "$ADMIN_USER" -P "$ADMIN_PASS" dynsec "$@"
  fi
}

echo "[server-client] target $HOST:$PORT  mode=$MODE  client=$SERVER_USER"

# Sanity: admin can reach the broker.
if ! ctrl listClients >/dev/null 2>&1; then
  echo "[server-client] cannot reach broker as admin '$ADMIN_USER' — check HOST/PORT/creds/MODE" >&2
  exit 1
fi

ctrl createClient "$SERVER_USER" --password "$SERVER_PASS" 2>/dev/null || echo "  client exists — skipping"
ctrl createRole server_role 2>/dev/null || echo "  role exists — skipping"

# Server mediates all device writes and reads all acks/status -> wildcard ACLs.
ctrl addRoleACL server_role publishClientSend devices/+/config/set || true
ctrl addRoleACL server_role subscribePattern  devices/+/config/ack || true
ctrl addRoleACL server_role subscribePattern  devices/+/status     || true
ctrl addClientRole "$SERVER_USER" server_role 2>/dev/null || true

echo "[server-client] done — backend can now connect as '$SERVER_USER'."
