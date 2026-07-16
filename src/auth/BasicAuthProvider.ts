import { Request } from "express";
import { AdminIdentity, AuthProvider, CredentialStore } from "./types";
import { verifyPassword } from "./password";

/**
 * HTTP Basic auth against a CredentialStore. Passwords are verified with
 * scrypt; unknown users still run a verify against a dummy hash to keep
 * timing roughly constant (avoid a user-enumeration oracle).
 */
export class BasicAuthProvider implements AuthProvider {
  readonly scheme = "Basic";
  // A syntactically valid scrypt hash that no real password matches.
  private static readonly DUMMY_HASH =
    "scrypt$16384$8$1$00000000000000000000000000000000$" +
    "0000000000000000000000000000000000000000000000000000000000000000";

  constructor(private readonly store: CredentialStore) {}

  async authenticate(req: Request): Promise<AdminIdentity | null> {
    const header = req.header("authorization");
    if (!header || !header.startsWith("Basic ")) return null;

    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    const username = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);

    const admin = await this.store.getByUsername(username);
    const hash = admin?.passwordHash ?? BasicAuthProvider.DUMMY_HASH;
    const ok = await verifyPassword(password, hash);

    if (!admin || !ok) return null;
    return { username: admin.username };
  }
}
