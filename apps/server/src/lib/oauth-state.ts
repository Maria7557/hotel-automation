import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type OAuthStatePayload = {
  h: string;
  n: string;
  e: number;
};

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createOAuthNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function hashOAuthNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function createOAuthState(
  hotelId: string,
  nonce: string,
  expiresAt: Date,
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ h: hotelId, n: nonce, e: expiresAt.getTime() } satisfies OAuthStatePayload),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyOAuthState(
  value: string,
  secret: string,
  now: Date,
): OAuthStatePayload | null {
  if (value.length > 2_048) return null;
  const [payload, providedSignature, extra] = value.split(".");
  if (!payload || !providedSignature || extra !== undefined) return null;
  const expected = signature(payload, secret);
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSignature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
    if (
      typeof parsed.h !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.h) ||
      typeof parsed.n !== "string" ||
      !/^[A-Za-z0-9_-]{20,100}$/.test(parsed.n) ||
      typeof parsed.e !== "number" ||
      !Number.isSafeInteger(parsed.e) ||
      parsed.e <= now.getTime()
    ) {
      return null;
    }
    return { h: parsed.h, n: parsed.n, e: parsed.e };
  } catch {
    return null;
  }
}
