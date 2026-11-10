import { AppError } from "../lib/errors.js";

export type ClientInput = { name: string; email: string | null; phone: string | null; locale: string; notes: string };
export type ClientIdentity = { normalizedEmail: string | null; normalizedPhone: string | null };

export function clientIdentity(input: Pick<ClientInput, "email" | "phone">): ClientIdentity {
  const phone = input.phone?.trim().replace(/[\s().-]/g, "").replace(/^00/, "+") ?? "";
  return {
    normalizedEmail: input.email?.trim().toLowerCase() || null,
    // Never guess a country code or match people by their name.
    normalizedPhone: /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null,
  };
}

export function ensureClientIdentity(input: Pick<ClientInput, "email" | "phone">): ClientIdentity {
  const identity = clientIdentity(input);
  if (!identity.normalizedEmail && !identity.normalizedPhone) {
    throw new AppError(422, "CLIENT_CONTACT_REQUIRED", "Provide an email or a phone number with its country code, for example +39 333 1234567.");
  }
  return identity;
}

export function clientMatch<T extends { id: string; normalizedEmail: string | null; normalizedPhone: string | null }>(matches: T[], identity: ClientIdentity): T | null {
  if (matches.length > 1) throw new AppError(409, "CLIENT_IDENTITY_CONFLICT", "Email and phone match different contacts. Review the contacts before adding this client.");
  const match = matches[0];
  // A shared phone must not silently join two different email identities.
  if (match && identity.normalizedEmail && match.normalizedEmail && identity.normalizedEmail !== match.normalizedEmail) {
    throw new AppError(409, "CLIENT_IDENTITY_CONFLICT", "This phone belongs to a contact with a different email. Review the contacts before adding this client.");
  }
  return match ?? null;
}
