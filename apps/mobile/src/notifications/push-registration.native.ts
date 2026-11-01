import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerThisPhoneForPush(): Promise<{
  expoPushToken: string;
  platform: "ios" | "android";
  deviceName: string | null;
}> {
  if (!Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) {
    throw new Error("Push notifications require a real iPhone or Android phone.");
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("important", {
      name: "Payments and errors",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 180, 250],
      sound: "default",
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("Notifications are disabled in the phone settings.");

  const projectId = Constants.easConfig?.projectId
    ?? (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) throw new Error("The mobile push project is not configured yet.");
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return {
    expoPushToken: token.data,
    platform: Platform.OS,
    deviceName: Device.deviceName ?? null,
  };
}
