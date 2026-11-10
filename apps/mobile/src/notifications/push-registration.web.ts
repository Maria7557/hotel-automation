import { t } from "../i18n";
export async function registerThisPhoneForPush(): Promise<never> {
  throw new Error(t("Open the Hotel app on an iPhone or Android phone to enable push notifications."));
}
