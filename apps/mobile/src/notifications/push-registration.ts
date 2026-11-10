import { t } from "../i18n";
// TypeScript fallback. Metro selects the native or web implementation at runtime.
export async function registerThisPhoneForPush(): Promise<never> {
  throw new Error(t("Push notifications are unavailable on this platform."));
}
