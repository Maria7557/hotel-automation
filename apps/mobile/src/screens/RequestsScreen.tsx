import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { AlertTriangle, ChevronDown, ChevronUp, CreditCard, Mail, MessageCircle, Search } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient } from "@/api/client";
import type { ConnectionStatus, DashboardSnapshot, DeliverySummary, HotelRequest, RequestStatus } from "@/api/types";
import { Button, EmptyState, InlineState, uiStyles } from "@/components/ui";

type Filter = "all" | RequestStatus;

export function RequestsScreen({ hotelName, demo }: { hotelName: string; demo: boolean }) {
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [nextDashboard, nextConnections] = await Promise.all([
        apiClient.getDashboard({ demo }),
        demo ? Promise.resolve([]) : apiClient.getConnections().catch(() => []),
      ]);
      setDashboard(nextDashboard);
      setConnections(nextConnections);
    } catch {
      setError("Could not load requests. Check your connection and try again.");
    } finally {
      refresh ? setRefreshing(false) : setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [demo]);

  const filtered = useMemo(() => {
    if (!dashboard) return [];
    if (filter === "all") return dashboard.requests;
    return dashboard.requests.filter((request) => request.status === filter);
  }, [dashboard, filter]);
  const failedDeliveryCount = dashboard?.requests.filter((request) => request.email.status === "failed" || request.whatsapp.status === "failed").length ?? 0;
  const connectionIssueCount = connections.filter((connection) => connection.configured && connection.state !== "connected").length;
  const technicalIssueCount = failedDeliveryCount + connectionIssueCount;
  const todayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(new Date());

  if (loading) {
    return <View style={[uiStyles.screen, styles.loading]} accessibilityLabel="Loading requests"><ActivityIndicator color={theme.colors.action} size="large" /><Text style={styles.loadingText}>Loading today’s worklist…</Text></View>;
  }
  if (error || !dashboard) {
    return <View style={[uiStyles.screen, styles.errorState]}><EmptyState title="Requests unavailable" description={error ?? "Try loading again."} /><Button onPress={() => void load()}>Try again</Button></View>;
  }

  return (
    <FlatList
      style={uiStyles.screen}
      contentContainerStyle={styles.content}
      data={filtered}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <RequestRow request={item} expanded={expandedId === item.id} onToggle={() => setExpandedId((current) => current === item.id ? null : item.id)} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={<DashboardHeader hotelName={hotelName} todayLabel={todayLabel} dashboard={dashboard} technicalIssueCount={technicalIssueCount} failedDeliveryCount={failedDeliveryCount} connections={connections} filter={filter} setFilter={setFilter} shownCount={filtered.length} />}
      ListEmptyComponent={<EmptyState title="No matching requests" description="Try another worklist filter." />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.action} />}
      initialNumToRender={14}
      maxToRenderPerBatch={20}
      windowSize={8}
      removeClippedSubviews
      showsVerticalScrollIndicator={false}
    />
  );
}

