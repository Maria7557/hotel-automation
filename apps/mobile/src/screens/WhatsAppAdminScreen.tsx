import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleCheck,
  MessageCircle,
  RefreshCw,
  Search,
  Smartphone,
} from "lucide-react-native";
import { theme } from "@hotel/design";

import { apiClient } from "@/api/client";
import type { PlatformWhatsAppSession, PlatformWhatsAppSnapshot } from "@/api/types";
import { Button, InlineState, uiStyles } from "@/components/ui";

type Filter = "all" | PlatformWhatsAppSession["health"];

export function WhatsAppAdminScreen({ onBack }: { onBack?: () => void }) {
  const [snapshot, setSnapshot] = useState<PlatformWhatsAppSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setSnapshot(await apiClient.getPlatformWhatsAppSessions());
    } catch {
      setError("Could not load WhatsApp diagnostics. Check the API and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (snapshot?.sessions ?? []).filter((session) => {
      if (filter !== "all" && session.health !== filter) return false;
      if (!needle) return true;
      return [session.hotelName, session.city, session.phoneNumber, session.pushName, session.contactEmail]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [filter, query, snapshot]);

  const restart = (session: PlatformWhatsAppSession) => {
    Alert.alert(
      "Restart WhatsApp session?",
      `This safely restarts ${session.hotelName}'s WAHA session. The hotel may need to scan its QR code again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restart",
          onPress: () => void (async () => {
            setRestarting(session.hotelId);
            setError(null);
            try {
              const updated = await apiClient.restartPlatformWhatsAppSession(session.hotelId);
              setSnapshot((current) => current ? {
                ...current,
                sessions: current.sessions.map((item) => item.hotelId === updated.hotelId ? updated : item),
              } : current);
            } catch {
              setError(`Could not restart ${session.hotelName}. The incident was recorded on the connection.`);
            } finally {
              setRestarting(null);
            }
          })(),
        },
      ],
    );
  };

  return (
    <View style={uiStyles.screen}>
      <View style={styles.topBar}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.backButton}>
            <ChevronLeft size={24} color={theme.colors.text} />
          </Pressable>
        ) : (
          <View style={[styles.backButton, styles.supportMark]}><MessageCircle size={21} color={theme.colors.action} /></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={uiStyles.h2}>WhatsApp support</Text>
          <Text style={uiStyles.caption}>All hotel phones · live WAHA status</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={() => void load(true)} style={styles.backButton}>
          <RefreshCw size={20} color={theme.colors.action} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.action} /><Text style={uiStyles.caption}>Checking WAHA sessions…</Text></View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={({ hotelId }) => hotelId}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.action} />}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <View style={styles.headerContent}>
              {error ? <InlineState tone="danger">{error}</InlineState> : null}
              {snapshot && !snapshot.provider.configured ? <InlineState tone="warning">WAHA is not configured on the API server</InlineState> : null}
              {snapshot?.provider.configured && !snapshot.provider.reachable ? <InlineState tone="danger">WAHA is unreachable · {snapshot.provider.errorCode}</InlineState> : null}
              {snapshot ? <Summary snapshot={snapshot} /> : null}
              <View style={styles.searchWrap}>
                <Search size={18} color={theme.colors.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Hotel, phone, email…"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.searchInput}
                  accessibilityLabel="Search WhatsApp sessions"
                />
              </View>
              <View style={styles.filters}>
                {(["all", "connected", "attention", "connecting", "disconnected"] as Filter[]).map((value) => (
                  <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}>
                    <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{filterLabel(value)}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.resultCount}>{sessions.length} shown</Text>
            </View>
          }
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              expanded={expanded === item.hotelId}
              restarting={restarting === item.hotelId}
              onToggle={() => setExpanded((current) => current === item.hotelId ? null : item.hotelId)}
              onRestart={() => restart(item)}
            />
          )}
          ListEmptyComponent={<View style={styles.empty}><MessageCircle size={28} color={theme.colors.textMuted} /><Text style={styles.emptyTitle}>No matching hotel phones</Text><Text style={uiStyles.caption}>Change the filter or search query.</Text></View>}
        />
      )}
    </View>
  );
}

function Summary({ snapshot }: { snapshot: PlatformWhatsAppSnapshot }) {
  const items = [
    { label: "Connected", value: snapshot.counts.connected, tone: theme.colors.success },
    { label: "Attention", value: snapshot.counts.attention, tone: theme.colors.danger },
    { label: "Connecting", value: snapshot.counts.connecting, tone: theme.colors.warning },
    { label: "Not connected", value: snapshot.counts.disconnected, tone: theme.colors.textMuted },
  ];
  return <View style={styles.summary}>{items.map((item) => <View key={item.label} style={styles.summaryCard}><Text style={[styles.summaryValue, { color: item.tone }]}>{item.value}</Text><Text style={styles.summaryLabel}>{item.label}</Text></View>)}</View>;
}

function SessionRow({ session, expanded, restarting, onToggle, onRestart }: {
  session: PlatformWhatsAppSession;
  expanded: boolean;
  restarting: boolean;
  onToggle: () => void;
  onRestart: () => void;
}) {
  const status = healthStyle(session.health);
  const StatusIcon = session.health === "connected" ? CircleCheck : session.health === "attention" ? AlertTriangle : Smartphone;
  return (
    <View style={styles.sessionCard}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.sessionMain}>
        <View style={[styles.statusIcon, { backgroundColor: status.background }]}><StatusIcon size={20} color={status.color} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.hotelLine}><Text numberOfLines={1} style={styles.hotelName}>{session.hotelName}</Text><View style={[styles.statusPill, { backgroundColor: status.background }]}><Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text></View></View>
          <Text style={styles.phone}>{session.phoneNumber ? `+${session.phoneNumber}` : "No phone linked"}{session.pushName ? ` · ${session.pushName}` : ""}</Text>
          <Text style={styles.meta}>{session.city} · {session.providerStatus} · sent {formatWhen(session.lastSuccessfulMessageAt)}</Text>
        </View>
        {expanded ? <ChevronUp size={19} color={theme.colors.textMuted} /> : <ChevronDown size={19} color={theme.colors.textMuted} />}
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          <Detail label="Hotel contact" value={session.contactEmail ?? session.contactPhone ?? "Not provided"} />
          <Detail label="WAHA session" value={session.sessionName ?? "Not created"} />
          <Detail label="Engine" value={session.engine ?? "Unknown"} />
          <Detail label="Message capping" value={cappingLabel(session)} danger={Boolean(session.messageCapping && session.messageCapping.status !== "NONE")} />
          <Detail label="Last check" value={formatWhen(session.lastCheckedAt)} />
          <Detail label="Last failed send" value={formatWhen(session.lastFailedMessageAt)} />
          <Detail label="Last error" value={session.lastErrorCode ?? "None"} danger={Boolean(session.lastErrorCode)} />
          {session.configured ? <Button variant="secondary" icon={RefreshCw} loading={restarting} onPress={onRestart}>Restart session</Button> : <InlineState tone="warning">The hotel must open Connections and scan its QR code</InlineState>}
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={[styles.detailValue, danger && { color: theme.colors.danger }]}>{value}</Text></View>;
}

function healthStyle(health: PlatformWhatsAppSession["health"]) {
  if (health === "connected") return { label: "Connected", color: theme.colors.success, background: theme.colors.successTint };
  if (health === "connecting") return { label: "Connecting", color: theme.colors.warning, background: theme.colors.warningTint };
  if (health === "attention") return { label: "Attention", color: theme.colors.danger, background: theme.colors.dangerTint };
  return { label: "Not connected", color: theme.colors.textMuted, background: theme.colors.surfaceMuted };
}

function filterLabel(filter: Filter): string {
  return filter === "all" ? "All" : healthStyle(filter).label;
}

function formatWhen(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const deltaMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (deltaMinutes < 1) return "now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  if (deltaMinutes < 1_440) return `${Math.floor(deltaMinutes / 60)}h ago`;
  return date.toLocaleDateString();
}

function cappingLabel(session: PlatformWhatsAppSession): string {
  const capping = session.messageCapping;
  if (!capping) return "Not reported";
  const usage = capping.usedQuota !== null && capping.totalQuota !== null ? ` · ${capping.usedQuota}/${capping.totalQuota}` : "";
  const reset = capping.cycleEnd ? ` · resets ${new Date(capping.cycleEnd * 1_000).toLocaleString()}` : "";
  return `${capping.status}${usage}${reset}`;
}

const styles = StyleSheet.create({
  topBar: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingHorizontal: theme.controls.contentInset, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
  backButton: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border },
  supportMark: { backgroundColor: theme.colors.actionTint, borderColor: theme.colors.actionTint },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  content: { paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[4], paddingBottom: theme.spacing[10], gap: theme.spacing[2] },
  headerContent: { gap: theme.spacing[3], marginBottom: theme.spacing[3] },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  summaryCard: { minWidth: 130, flexGrow: 1, flexBasis: 130, padding: theme.spacing[3], borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  summaryValue: { ...theme.typography.h2 },
  summaryLabel: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  searchWrap: { minHeight: 48, paddingHorizontal: theme.spacing[3], flexDirection: "row", alignItems: "center", gap: theme.spacing[2], borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface },
  searchInput: { flex: 1, ...theme.typography.bodySmall, color: theme.colors.text, paddingVertical: theme.spacing[2] },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  filter: { paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2], borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  filterActive: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  filterText: { ...theme.typography.captionMedium, color: theme.colors.textSecondary },
  filterTextActive: { color: theme.colors.onAction },
  resultCount: { ...theme.typography.caption, color: theme.colors.textMuted },
  sessionCard: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg, overflow: "hidden", marginBottom: theme.spacing[2] },
  sessionMain: { minHeight: 84, padding: theme.spacing[3], flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  statusIcon: { width: 42, height: 42, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center" },
  hotelLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  hotelName: { ...theme.typography.bodyMedium, color: theme.colors.text, flexShrink: 1 },
  statusPill: { borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing[2], paddingVertical: 3 },
  statusText: { ...theme.typography.captionMedium },
  phone: { ...theme.typography.bodySmallMedium, color: theme.colors.textSecondary, marginTop: 2 },
  meta: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  details: { borderTopWidth: 1, borderTopColor: theme.colors.border, padding: theme.spacing[3], gap: theme.spacing[3], backgroundColor: theme.colors.background },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: theme.spacing[4] },
  detailLabel: { ...theme.typography.caption, color: theme.colors.textMuted },
  detailValue: { ...theme.typography.captionMedium, color: theme.colors.text, textAlign: "right", flexShrink: 1 },
  empty: { alignItems: "center", gap: theme.spacing[2], paddingVertical: theme.spacing[10] },
  emptyTitle: { ...theme.typography.bodyMedium, color: theme.colors.text },
});
