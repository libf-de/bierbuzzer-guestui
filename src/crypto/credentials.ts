import { createHmac } from "crypto";

/**
 * Canonicalise a MAC to 12 lowercase hex chars, no separators.
 * Accepts "AA:BB:CC:DD:EE:FF", "aa-bb-...", "aabbccddeeff", etc.
 * The same canonical form must be used wherever creds are derived so
 * derivation is deterministic across provisioning runs.
 */
export function normalizeMac(mac: string): string {
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  return hex;
}

export interface DeviceCredentials {
  topicId: string;
  username: string;
  password: string;
}

/**
 * Derive per-device credentials from MAC + server secret (see CLAUDE.md).
 *   topic_id = HMAC-SHA256(SECRET, mac + ":topic")[:16 bytes -> hex]  (32 hex chars)
 *   password = HMAC-SHA256(SECRET, mac + ":pw")     [full 32 bytes -> hex]  (64 hex chars)
 *   username = "device_" + topic_id
 */
export function deriveCredentials(mac: string, secret: string): DeviceCredentials {
  const canonical = normalizeMac(mac);

  const topicId = createHmac("sha256", secret)
    .update(`${canonical}:topic`)
    .digest()
    .subarray(0, 16)
    .toString("hex");

  const password = createHmac("sha256", secret)
    .update(`${canonical}:pw`)
    .digest("hex");

  return { topicId, username: `device_${topicId}`, password };
}