function DashboardHeader({ hotelName, todayLabel, dashboard, technicalIssueCount, failedDeliveryCount, connections, filter, setFilter, shownCount }: {
  hotelName: string; todayLabel: string; dashboard: DashboardSnapshot; technicalIssueCount: number; failedDeliveryCount: number;
  connections: ConnectionStatus[]; filter: Filter; setFilter: (filter: Filter) => void; shownCount: number;
}) {
  const connectionNames = connections.filter((connection) => connection.configured && connection.state !== "connected").map((connection) => connection.kind === "google" ? "Google Mail" : "WhatsApp");
  const alertParts = [
    failedDeliveryCount > 0 ? `${failedDeliveryCount} failed deliver${failedDeliveryCount === 1 ? "y" : "ies"}` : null,
    connectionNames.length ? `${connectionNames.join(" and ")} need reconnection` : null,
  ].filter(Boolean);

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.hotelAvatar}><Text style={styles.hotelAvatarText}>{hotelName.slice(0, 1).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.greeting}>Operations dashboard</Text><Text style={styles.hotelName} numberOfLines={1}>{hotelName}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Search requests" style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><Search size={20} color={theme.colors.text} /></Pressable>
      </View>
      <View style={styles.titleRow}>
        <View><Text style={styles.pageTitle}>Today</Text><Text style={styles.dateText}>{todayLabel} · {dashboard.totalCount} requests</Text></View>
        <Text style={styles.liveLabel}>LIVE</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${dashboard.paymentPendingCount} payment links pending`} onPress={() => setFilter("payment")} style={({ pressed }) => [styles.paymentCard, filter === "payment" && styles.paymentCardSelected, pressed && styles.pressed]}>
        <View style={styles.paymentIcon}><CreditCard size={19} color={theme.colors.action} /></View>
        <View style={{ flex: 1 }}><Text style={styles.paymentLabel}>Payment pending</Text><Text style={styles.paymentHint}>Accepted offers ready for a payment link</Text></View>
        <View style={styles.paymentValueBlock}><Text style={styles.paymentCount}>{dashboard.paymentPendingCount}</Text><Text style={styles.paymentTotal}>{formatMoney(dashboard.paymentPendingTotalCents)}</Text></View>
      </Pressable>
      <View style={styles.metricRow}>
        <Metric label="New" value={dashboard.newCount} active={filter === "new"} onPress={() => setFilter("new")} />
        <Metric label="Waiting" value={dashboard.waitingCount} active={filter === "waiting"} onPress={() => setFilter("waiting")} />
        <Metric label="Tech issues" value={technicalIssueCount} danger active={filter === "attention"} onPress={() => setFilter("attention")} />
      </View>
      {alertParts.length ? <InlineState tone="danger"><AlertTriangle size={15} color={theme.colors.danger} /> {alertParts.join(" · ")}</InlineState> : null}
      <View style={styles.worklistHeading}><Text style={styles.worklistTitle}>Requests</Text><Text style={styles.shownCount}>{shownCount} shown</Text></View>
      <View style={styles.filters}>
        <FilterChip selected={filter === "all"} label="All" onPress={() => setFilter("all")} />
        <FilterChip selected={filter === "payment"} label="Payment" onPress={() => setFilter("payment")} />
        <FilterChip selected={filter === "new"} label="New" onPress={() => setFilter("new")} />
        <FilterChip selected={filter === "waiting"} label="Waiting" onPress={() => setFilter("waiting")} />
        <FilterChip selected={filter === "attention"} label="Issues" onPress={() => setFilter("attention")} />
      </View>
      <View style={styles.columnHeader}><Text style={styles.columnText}>GUEST · STAY · CHANNELS</Text><Text style={styles.columnText}>VALUE</Text></View>
    </View>
  );
}

function Metric({ label, value, active, danger = false, onPress }: { label: string; value: number; active: boolean; danger?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.metric, active && styles.metricActive, danger && value > 0 && styles.metricDanger, pressed && styles.pressed]}><Text style={[styles.metricValue, danger && value > 0 && styles.metricValueDanger]}>{value}</Text><Text numberOfLines={1} style={styles.metricLabel}>{label}</Text></Pressable>;
}

function FilterChip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.filter, selected && styles.filterSelected, pressed && styles.pressed]}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable>;
}

function RequestRow({ request, expanded, onToggle }: { request: HotelRequest; expanded: boolean; onToggle: () => void }) {
  const presentation = statusPresentation(request.status);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${request.guestName}, ${request.statusLabel}, ${request.totalLabel}`} accessibilityHint="Expands delivery and offer details" onPress={onToggle} style={({ pressed }) => [styles.requestRow, pressed && styles.rowPressed]}>
      <View style={[styles.statusRail, { backgroundColor: presentation.color }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={styles.guestName}>{request.guestName}</Text>
          <View style={[styles.statusBadge, { backgroundColor: presentation.tint }]}><Text style={[styles.statusText, { color: presentation.color }]}>{request.statusLabel}</Text></View>
          <Text style={styles.price}>{request.totalLabel}</Text>
          {expanded ? <ChevronUp size={16} color={theme.colors.textMuted} /> : <ChevronDown size={16} color={theme.colors.textMuted} />}
        </View>
        <View style={styles.rowMiddle}><Text numberOfLines={1} style={styles.stayText}>{request.stayLabel} · {request.roomLabel} · {request.guestLabel}</Text><Text style={styles.timeText}>{request.receivedAt}</Text></View>
        <View style={styles.rowBottom}><ChannelCompact icon={Mail} detail={request.email} /><ChannelCompact icon={MessageCircle} detail={request.whatsapp} />{request.nextAction ? <Text numberOfLines={1} style={styles.nextAction}>{request.nextAction}</Text> : null}</View>
        {expanded ? (
          <View style={styles.expanded}>
            <View style={styles.offerSummary}><Text style={styles.expandedLabel}>OFFER CONTENT</Text><Text style={styles.expandedText}>{request.roomLabel} · {request.stayLabel} · {request.guestLabel} · {request.totalLabel}</Text></View>
            <DeliveryLine label="Email offer" icon={Mail} detail={request.email} />
            <DeliveryLine label="WhatsApp offer" icon={MessageCircle} detail={request.whatsapp} />
            {request.attentionReason ? <Text style={styles.errorCode}>Issue: {request.attentionReason}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ChannelCompact({ icon: Icon, detail }: { icon: typeof Mail; detail: DeliverySummary }) {
  const color = deliveryColor(detail.status);
  return <View style={styles.channelCompact}><Icon size={14} color={color} /><View style={[styles.channelDot, { backgroundColor: color }]} /></View>;
}

function DeliveryLine({ label, icon: Icon, detail }: { label: string; icon: typeof Mail; detail: DeliverySummary }) {
  const color = deliveryColor(detail.status);
  return <View style={styles.deliveryLine}><Icon size={17} color={color} /><View style={{ flex: 1 }}><Text style={styles.deliveryTitle}>{label} · {deliveryLabel(detail.status)}</Text><Text style={styles.deliveryMeta}>{detail.recipient ?? "No recipient"}{detail.processedAt ? ` · ${formatTime(detail.processedAt)}` : ""}</Text>{detail.lastErrorCode ? <Text style={styles.errorCode}>{detail.lastErrorCode}</Text> : null}</View></View>;
}

function statusPresentation(status: RequestStatus) {
  if (status === "payment") return { color: theme.colors.action, tint: theme.colors.actionTint };
  if (status === "attention") return { color: theme.colors.danger, tint: theme.colors.dangerTint };
  if (status === "new") return { color: theme.colors.success, tint: theme.colors.successTint };
  return { color: theme.colors.warning, tint: theme.colors.warningTint };
}
function deliveryColor(status: DeliverySummary["status"]): string { return status === "failed" ? theme.colors.danger : status === "pending" ? theme.colors.warning : status === "sent" ? theme.colors.success : theme.colors.textMuted; }
function deliveryLabel(status: DeliverySummary["status"]): string { return status === "sent" ? "Sent" : status === "pending" ? "Pending" : status === "failed" ? "Failed" : "Not used"; }
function formatMoney(cents: number): string { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100); }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date); }

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[8] },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  loadingText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  errorState: { flex: 1, justifyContent: "center", padding: theme.spacing[5], gap: theme.spacing[3] },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingTop: theme.spacing[3] },
  hotelAvatar: { width: 40, height: 40, borderRadius: theme.radii.md, backgroundColor: theme.colors.action, alignItems: "center", justifyContent: "center" },
  hotelAvatarText: { ...theme.typography.h4, color: theme.colors.onAction },
  greeting: { ...theme.typography.caption, color: theme.colors.textMuted },
  hotelName: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  iconButton: { width: 40, height: 40, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  pressed: { opacity: 0.68 },
  titleRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: theme.spacing[5], marginBottom: theme.spacing[3] },
  pageTitle: { ...theme.typography.h2, color: theme.colors.text },
  dateText: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  liveLabel: { ...theme.typography.captionMedium, color: theme.colors.success, backgroundColor: theme.colors.successTint, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing[2], paddingVertical: 5 },
  paymentCard: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], padding: theme.spacing[3], backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg },
  paymentCardSelected: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint },
  paymentIcon: { width: 38, height: 38, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  paymentLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  paymentHint: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  paymentValueBlock: { alignItems: "flex-end" },
  paymentCount: { ...theme.typography.h2, color: theme.colors.action },
  paymentTotal: { ...theme.typography.captionMedium, color: theme.colors.textSecondary },
  metricRow: { flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2], marginBottom: theme.spacing[2] },
  metric: { flex: 1, minHeight: 56, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing[3], justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  metricActive: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint },
  metricDanger: { backgroundColor: theme.colors.dangerTint },
  metricValue: { ...theme.typography.h4, color: theme.colors.text },
  metricValueDanger: { color: theme.colors.danger },
  metricLabel: { ...theme.typography.caption, color: theme.colors.textMuted },
  worklistHeading: { marginTop: theme.spacing[4], flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  worklistTitle: { ...theme.typography.h3, color: theme.colors.text },
  shownCount: { ...theme.typography.captionMedium, color: theme.colors.textMuted },
  filters: { flexDirection: "row", gap: 6, marginTop: theme.spacing[3], marginBottom: theme.spacing[3], flexWrap: "wrap" },
  filter: { minHeight: 34, justifyContent: "center", borderRadius: theme.radii.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing[3] },
  filterSelected: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  filterText: { ...theme.typography.captionMedium, color: theme.colors.textSecondary },
  filterTextSelected: { color: theme.colors.onAction },
  columnHeader: { flexDirection: "row", justifyContent: "space-between", paddingBottom: theme.spacing[2], paddingHorizontal: theme.spacing[1] },
  columnText: { ...theme.typography.captionMedium, color: theme.colors.textMuted, fontSize: 10, letterSpacing: 0.6 },
  separator: { height: 1, backgroundColor: theme.colors.border },
  requestRow: { minHeight: 82, flexDirection: "row", backgroundColor: theme.colors.background },
  rowPressed: { backgroundColor: theme.colors.surfaceMuted },
  statusRail: { width: 3, borderRadius: theme.radii.pill, marginVertical: 10 },
  rowBody: { flex: 1, paddingVertical: 9, paddingLeft: theme.spacing[3] },
  rowTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  guestName: { ...theme.typography.bodySmallMedium, color: theme.colors.text, flex: 1 },
  statusBadge: { borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { ...theme.typography.captionMedium, fontSize: 10 },
  price: { ...theme.typography.bodySmallMedium, color: theme.colors.text, minWidth: 58, textAlign: "right" },
  rowMiddle: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: theme.spacing[2] },
  stayText: { ...theme.typography.caption, color: theme.colors.textSecondary, flex: 1 },
  timeText: { ...theme.typography.caption, color: theme.colors.textMuted },
  rowBottom: { minHeight: 20, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], marginTop: 5 },
  channelCompact: { flexDirection: "row", alignItems: "center", gap: 3 },
  channelDot: { width: 5, height: 5, borderRadius: 3 },
  nextAction: { ...theme.typography.captionMedium, color: theme.colors.action, marginLeft: "auto", maxWidth: 150 },
  expanded: { gap: theme.spacing[3], marginTop: theme.spacing[3], paddingTop: theme.spacing[3], borderTopWidth: 1, borderTopColor: theme.colors.border },
  offerSummary: { gap: 3 },
  expandedLabel: { ...theme.typography.captionMedium, color: theme.colors.textMuted, fontSize: 10, letterSpacing: 0.5 },
  expandedText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  deliveryLine: { flexDirection: "row", gap: theme.spacing[2], alignItems: "flex-start" },
  deliveryTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  deliveryMeta: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  errorCode: { ...theme.typography.captionMedium, color: theme.colors.danger, marginTop: 2 },
});
