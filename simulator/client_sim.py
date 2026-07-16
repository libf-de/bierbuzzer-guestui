#!/usr/bin/env python3
"""
Simulated ESP32 button device — implements MQTT.md spec.

Subscribes only to devices/<topic_id>/config/set. Whitelists exactly two keys:
order_mode, articles. Persists "AppConfig" to a local JSON file (stand-in for
NVS). Publishes status (retained, LWT) and config/ack (retained-readback on
connect, then per-write).

Usage:
    pip install paho-mqtt --break-system-packages
    python esp32_sim.py --host mosquitto --port 1883 --topic-id BIER-A3F2 \
        --username device_xxx --password yyy --state device_state.json
"""

import argparse
import json
import os
import random
import sys
import time

import paho.mqtt.client as mqtt

ARTICLES_JSON_MAX_BYTES = 2048
VALID_MODES = {"fixed", "random_article", "russian_roulette"}


class AppConfig:
    """Stand-in for firmware AppConfig — only the two MQTT-exposed fields."""

    def __init__(self, state_path):
        self.state_path = state_path
        self.order_mode = {"mode": "fixed", "roulette_percent": 50, "random_category": ""}
        self.articles = []
        self._load()

    def _load(self):
        if os.path.exists(self.state_path):
            try:
                with open(self.state_path) as f:
                    data = json.load(f)
                self.order_mode = data.get("order_mode", self.order_mode)
                self.articles = data.get("articles", self.articles)
            except (json.JSONDecodeError, OSError) as e:
                print(f"[state] failed to load {self.state_path}: {e} — using defaults")

    def save(self):
        """Config::save() equivalent — persist to disk ('NVS')."""
        with open(self.state_path, "w") as f:
            json.dump({"order_mode": self.order_mode, "articles": self.articles}, f, indent=2)

    def applied_snapshot(self):
        return {"order_mode": dict(self.order_mode), "articles": list(self.articles)}


def validate_order_mode(value):
    """Returns (validated_dict, error) — error is None on success."""
    if isinstance(value, str):
        value = {"mode": value}
    if not isinstance(value, dict):
        return None, "order_mode must be object or string"

    mode = value.get("mode")
    if mode not in VALID_MODES:
        return None, f"unknown mode '{mode}'"

    result = {"mode": mode, "roulette_percent": 50, "random_category": ""}

    if "roulette_percent" in value:
        try:
            pct = int(value["roulette_percent"])
        except (TypeError, ValueError):
            return None, "roulette_percent must be integer"
        result["roulette_percent"] = max(0, min(100, pct))  # clamp per spec

    if "random_category" in value:
        cat = value["random_category"]
        if not isinstance(cat, str) or len(cat) > 63:
            return None, "random_category must be string <= 63 chars"
        result["random_category"] = cat

    return result, None


def validate_articles(value):
    if not isinstance(value, list):
        return None, "articles must be a JSON array"
    for entry in value:
        if not isinstance(entry, dict) or "_id" not in entry:
            return None, "each article entry needs an _id"
    encoded = json.dumps(value).encode("utf-8") + b"\x00"  # incl. NUL per spec
    if len(encoded) > ARTICLES_JSON_MAX_BYTES:
        return None, f"payload exceeds {ARTICLES_JSON_MAX_BYTES} bytes"
    return value, None


