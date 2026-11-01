import { createHmac, timingSafeEqual } from "node:crypto";

export type TestOfferTokenPayload = {
  publicKey: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  expiresAt: number;
};

const payloadLength = 29;

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`test-offer:${payload}`).digest().subarray(0, 16);
}

export function createTestOfferToken(
  input: Omit<TestOfferTokenPayload, "expiresAt">,
  expiresAt: Date,
  secret: string,
): string {
  const uuid = input.publicKey.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(uuid)) throw new Error("Invalid test offer public key.");
  const payload = Buffer.alloc(payloadLength);
  Buffer.from(uuid, "hex").copy(payload, 0);
  payload.writeUInt32BE(dateToEpochDay(input.checkIn), 16);
  payload.writeUInt32BE(dateToEpochDay(input.checkOut), 20);
  payload.writeUInt32BE(Math.floor(expiresAt.getTime() / 1_000), 24);
  payload.writeUInt8(input.adults, 28);
  const encoded = payload.toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function verifyTestOfferToken(
  value: string,
  secret: string,
  now: Date,
): TestOfferTokenPayload | null {
  if (value.length > 100) return null;
  const [encoded, providedSignature, extra] = value.split(".");
  if (!encoded || !providedSignature || extra !== undefined) return null;
  const expected = signature(encoded, secret);
  let provided: Buffer;
  let payload: Buffer;
  try {
    provided = Buffer.from(providedSignature, "base64url");
    payload = Buffer.from(encoded, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected) || payload.length !== payloadLength) return null;
  const publicKey = bytesToUuid(payload.subarray(0, 16));
  const checkIn = epochDayToDate(payload.readUInt32BE(16));
  const checkOut = epochDayToDate(payload.readUInt32BE(20));
  const expiresAt = payload.readUInt32BE(24) * 1_000;
  const adults = payload.readUInt8(28);
  if (checkIn >= checkOut || adults < 1 || adults > 20 || expiresAt <= now.getTime()) return null;
  return { publicKey, checkIn, checkOut, adults, expiresAt };
}

function dateToEpochDay(value: string): number {
  const time = new Date(`${value}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(time)) throw new Error("Invalid test offer date.");
  return Math.floor(time / 86_400_000);
}

function epochDayToDate(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function bytesToUuid(value: Buffer): string {
  const hex = value.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
