import type { ConnectionRecord } from "./types.js";

export const mailKinds = ["google", "microsoft", "smtp"] as const;

export function isMailConnection(record: ConnectionRecord) {
  return record.kind === "google" || record.kind === "microsoft" || record.kind === "smtp";
}

export function selectMailConnection(records: ConnectionRecord[]) {
  const connected = records.filter((record) => isMailConnection(record) && record.state === "connected");
  // Old rows may contain several connected accounts. Never guess the sender.
  return { connection: connected.length === 1 ? connected[0]! : null, ambiguous: connected.length > 1 };
}

export class MailConnectionBusyError extends Error {
  constructor() { super("MAIL_CONNECTION_BUSY"); }
}

export class MailConnectionLostError extends Error {
  constructor() { super("MAIL_CONNECTION_INTERRUPTED"); }
}