class DeviceSim:
    def __init__(self, args):
        self.args = args
        self.topic_id = args.topic_id
        self.config_set_topic = f"devices/{self.topic_id}/config/set"
        self.config_ack_topic = f"devices/{self.topic_id}/config/ack"
        self.status_topic = f"devices/{self.topic_id}/status"
        self.cfg = AppConfig(args.state)

        self.client = mqtt.Client(client_id=self.topic_id, protocol=mqtt.MQTTv311)
        if args.username:
            self.client.username_pw_set(args.username, args.password or "")

        # LWT: broker fires this retained offline status on ungraceful disconnect
        self.client.will_set(
            self.status_topic,
            payload=json.dumps({"state": "offline"}),
            qos=1,
            retain=True,
        )

        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect

    def on_connect(self, client, userdata, flags, rc):
        if rc != 0:
            print(f"[mqtt] connect failed, rc={rc}")
            return
        print(f"[mqtt] connected as {self.topic_id}")

        client.publish(
            self.status_topic,
            json.dumps({"state": "online", "ip": self.args.fake_ip, "rssi": -58}),
            qos=1,
            retain=True,
        )

        # readback ack so a late-joining server can read effective config
        client.publish(
            self.config_ack_topic,
            json.dumps({"ok": True, "applied": self.cfg.applied_snapshot(), "rejected": {}}),
            qos=1,
            retain=False,
        )

        # single subscription = the whole write surface
        client.subscribe(self.config_set_topic, qos=1)
        print(f"[mqtt] subscribed to {self.config_set_topic}")

    def on_disconnect(self, client, userdata, rc):
        print(f"[mqtt] disconnected, rc={rc} — will auto-reconnect")

    def on_message(self, client, userdata, msg):
        if msg.topic != self.config_set_topic:
            return  # not whitelisted, ignore (shouldn't happen, only subscribed topic)

        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            print(f"[config/set] bad JSON: {e}")
            return

        rev = payload.get("rev")
        rejected = {}
        applied_something = False

        if "order_mode" in payload:
            validated, err = validate_order_mode(payload["order_mode"])
            if err:
                rejected["order_mode"] = err
            else:
                self.cfg.order_mode = validated
                applied_something = True

        if "articles" in payload:
            validated, err = validate_articles(payload["articles"])
            if err:
                rejected["articles"] = err
            else:
                self.cfg.articles = validated
                applied_something = True

        # any other key in payload is silently ignored (not whitelisted)
        unknown_keys = set(payload.keys()) - {"order_mode", "articles", "rev"}
        if unknown_keys:
            print(f"[config/set] ignoring non-whitelisted keys: {unknown_keys}")

        if applied_something:
            self.cfg.save()

        ack = {
            "ok": len(rejected) == 0,
            "applied": self.cfg.applied_snapshot(),
            "rejected": rejected,
        }
        if rev is not None:
            ack["rev"] = rev

        client.publish(self.config_ack_topic, json.dumps(ack), qos=1, retain=False)
        print(f"[config/ack] {ack}")

        # simulate applying to hardware / degaso path
        if applied_something:
            self._simulate_next_order()

    def _simulate_next_order(self):
        """Not part of the protocol — just prints what a button press would do now."""
        mode = self.cfg.order_mode.get("mode")
        if mode == "fixed":
            print(f"[sim] next press -> ordered={self.cfg.articles}")
        elif mode == "random_article":
            pool = self.cfg.articles or [{"_id": "(empty pool)"}]
            print(f"[sim] next press -> random pick from pool={pool} "
                  f"(category filter={self.cfg.order_mode.get('random_category')!r})")
        elif mode == "russian_roulette":
            pct = self.cfg.order_mode.get("roulette_percent", 50)
            fires = random.randint(1, 100) <= pct
            print(f"[sim] next press -> roulette {pct}% -> "
                  f"{'FIRES, order ' + str(self.cfg.articles) if fires else 'no order'}")

    def run(self):
        print(f"[state] loaded config: {self.cfg.applied_snapshot()}")
        self.client.connect(self.args.host, self.args.port, keepalive=30)
        try:
            self.client.loop_forever()
        except KeyboardInterrupt:
            print("\n[mqtt] shutting down cleanly")
            self.client.publish(
                self.status_topic, json.dumps({"state": "offline"}), qos=1, retain=True
            )
            time.sleep(0.3)  # let the publish flush before disconnect
            self.client.disconnect()


def main():
    p = argparse.ArgumentParser(description="Simulated ESP32 drink-button device")
    p.add_argument("--host", required=True, help="Broker host")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--topic-id", required=True, help="e.g. BIER-A3F2")
    p.add_argument("--username", default=None)
    p.add_argument("--password", default=None)
    p.add_argument("--state", default="device_state.json", help="Local persistence file (NVS stand-in)")
    p.add_argument("--fake-ip", default="192.168.1.44", help="IP reported in status payload")
    args = p.parse_args()

    sim = DeviceSim(args)
    sim.run()


if __name__ == "__main__":
    main()
