import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { getLocales, getCalendars } from "expo-localization";
import { createMonitor, installReactNativeErrorHandler, monitoringError, observe, signalCredentials } from "@hotel/monitoring";

const credentials = signalCredentials({
  endpoint: process.env.EXPO_PUBLIC_SIGNAL_ENDPOINT,
  environment: process.env.EXPO_PUBLIC_SIGNAL_ENVIRONMENT,
  developmentKey: process.env.EXPO_PUBLIC_SIGNAL_WRITE_KEY_DEVELOPMENT,
  productionKey: process.env.EXPO_PUBLIC_SIGNAL_WRITE_KEY_PRODUCTION,
});

function initialize() {
  if (!credentials) return null;
  try {
    const native = Platform.OS !== "web";
    const version = Constants.expoConfig?.version ?? "0.1.0";
    const build = Platform.OS === "ios" ? Constants.expoConfig?.ios?.buildNumber ?? ""
      : Platform.OS === "android" ? String(Constants.expoConfig?.android?.versionCode ?? "") : process.env.EXPO_PUBLIC_SIGNAL_RELEASE ?? "";
    const shared = globalThis as typeof globalThis & { __ospioSignalMonitor?: ReturnType<typeof createMonitor>; __ospioSignalConfiguration?: { endpoint: string; environment: string } };
    if (Platform.OS === "web" && shared.__ospioSignalMonitor) {
      if (shared.__ospioSignalConfiguration?.endpoint !== credentials.endpoint || shared.__ospioSignalConfiguration.environment !== process.env.EXPO_PUBLIC_SIGNAL_ENVIRONMENT) {
        console.warn("Signal app monitoring disabled: bootstrap and app environments differ.");
        return null;
      }
      shared.__ospioSignalMonitor.setContext({ appVersion: version, buildVersion: build });
      return shared.__ospioSignalMonitor;
    }
    const created = createMonitor({
      ...credentials, platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
      service: `ospio-${Platform.OS}`, serviceVersion: process.env.EXPO_PUBLIC_SIGNAL_RELEASE ?? version,
      strictPrivacy: false, captureBrowserErrors: false, captureBrowserActions: false,
      context: { appVersion: version, buildVersion: build,
        // Explicitly suppress automatic URL detection, including password reset hashes.
        pageUrl: "/app", ...(native ? {
          deviceType: Device.deviceType === Device.DeviceType.TABLET ? "tablet" : Device.deviceType === Device.DeviceType.PHONE ? "phone" : Device.deviceType === Device.DeviceType.DESKTOP ? "desktop" : "",
          deviceModel: Device.modelName ?? "", osName: Device.osName ?? Platform.OS,
          osVersion: Device.osVersion ?? "", locale: getLocales()[0]?.languageTag ?? "",
          timezone: getCalendars()[0]?.timeZone ?? "",
        } : {}),
      },
      maxQueueSize: 500, maxRetries: 5, maxQueueAgeMs: 3_600_000,
      onDiagnostic: ({ reason, count }) => { console.warn("Signal monitoring:", reason, count ?? 0); },
    });
    if (Platform.OS === "web") {
      shared.__ospioSignalMonitor = created;
      shared.__ospioSignalConfiguration = { endpoint: credentials.endpoint, environment: process.env.EXPO_PUBLIC_SIGNAL_ENVIRONMENT ?? "" };
    }
    return created;
  } catch { return null; }
}

// Module singleton. No auth/profile data or event queues are persisted to disk.
export const monitor = initialize();

export function screenViewed(screen: string) {
  observe(() => monitor?.screen(screen, { pageUrl: `/app/${screen}`, placement: "app.navigation" }));
}
export function reportError(name: string, error: unknown, placement: string, fatal = false) {
  observe(() => fatal ? monitor?.crash(name, monitoringError(error), { placement }) : monitor?.error(name, monitoringError(error), { placement }));
}

let sessionReported = false;
export function installMonitoring() {
  if (!monitor) return () => {};
  const browserShared = globalThis as typeof globalThis & { __ospioSignalBrowserErrorsInstalled?: boolean; __ospioSignalSessionReported?: boolean };
  void monitor.ready.then(() => {
    if (!sessionReported && !(Platform.OS === "web" && browserShared.__ospioSignalSessionReported)) {
      observe(() => monitor.session("session.started", { placement: "app.bootstrap" }));
      sessionReported = true;
      if (Platform.OS === "web") browserShared.__ospioSignalSessionReported = true;
    }
  });
  const background = AppState.addEventListener("change", (state) => {
    if (state !== "active") void monitor.flush().catch(() => {});
  });
  const errorUtils = (globalThis as typeof globalThis & { ErrorUtils?: Parameters<typeof installReactNativeErrorHandler>[1] }).ErrorUtils;
  const restore = Platform.OS !== "web" && errorUtils ? installReactNativeErrorHandler({
    error: (name, error, options) => { observe(() => monitor.error(name, monitoringError(error), options)); return ""; },
    crash: (name, error, options) => { observe(() => monitor.crash(name, monitoringError(error), options)); return ""; },
  }, errorUtils) : () => {};
  const browserError = (event: ErrorEvent) => reportError("error.javascript.unhandled", event.error, "app.browser");
  const browserRejection = (event: PromiseRejectionEvent) => reportError("error.promise.unhandled", event.reason, "app.browser");
  const flush = () => { void monitor.flush().catch(() => {}); };
  const installBrowserErrors = !browserShared.__ospioSignalBrowserErrorsInstalled;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    if (installBrowserErrors) {
      window.addEventListener("error", browserError);
      window.addEventListener("unhandledrejection", browserRejection);
      browserShared.__ospioSignalBrowserErrorsInstalled = true;
    }
    window.addEventListener("pagehide", flush);
  }
  return () => {
    background.remove(); restore();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (installBrowserErrors) {
        window.removeEventListener("error", browserError);
        window.removeEventListener("unhandledrejection", browserRejection);
        browserShared.__ospioSignalBrowserErrorsInstalled = false;
      }
      window.removeEventListener("pagehide", flush);
    }
    flush();
  };
}
