import { createContext, memo, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { AlertCircle, Info, UserPlus } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient } from "@/api/client";
import { ClientStatusStore } from "../clients/status-store";
import { demoAddRequestClient, demoClientStatuses } from "../clients/demo";
import { Tooltip } from "./Tooltip";
import { actionStyles } from "./actionStyles";

const Context = createContext<{ store: ClientStatusStore; demo: boolean } | null>(null);
export function RequestClientStatusProvider({ demo, children }: { demo: boolean; children: ReactNode }) {
  const [value] = useState(() => ({ demo, store: new ClientStatusStore((ids) => demo ? Promise.resolve(demoClientStatuses(ids)) : apiClient.getRequestClientStatuses(ids)) }));
  const cleanup = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (cleanup.current) clearTimeout(cleanup.current);
    return () => { cleanup.current = setTimeout(() => value.store.dispose(), 0); };
  }, [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRequestClient(inquiryId: string) {
  const context = useContext(Context);
  if (!context) throw new Error("Contact status provider is required.");
  const { store, demo } = context;
  const subscribe = useCallback((callback: () => void) => store.subscribe(inquiryId, callback), [store, inquiryId]);
  const get = useCallback(() => store.get(inquiryId), [store, inquiryId]);
  const status = useSyncExternalStore(subscribe, get, get);
  const getClientId = useCallback(() => store.getClientId(inquiryId), [store, inquiryId]);
  const clientId = useSyncExternalStore(subscribe, getClientId, getClientId);
  return { store, demo, status, clientId };
}

export const RequestClientStatus = memo(function RequestClientStatus({ inquiryId }: { inquiryId: string }) {
  const { store, demo, status } = useRequestClient(inquiryId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const client = demo ? demoAddRequestClient(inquiryId) : await apiClient.addRequestClient(inquiryId);
      if (!client) throw new Error("Request was not found.");
      store.markPresent(inquiryId, client.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add client. Try again."); }
    finally { setBusy(false); }
  };
  if (status === "loading" || status === "present") return null;
  if (status === "error") return <Pressable accessibilityRole="button" accessibilityLabel="Failed to load client status. Retry" onPress={(e) => { e.stopPropagation(); store.retry(inquiryId); }} style={styles.badge}>
    <AlertCircle size={theme.controls.actionIconSize} style={actionStyles.icon} color={theme.colors.danger} /><Text style={styles.label}>Failed to load client status</Text>
  </Pressable>;
  return <View style={styles.wrap}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Add client to contacts" accessibilityHint="Client is not in the clients list yet" accessibilityState={{ disabled: busy, busy }} disabled={busy} hitSlop={theme.controls.helperHitSlop} onPress={(e) => { e.stopPropagation(); void add(); }} style={({ pressed }) => [styles.add, (pressed || busy) && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator size="small" style={actionStyles.helperIcon} color={theme.colors.danger} /> : <UserPlus size={theme.controls.helperIconSize} style={actionStyles.helperIcon} color={theme.colors.danger} />}
        <Text style={styles.addLabel}>Add client to contacts</Text>
      </Pressable>
      <Tooltip content="Client is not in the clients list yet">{({ triggerProps, visible, toggle }) => <Pressable {...triggerProps} accessibilityRole="button" accessibilityLabel="Why add this client?" accessibilityState={{ expanded: visible }} hitSlop={theme.controls.helperHitSlop} onPress={(e) => { e.stopPropagation(); toggle(); }} style={styles.info}>
        <Info size={theme.controls.helperIconSize} color={theme.colors.helperIcon} />
      </Pressable>}</Tooltip>
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
});
const styles = StyleSheet.create({
  wrap: { alignSelf: "center", maxWidth: "100%", gap: theme.controls.actionGap }, row: { ...actionStyles.associated, flexWrap: "wrap" },
  add: { ...actionStyles.control, minHeight: theme.controls.helperSize, minWidth: theme.controls.helperSize, flexShrink: 1, borderWidth: 1, paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[1], borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerTint },
  addLabel: { ...theme.typography.captionMedium, color: theme.colors.danger, flexShrink: 1 },
  label: { ...actionStyles.label, color: theme.colors.danger, flexShrink: 1 },
  info: { ...actionStyles.helperIconButton },
  error: { ...theme.typography.caption, color: theme.colors.danger, maxWidth: 310 },
  badge: { ...actionStyles.control, alignSelf: "flex-start", backgroundColor: theme.colors.dangerTint },
});
