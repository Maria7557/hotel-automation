import { t, translateLabel } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient } from "../api/client";
import type { ClientPage, ClientProfile } from "../api/types";
import { Button, Field, InlineState } from "../components/ui";
import { demoListClients } from "./demo";

export function ExistingClientPicker({ demo, selected, disabled, onSelect, error }: {
  demo: boolean; selected: ClientProfile | null; disabled: boolean; onSelect: (client: ClientProfile) => void; error?: string | undefined;
}) {
  const [open, setOpen] = useState(!selected);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<ClientPage>({ clients: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const moreRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const current = ++sequence.current;
    setLoading(true); setLoadError(null); setMoreLoading(false);
    setPage({ clients: [], nextCursor: null });
    const timer = setTimeout(() => {
      void (demo ? Promise.resolve(demoListClients(search)) : apiClient.listClients(search)).then((data) => {
        if (current === sequence.current) setPage(data);
      }).catch(() => { if (current === sequence.current) setLoadError("Could not load clients."); })
        .finally(() => { if (current === sequence.current) setLoading(false); });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [demo, open, search, retry]);

  const loadMore = async () => {
    if (!page.nextCursor || loading || disabled) return;
    const current = sequence.current;
    const key = `${current}:${page.nextCursor}`;
    if (moreRequest.current === key) return;
    moreRequest.current = key;
    setMoreLoading(true); setLoadError(null);
    try {
      const next = await apiClient.listClients(search, page.nextCursor);
      if (current === sequence.current) setPage((old) => ({ clients: [...old.clients, ...next.clients.filter((client) => !old.clients.some(({ id }) => id === client.id))], nextCursor: next.nextCursor }));
    } catch { if (current === sequence.current) setLoadError("Could not load more clients."); }
    finally {
      if (moreRequest.current === key) moreRequest.current = null;
      if (current === sequence.current) setMoreLoading(false);
    }
  };

  return <View style={styles.wrap}>
    {selected ? <Pressable accessibilityRole="button" accessibilityLabel={t("Change client: {{v0}}", { v0: selected.name })} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen((value) => !value)} style={styles.selected}>
      <View style={styles.copy}><Text style={styles.name}>{selected.name}</Text><Text style={styles.contact}>{[selected.email, selected.phone].filter(Boolean).join(" · ")}</Text></View><ChevronDown size={20} color={theme.colors.action} />
    </Pressable> : null}
    {open ? <View style={styles.wrap}>
      <Field label={t("Search clients")} value={search} onChangeText={(value) => { setSearch(value); setLoading(true); }} placeholder={t("Name, email or phone")} autoCapitalize="none" maxLength={160} editable={!disabled} />
      {loading ? <ActivityIndicator accessibilityLabel={t("Loading clients")} color={theme.colors.action} /> : <ScrollView nestedScrollEnabled style={styles.list} keyboardShouldPersistTaps="handled">
        {page.clients.map((client) => <Pressable key={client.id} accessibilityRole="button" accessibilityLabel={t("Select client {{v0}}, {{v1}}, {{v2}}", { v0: client.name, v1: client.email ?? "no email", v2: client.phone ?? "no phone" })} disabled={disabled} onPress={() => { onSelect(client); setOpen(false); }} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
          <View style={styles.copy}><Text style={styles.name}>{client.name}</Text><Text style={styles.contact}>{[client.email, client.phone].filter(Boolean).join(" · ")}</Text></View>{selected?.id === client.id ? <Check size={20} color={theme.colors.action} /> : null}
        </Pressable>)}
        {!page.clients.length && !loadError ? <Text style={styles.empty}>{search.trim() ? t("No matching clients.") : t("No saved clients yet.")}</Text> : null}
      </ScrollView>}
      {page.nextCursor && !loading ? <Button variant="tertiary" loading={moreLoading} disabled={disabled} onPress={() => void loadMore()}>{t("Load more clients")}</Button> : null}
      {loadError ? <><InlineState tone="danger">{loadError}</InlineState><Button variant="tertiary" disabled={disabled} onPress={() => setRetry((value) => value + 1)}>{t("Retry clients")}</Button></> : null}
    </View> : null}
    {selected && (!selected.email || !selected.phone) ? <Text style={styles.contact}>{t("Add the missing contact details below.")}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{translateLabel(error)}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[2] }, copy: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  selected: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], padding: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.action, borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint },
  name: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, contact: { ...theme.typography.caption, color: theme.colors.textSecondary },
  list: { maxHeight: 220, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md },
  option: { minHeight: theme.controls.minTarget, flexDirection: "row", alignItems: "center", gap: theme.spacing[2], padding: theme.spacing[3], borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  empty: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, padding: theme.spacing[3] },
  error: { ...theme.typography.caption, color: theme.colors.danger }, pressed: { backgroundColor: theme.colors.actionTint },
});
