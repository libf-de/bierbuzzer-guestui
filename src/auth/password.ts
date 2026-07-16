import { randomBytes, scrypt as scryptCb, ScryptOptions, timingSafeEqual } from "crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

const KEYLEN = 32;
const COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLEL = 1; // p

/** Format: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, KEYLEN, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLEL,
  })) as Buffer;
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLEL}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  })) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
