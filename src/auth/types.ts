import { Request } from "express";

/** Authenticated admin identity. accountId == the external apiKey. */
export interface AdminIdentity {
  accountId: string;
  /** Human-readable account/customer name from the external checkLogin. */
  name?: string;
}

/**
 * Pluggable authentication strategy. Returns the authenticated admin, or null
 * if the request carries no / invalid credentials. Swap the impl without
 * touching routes.
 */
export interface AuthProvider {
  /** Scheme name for the WWW-Authenticate challenge. */
  readonly scheme: string;
  authenticate(req: Request): Promise<AdminIdentity | null>;
}
