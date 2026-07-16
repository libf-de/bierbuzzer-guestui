import { Request } from "express";

export interface AdminRecord {
  username: string;
  passwordHash: string; // opaque, produced by password.ts
  createdAt: number;
}

export interface AdminIdentity {
  username: string;
}

/**
 * Storage for admin credentials. Swap NeDbCredentialStore for another
 * backend by implementing this.
 */
export interface CredentialStore {
  init(): Promise<void>;
  getByUsername(username: string): Promise<AdminRecord | null>;
  create(rec: AdminRecord): Promise<AdminRecord>;
  delete(username: string): Promise<boolean>;
  count(): Promise<number>;
  listUsernames(): Promise<string[]>;
}

/**
 * Pluggable authentication strategy. Returns the authenticated admin, or
 * null if the request carries no / invalid credentials. Swap the impl
 * (Basic, Bearer/JWT, mTLS, ...) without touching routes.
 */
export interface AuthProvider {
  /** Human-readable scheme name, used for the WWW-Authenticate challenge. */
  readonly scheme: string;
  authenticate(req: Request): Promise<AdminIdentity | null>;
}
