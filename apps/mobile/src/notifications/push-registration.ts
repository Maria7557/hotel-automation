// TypeScript fallback. Metro selects the native or web implementation at runtime.
export async function registerThisPhoneForPush(): Promise<never> {
  throw new Error("Push notifications are unavailable on this platform.");
}
