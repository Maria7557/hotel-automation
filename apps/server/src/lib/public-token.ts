import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function createPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sealPrivateValue(value: string, secret: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function unsealPrivateValue(value: string, secret: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) {
    throw new Error("Invalid sealed value.");
  }
  try {
    const key = createHash("sha256").update(secret).digest();
    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid sealed value.");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Invalid sealed value.");
  }
}
