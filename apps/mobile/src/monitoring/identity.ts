import { observe, type Context } from "@hotel/monitoring";
import { monitor } from "./index";

export function monitoringIdentity(): Context | undefined {
  let current: Context | undefined;
  observe(() => { current = monitor?.getContext(); });
  return current;
}

function isCurrent(expected?: Context) {
  const current = monitoringIdentity();
  return !expected || current?.sessionId === expected.sessionId && (current?.userId ?? "") === (expected.userId ?? "");
}

export function identifyMonitoringUser(user: { id: string; displayName?: string | null }, expected?: Context) {
  if (!isCurrent(expected)) return false;
  observe(() => {
    if (monitor?.getContext().userId && monitor.getContext().userId !== user.id) {
      void monitor.flush().catch(() => {});
      monitor.resetUser();
    }
    monitor?.identify(user.id, { userName: user.displayName ?? "", companyId: "", companyName: "" });
  });
  return true;
}

export function identifyMonitoringHotel(hotel: { id?: string; name: string }, expected?: Context) {
  if (!isCurrent(expected)) return false;
  observe(() => monitor?.setContext({ companyId: hotel.id ?? "", companyName: hotel.id ? hotel.name : "" }));
  return true;
}

export function clearMonitoringUser(expected?: Context) {
  if (!isCurrent(expected)) return;
  observe(() => {
    void monitor?.flush().catch(() => {});
    const current = monitor?.getContext();
    if (current?.userId || current?.companyId || current?.authState === "authenticated") monitor?.resetUser();
    else monitor?.setContext({ userId: "", userName: "", companyId: "", companyName: "", authState: "anonymous" });
  });
}
