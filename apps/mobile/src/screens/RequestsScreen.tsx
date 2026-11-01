import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { AlertTriangle, ArrowRight, BedDouble, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock3, Code2, Mail, MessageCircle, Search, Users, X } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient } from "@/api/client";
import type { ConnectionStatus, DashboardSnapshot, DeliverySummary, HotelProfile, HotelRequest, RequestStatus } from "@/api/types";
import { Button, EmptyState, InlineState, uiStyles } from "@/components/ui";

type ViewMode = "actions" | "all";
type ActionFilter = "payment" | "attention";
type AllFilter = "all" | RequestStatus;

type RequestsScreenProps = {
  profile: HotelProfile;
  demo: boolean;
  onOpenProfile: () => void;
  onOpenInventory: () => void;
  onOpenConnections: () => void;
  onOpenSiteIntegration: () => void;
};

export function RequestsScreen({ profile, demo, onOpenProfile, onOpenInventory, onOpenConnections, onOpenSiteIntegration }: RequestsScreenProps) {
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [roomCount, setRoomCount] = useState(demo ? 2 : 0);
  const [hasRates, setHasRates] = useState(demo);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("actions");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("payment");
  const [allFilter, setAllFilter] = useState<AllFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const inventory = demo
        ? Promise.resolve({ roomCount: 2, hasRates: true })
        : apiClient.listRooms()
            .then(async (rooms) => {
              const rates = await Promise.all(rooms.map((room) => apiClient.listRates(room.id).catch(() => [])));
              return { roomCount: rooms.length, hasRates: rates.some((roomRates) => roomRates.some((rate) => rate.active)) };
            })
            .catch(() => ({ roomCount: 0, hasRates: false }));
      const [nextDashboard, nextConnections, nextInventory] = await Promise.all([
        apiClient.getDashboard({ demo }),
        demo ? Promise.resolve([]) : apiClient.getConnections().catch(() => []),
        inventory,
      ]);
      setDashboard(nextDashboard);
      setConnections(nextConnections);
      setRoomCount(nextInventory.roomCount);
      setHasRates(nextInventory.hasRates);
      setNowMs(Date.now());
    } catch {
      setError("Could not load requests. Check your connection and try again.");
    } finally {
      refresh ? setRefreshing(false) : setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [demo]);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const connectionIssues = useMemo(
    () => connections.filter((connection) => connection.configured && connection.state !== "connected"),
    [connections],
  );
  const failedDeliveryCount = dashboard?.requests.filter(hasFailedDelivery).length ?? 0;
  const actionableCount = (dashboard?.paymentPendingCount ?? 0) + (dashboard?.attentionCount ?? 0) + connectionIssues.length;
  const visibleRequests = useMemo(() => {
    if (!dashboard) return [];
    if (viewMode === "actions") return dashboard.requests.filter((request) => request.status === actionFilter);
    const query = searchQuery.trim().toLocaleLowerCase();
    return dashboard.requests.filter((request) => {
      if (allFilter !== "all" && request.status !== allFilter) return false;
      if (!query) return true;
      return [request.guestName, request.stayLabel, request.roomLabel, request.guestLabel, request.statusLabel]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [actionFilter, allFilter, dashboard, searchQuery, viewMode]);

  const markPaymentLinkSent = async (request: HotelRequest) => {
    setBusyRequestId(request.id);
    setActionError(null);
    try {
      if (!demo) await apiClient.markPaymentLinkSent(request.id);
      setDashboard((current) => current ? {
        ...current,
        paymentPendingCount: Math.max(0, current.paymentPendingCount - 1),
        paymentPendingTotalCents: Math.max(0, current.paymentPendingTotalCents - request.totalCents),
        requests: current.requests.map((item) => {
          if (item.id !== request.id) return item;
          const { nextAction: _nextAction, ...completedRequest } = item;
          return { ...completedRequest, status: "completed", statusLabel: "Payment link sent" };
        }),
      } : current);
    } catch {
      setActionError("Could not mark the payment link as sent. Try again.");
    } finally {
      setBusyRequestId(null);
    }
  };

  if (loading) return <View style={[uiStyles.screen, styles.loading]} accessibilityLabel="Loading requests"><ActivityIndicator color={theme.colors.action} size="large" /><Text style={styles.loadingText}>Loading today’s worklist…</Text></View>;
  if (error || !dashboard) return <View style={[uiStyles.screen, styles.errorState]}><EmptyState title="Requests unavailable" description={error ?? "Try loading again."} /><Button onPress={() => void load()}>Try again</Button></View>;

  const setupComplete = Boolean(profile.name && profile.city && profile.countryCode)
    && roomCount > 0
    && hasRates
    && connections.some((connection) => connection.kind === "mail" && connection.state === "connected")
    && connections.some((connection) => connection.kind === "waha" && connection.state === "connected")
    && profile.allowedOrigins.length > 0;

  if (!demo && dashboard.totalCount === 0 && !setupComplete) {
    return <SetupPath
      profile={profile}
      connections={connections}
      roomCount={roomCount}
      hasRates={hasRates}
      refreshing={refreshing}
      onRefresh={() => void load(true)}
      onOpenProfile={onOpenProfile}
      onOpenInventory={onOpenInventory}
      onOpenConnections={onOpenConnections}
      onOpenSiteIntegration={onOpenSiteIntegration}
    />;
  }

  return <FlatList
    style={uiStyles.screen}
    contentContainerStyle={styles.content}
    data={visibleRequests}
    keyExtractor={(item) => item.id}
    renderItem={({ item }) => viewMode === "actions"
      ? <ActionRequestCard request={item} nowMs={nowMs} expanded={expandedId === item.id} busy={busyRequestId === item.id} onToggle={() => setExpandedId((current) => current === item.id ? null : item.id)} onPaymentLinkSent={() => void markPaymentLinkSent(item)} />
      : <AllRequestRow request={item} nowMs={nowMs} expanded={expandedId === item.id} onToggle={() => setExpandedId((current) => current === item.id ? null : item.id)} />}
    ItemSeparatorComponent={() => <View style={{ height: viewMode === "actions" ? theme.spacing[3] : 1, backgroundColor: viewMode === "actions" ? "transparent" : theme.colors.border }} />}
    ListHeaderComponent={<>
      <DashboardHeader
        hotelName={profile.name}
        dashboard={dashboard}
        connectionIssues={connectionIssues}
        failedDeliveryCount={failedDeliveryCount}
        actionableCount={actionableCount}
        viewMode={viewMode}
        setViewMode={(mode) => { setViewMode(mode); setExpandedId(null); }}
        actionFilter={actionFilter}
        setActionFilter={(filter) => { setActionFilter(filter); setExpandedId(null); }}
        allFilter={allFilter}
        setAllFilter={(filter) => { setAllFilter(filter); setExpandedId(null); }}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        shownCount={visibleRequests.length}
      />
      {actionError ? <InlineState tone="danger"><AlertTriangle size={15} color={theme.colors.danger} /> {actionError}</InlineState> : null}
    </>}
    ListEmptyComponent={viewMode === "actions" ? <ActionEmptyState filter={actionFilter} /> : <EmptyState title="No matching requests" description="Try another filter or search." />}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.action} />}
    initialNumToRender={14}
    maxToRenderPerBatch={20}
    windowSize={8}
    removeClippedSubviews
    showsVerticalScrollIndicator={false}
  />;
}

function SetupPath(props: {
  profile: HotelProfile;
  connections: ConnectionStatus[];
  roomCount: number;
  hasRates: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenProfile: () => void;
  onOpenInventory: () => void;
  onOpenConnections: () => void;
  onOpenSiteIntegration: () => void;
}) {
  const { profile, connections, roomCount, hasRates, refreshing, onRefresh, onOpenProfile, onOpenInventory, onOpenConnections, onOpenSiteIntegration } = props;
  const mailConnected = connections.some((connection) => connection.kind === "mail" && connection.state === "connected");
  const whatsappConnected = connections.some((connection) => connection.kind === "waha" && connection.state === "connected");
  const steps = [
    { title: "Hotel profile", detail: "Name, location and photos", complete: Boolean(profile.name && profile.city && profile.countryCode), icon: Building2, onPress: onOpenProfile },
    { title: "Rooms & rates", detail: roomCount ? "Add prices for your rooms" : "Add your first room and its prices", complete: roomCount > 0 && hasRates, icon: BedDouble, onPress: onOpenInventory },
    { title: "Mail", detail: "Send offers from your hotel address", complete: mailConnected, icon: Mail, onPress: onOpenConnections },
    { title: "WhatsApp", detail: "Send offers from your hotel number", complete: whatsappConnected, icon: MessageCircle, onPress: onOpenConnections },
    { title: "Website form", detail: "Receive enquiries from your website", complete: profile.allowedOrigins.length > 0, icon: Code2, onPress: onOpenSiteIntegration },
  ];
  const completed = steps.filter((step) => step.complete).length;
  const progress = `${Math.round((completed / steps.length) * 100)}%` as `${number}%`;

  return <FlatList
    style={uiStyles.screen}
    contentContainerStyle={styles.setupContent}
    data={steps}
    keyExtractor={(item) => item.title}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.action} />}
    ListHeaderComponent={<>
      <View style={styles.header}>
        <View style={styles.hotelAvatar}><Text style={styles.hotelAvatarText}>{profile.name.slice(0, 1).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.greeting}>Welcome to</Text><Text style={styles.hotelName} numberOfLines={1}>{profile.name}</Text></View>
      </View>
      <View style={styles.setupIntro}>
        <Text style={styles.setupTitle}>{completed === steps.length ? "Ready for your first request" : "Set up your hotel"}</Text>
        <Text style={styles.setupSubtitle}>{completed === steps.length ? "Your form and sending channels are ready." : "Complete these steps before your first request."}</Text>
        <View style={styles.setupProgressRow}><Text style={styles.setupProgressLabel}>{completed} of {steps.length}</Text><Text style={styles.setupProgressPercent}>{progress}</Text></View>
        <View style={styles.setupProgressTrack}><View style={[styles.setupProgressFill, { width: progress }]} /></View>
      </View>
    </>}
    renderItem={({ item, index }) => <SetupStep index={index + 1} {...item} />}
    ItemSeparatorComponent={() => <View style={styles.setupSeparator} />}
    ListFooterComponent={<Text style={styles.setupFooter}>{completed === steps.length ? "New website enquiries will appear here automatically." : "Tap the next unfinished step to continue."}</Text>}
    showsVerticalScrollIndicator={false}
  />;
}

function SetupStep({ index, title, detail, complete, icon: Icon, onPress }: { index: number; title: string; detail: string; complete: boolean; icon: typeof Building2; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${index}. ${title}. ${complete ? "Completed" : detail}`} onPress={onPress} style={({ pressed }) => [styles.setupStep, pressed && styles.pressed]}>
    <View style={[styles.setupStepNumber, complete && styles.setupStepNumberComplete]}>{complete ? <Check size={18} color={theme.colors.onAction} strokeWidth={3} /> : <Text style={styles.setupStepNumberText}>{index}</Text>}</View>
    <View style={styles.setupStepIcon}><Icon size={20} color={complete ? theme.colors.success : theme.colors.action} /></View>
    <View style={styles.setupStepCopy}><Text style={styles.setupStepTitle}>{title}</Text><Text style={styles.setupStepDetail}>{complete ? "Completed" : detail}</Text></View>
    <ChevronRight size={20} color={theme.colors.textMuted} />
  </Pressable>;
}

function DashboardHeader(props: {
  hotelName: string; dashboard: DashboardSnapshot; connectionIssues: ConnectionStatus[]; failedDeliveryCount: number;
  actionableCount: number; viewMode: ViewMode; setViewMode: (mode: ViewMode) => void;
  actionFilter: ActionFilter; setActionFilter: (filter: ActionFilter) => void;
  allFilter: AllFilter; setAllFilter: (filter: AllFilter) => void;
  searchQuery: string; setSearchQuery: (value: string) => void; shownCount: number;
}) {
  const { hotelName, dashboard, connectionIssues, failedDeliveryCount, actionableCount, viewMode, setViewMode, actionFilter, setActionFilter, allFilter, setAllFilter, searchQuery, setSearchQuery, shownCount } = props;
  const issueCount = dashboard.attentionCount + connectionIssues.length;
  const connectionNames = connectionIssues.map((connection) => connection.kind === "mail" ? "Mail" : "WhatsApp");
  const alerts = [
    failedDeliveryCount > 0 ? `${failedDeliveryCount} failed deliver${failedDeliveryCount === 1 ? "y" : "ies"}` : null,
    connectionNames.length ? `${connectionNames.join(" and ")} need reconnection` : null,
  ].filter(Boolean);

  return <View>
    <View style={styles.header}>
      <View style={styles.hotelAvatar}><Text style={styles.hotelAvatarText}>{hotelName.slice(0, 1).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.greeting}>Today at</Text><Text style={styles.hotelName} numberOfLines={1}>{hotelName}</Text></View>
      <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveLabel}>LIVE</Text></View>
    </View>
    <View style={styles.modeSwitch}>
      <ModeButton selected={viewMode === "actions"} label="To do" count={actionableCount} onPress={() => setViewMode("actions")} />
      <ModeButton selected={viewMode === "all"} label="All incoming" count={dashboard.totalCount} onPress={() => setViewMode("all")} />
    </View>

    {viewMode === "actions" ? <>
      <View style={styles.actionMetrics}>
        <ActionMetric selected={actionFilter === "payment"} tone="action" icon={CheckCircle2} count={dashboard.paymentPendingCount} label="Waiting payment link" onPress={() => setActionFilter("payment")} />
        <ActionMetric selected={actionFilter === "attention"} tone="danger" icon={AlertTriangle} count={issueCount} label="Not delivered" onPress={() => setActionFilter("attention")} />
      </View>
      {alerts.length && actionFilter === "attention" ? <InlineState tone="danger"><AlertTriangle size={15} color={theme.colors.danger} /> {alerts.join(" · ")}</InlineState> : null}
    </> : <>
      <View style={styles.titleBlock}><Text style={styles.pageTitle}>All incoming</Text><Text style={styles.pageSubtitle}>{dashboard.totalCount} requests received today.</Text></View>
      <View style={styles.searchField}>
        <Search size={20} color={theme.colors.textMuted} />
        <TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Search guest, room or date" placeholderTextColor={theme.colors.textMuted} style={styles.searchInput} returnKeyType="search" />
        {searchQuery ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearchQuery("")} style={styles.clearSearch}><X size={17} color={theme.colors.textMuted} /></Pressable> : null}
      </View>
      <View style={styles.filters}>
        <FilterChip selected={allFilter === "all"} label="All" onPress={() => setAllFilter("all")} />
        <FilterChip selected={allFilter === "payment"} label="To confirm" onPress={() => setAllFilter("payment")} />
        <FilterChip selected={allFilter === "new"} label="New" onPress={() => setAllFilter("new")} />
        <FilterChip selected={allFilter === "waiting"} label="Waiting" onPress={() => setAllFilter("waiting")} />
        <FilterChip selected={allFilter === "attention"} label="Not delivered" onPress={() => setAllFilter("attention")} />
      </View>
      <View style={styles.listHeading}><Text style={styles.listTitle}>Requests</Text><Text style={styles.shownCount}>{shownCount} shown</Text></View>
    </>}
  </View>;
}

function ModeButton({ selected, label, count, onPress }: { selected: boolean; label: string; count: number; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.modeButton, selected && styles.modeButtonSelected, pressed && styles.pressed]}>
    <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{label}</Text>
    <View style={[styles.modeCount, selected && styles.modeCountSelected]}><Text style={[styles.modeCountText, selected && styles.modeCountTextSelected]}>{count}</Text></View>
  </Pressable>;
}

function ActionMetric({ selected, tone, icon: Icon, count, label, onPress }: { selected: boolean; tone: "action" | "danger"; icon: typeof CheckCircle2; count: number; label: string; onPress: () => void }) {
  const color = tone === "danger" ? theme.colors.danger : theme.colors.action;
  const tint = tone === "danger" ? theme.colors.dangerTint : theme.colors.actionTint;
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.actionMetric, selected && { borderColor: color, backgroundColor: tint }, pressed && styles.pressed]}>
    <View style={styles.metricTop}><Icon size={20} color={color} /><Text style={[styles.metricCount, { color }]}>{count}</Text></View>
    <Text style={styles.metricLabel}>{label}</Text>
  </Pressable>;
}

function ActionRequestCard({ request, nowMs, expanded, busy, onToggle, onPaymentLinkSent }: { request: HotelRequest; nowMs: number; expanded: boolean; busy: boolean; onToggle: () => void; onPaymentLinkSent: () => void }) {
  const issue = request.status === "attention";
  const accent = issue ? theme.colors.danger : theme.colors.action;
  return <View style={styles.actionCard}>
    <View style={[styles.actionRail, { backgroundColor: accent }]} />
    <View style={styles.actionCardBody}>
      <View style={styles.actionEyebrow}>
        {issue ? <AlertTriangle size={16} color={accent} /> : <Clock3 size={16} color={accent} />}
        <Text style={[styles.waitingText, { color: accent }]}>{waitingLabel(request.receivedAt, nowMs)}</Text>
      </View>
      <View style={styles.actionNameRow}><Text numberOfLines={1} style={styles.actionGuest}>{request.guestName}</Text><Text style={[styles.actionPrice, { color: accent }]}>{request.totalLabel}</Text></View>
      <DetailLine icon={CalendarDays} text={request.stayLabel} />
      <DetailLine icon={BedDouble} text={request.roomLabel} />
      <DetailLine icon={Users} text={request.guestLabel} />
      {expanded ? <RequestDetails request={request} /> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: issue ? expanded : undefined, disabled: busy }} disabled={busy} onPress={issue ? onToggle : onPaymentLinkSent} style={({ pressed }) => [styles.reviewButton, { backgroundColor: accent }, (pressed || busy) && styles.pressed]}>
        {busy ? <ActivityIndicator color={theme.colors.onAction} /> : <>
          <Text style={styles.reviewButtonText}>{issue ? (expanded ? "Close details" : "View details") : "Payment link sent"}</Text>
          {issue ? (expanded ? <ChevronUp size={18} color={theme.colors.onAction} /> : <ArrowRight size={18} color={theme.colors.onAction} />) : <Check size={18} color={theme.colors.onAction} strokeWidth={3} />}
        </>}
      </Pressable>
    </View>
  </View>;
}

function DetailLine({ icon: Icon, text }: { icon: typeof CalendarDays; text: string }) {
  return <View style={styles.detailLine}><Icon size={18} color={theme.colors.textMuted} /><Text style={styles.detailText}>{text}</Text></View>;
}

function AllRequestRow({ request, nowMs, expanded, onToggle }: { request: HotelRequest; nowMs: number; expanded: boolean; onToggle: () => void }) {
  const presentation = statusPresentation(request.status);
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${request.guestName}, ${request.statusLabel}, ${request.totalLabel}`} accessibilityHint="Expands delivery and offer details" onPress={onToggle} style={({ pressed }) => [styles.requestRow, pressed && styles.rowPressed]}>
    <View style={[styles.statusRail, { backgroundColor: presentation.color }]} />
    <View style={styles.rowBody}>
      <View style={styles.rowTop}><Text numberOfLines={1} style={styles.guestName}>{request.guestName}</Text><Text style={styles.price}>{request.totalLabel}</Text>{expanded ? <ChevronUp size={16} color={theme.colors.textMuted} /> : <ChevronDown size={16} color={theme.colors.textMuted} />}</View>
      <Text numberOfLines={2} style={styles.stayText}>{request.stayLabel} · {request.roomLabel} · {request.guestLabel}</Text>
      <View style={styles.rowBottom}>
        <View style={[styles.statusBadge, { backgroundColor: presentation.tint }]}><Text style={[styles.statusText, { color: presentation.color }]}>{request.statusLabel}</Text></View>
        <Text style={styles.rowWaiting}>{waitingLabel(request.receivedAt, nowMs)}</Text>
        <View style={styles.channels}><ChannelCompact icon={Mail} detail={request.email} /><ChannelCompact icon={MessageCircle} detail={request.whatsapp} /></View>
      </View>
      {expanded ? <RequestDetails request={request} /> : null}
    </View>
  </Pressable>;
}

function RequestDetails({ request }: { request: HotelRequest }) {
  return <View style={styles.expanded}>
    <View style={styles.offerSummary}><Text style={styles.expandedLabel}>OFFER</Text><Text style={styles.expandedText}>{request.roomLabel} · {request.stayLabel} · {request.guestLabel} · {request.totalLabel}</Text></View>
    <DeliveryLine label="Email" icon={Mail} detail={request.email} />
    <DeliveryLine label="WhatsApp" icon={MessageCircle} detail={request.whatsapp} />
    {request.attentionReason ? <Text style={styles.errorCode}>Issue: {request.attentionReason}</Text> : null}
  </View>;
}

function ActionEmptyState({ filter }: { filter: ActionFilter }) {
  return <View style={styles.actionEmpty}><View style={styles.actionEmptyIcon}><CheckCircle2 size={26} color={theme.colors.success} /></View><Text style={styles.actionEmptyTitle}>{filter === "payment" ? "Nothing to confirm" : "No unresolved issues"}</Text><Text style={styles.actionEmptyText}>You’re all caught up. New tasks will appear here automatically.</Text></View>;
}

function FilterChip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.filter, selected && styles.filterSelected, pressed && styles.pressed]}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable>;
}

function ChannelCompact({ icon: Icon, detail }: { icon: typeof Mail; detail: DeliverySummary }) {
  const color = deliveryColor(detail.status);
  return <View style={styles.channelCompact}><Icon size={15} color={color} /><View style={[styles.channelDot, { backgroundColor: color }]} /></View>;
}

function DeliveryLine({ label, icon: Icon, detail }: { label: string; icon: typeof Mail; detail: DeliverySummary }) {
  const color = deliveryColor(detail.status);
  return <View style={styles.deliveryLine}><Icon size={17} color={color} /><View style={{ flex: 1 }}><Text style={styles.deliveryTitle}>{label} · {deliveryLabel(detail.status)}</Text><Text style={styles.deliveryMeta}>{detail.recipient ?? "No recipient"}{detail.processedAt ? ` · ${formatTime(detail.processedAt)}` : ""}</Text>{detail.lastErrorCode ? <Text style={styles.errorCode}>{detail.lastErrorCode}</Text> : null}</View></View>;
}

function hasFailedDelivery(request: HotelRequest): boolean { return request.email.status === "failed" || request.whatsapp.status === "failed"; }
function waitingLabel(value: string, nowMs: number): string {
  const receivedMs = Date.parse(value);
  if (!Number.isFinite(receivedMs)) return value;
  const minutes = Math.max(1, Math.floor((nowMs - receivedMs) / 60_000));
  if (minutes < 60) return `${minutes} min waiting`;
  if (minutes < 1_440) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return rest ? `${hours} h ${rest} min waiting` : `${hours} h waiting`; }
  return `${Math.floor(minutes / 1_440)} d waiting`;
}
function statusPresentation(status: RequestStatus) {
  if (status === "payment") return { color: theme.colors.action, tint: theme.colors.actionTint };
  if (status === "completed") return { color: theme.colors.success, tint: theme.colors.successTint };
  if (status === "attention") return { color: theme.colors.danger, tint: theme.colors.dangerTint };
  if (status === "new") return { color: theme.colors.success, tint: theme.colors.successTint };
  return { color: theme.colors.warning, tint: theme.colors.warningTint };
}
function deliveryColor(status: DeliverySummary["status"]): string { return status === "failed" ? theme.colors.danger : status === "pending" ? theme.colors.warning : status === "sent" ? theme.colors.success : theme.colors.textMuted; }
function deliveryLabel(status: DeliverySummary["status"]): string { return status === "sent" ? "Sent" : status === "pending" ? "Pending" : status === "failed" ? "Failed" : "Not used"; }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date); }

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[8] },
  setupContent: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[8] },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[3] }, loadingText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  errorState: { flex: 1, justifyContent: "center", padding: theme.spacing[5], gap: theme.spacing[3] },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingTop: theme.spacing[3] },
  hotelAvatar: { width: 40, height: 40, borderRadius: theme.radii.md, backgroundColor: theme.colors.action, alignItems: "center", justifyContent: "center" }, hotelAvatarText: { ...theme.typography.h4, color: theme.colors.onAction },
  greeting: { ...theme.typography.caption, color: theme.colors.textMuted }, hotelName: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  livePill: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing[3], backgroundColor: theme.colors.successTint }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.success }, liveLabel: { ...theme.typography.captionMedium, color: theme.colors.success },
  setupIntro: { marginTop: theme.spacing[8], marginBottom: theme.spacing[5] },
  setupTitle: { ...theme.typography.h2, color: theme.colors.text },
  setupSubtitle: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, marginTop: theme.spacing[2] },
  setupProgressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: theme.spacing[5], marginBottom: theme.spacing[2] },
  setupProgressLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  setupProgressPercent: { ...theme.typography.captionMedium, color: theme.colors.action },
  setupProgressTrack: { height: 7, overflow: "hidden", borderRadius: theme.radii.pill, backgroundColor: theme.colors.border },
  setupProgressFill: { height: "100%", borderRadius: theme.radii.pill, backgroundColor: theme.colors.action },
  setupStep: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[3], backgroundColor: theme.colors.surface },
  setupSeparator: { height: 1, marginLeft: 88, backgroundColor: theme.colors.border },
  setupStepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  setupStepNumberComplete: { backgroundColor: theme.colors.success },
  setupStepNumberText: { ...theme.typography.captionMedium, color: theme.colors.action },
  setupStepIcon: { width: 34, height: 34, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceMuted },
  setupStepCopy: { flex: 1 },
  setupStepTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  setupStepDetail: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 3 },
  setupFooter: { ...theme.typography.caption, color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[5], paddingHorizontal: theme.spacing[4] },
  modeSwitch: { flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[5], padding: 4, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceMuted },
  modeButton: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing[2], borderRadius: theme.radii.md },
  modeButtonSelected: { backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  modeLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.textMuted }, modeLabelSelected: { color: theme.colors.text },
  modeCount: { minWidth: 25, height: 25, borderRadius: theme.radii.pill, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.border }, modeCountSelected: { backgroundColor: theme.colors.action }, modeCountText: { ...theme.typography.captionMedium, color: theme.colors.textSecondary }, modeCountTextSelected: { color: theme.colors.onAction },
  titleBlock: { marginTop: theme.spacing[6], marginBottom: theme.spacing[4], gap: 3 }, pageTitle: { ...theme.typography.h2, color: theme.colors.text }, pageSubtitle: { ...theme.typography.bodySmall, color: theme.colors.textMuted },
  actionMetrics: { flexDirection: "row", gap: theme.spacing[3], marginTop: theme.spacing[5], marginBottom: theme.spacing[3] },
  actionMetric: { flex: 1, minHeight: 92, padding: theme.spacing[3], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing[2] }, metricCount: { ...theme.typography.h2 }, metricLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  listHeading: { marginTop: theme.spacing[5], marginBottom: theme.spacing[3], flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, listTitle: { ...theme.typography.h3, color: theme.colors.text }, shownCount: { ...theme.typography.captionMedium, color: theme.colors.textMuted },
  searchField: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: theme.spacing[2], paddingHorizontal: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface }, searchInput: { flex: 1, ...theme.typography.bodySmall, color: theme.colors.text, paddingVertical: theme.spacing[2] }, clearSearch: { width: 32, height: 32, borderRadius: theme.radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceMuted },
  filters: { flexDirection: "row", gap: 6, marginTop: theme.spacing[3], flexWrap: "wrap" }, filter: { minHeight: 36, justifyContent: "center", borderRadius: theme.radii.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing[3] }, filterSelected: { backgroundColor: theme.colors.action, borderColor: theme.colors.action }, filterText: { ...theme.typography.captionMedium, color: theme.colors.textSecondary }, filterTextSelected: { color: theme.colors.onAction }, pressed: { opacity: 0.7 },
  actionCard: { flexDirection: "row", overflow: "hidden", borderRadius: theme.radii.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, actionRail: { width: 5 }, actionCardBody: { flex: 1, padding: theme.spacing[4], gap: theme.spacing[2] },
  actionEyebrow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: theme.spacing[1] }, waitingText: { ...theme.typography.captionMedium },
  actionNameRow: { flexDirection: "row", alignItems: "baseline", gap: theme.spacing[3], marginBottom: theme.spacing[1] }, actionGuest: { ...theme.typography.h3, color: theme.colors.text, flex: 1 }, actionPrice: { ...theme.typography.h3 },
  detailLine: { minHeight: 25, flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }, detailText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, flex: 1 },
  reviewButton: { minHeight: 48, marginTop: theme.spacing[2], borderRadius: theme.radii.md, paddingHorizontal: theme.spacing[4], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing[2] }, reviewButtonText: { ...theme.typography.button, color: theme.colors.onAction },
  actionEmpty: { alignItems: "center", paddingVertical: theme.spacing[10], paddingHorizontal: theme.spacing[5] }, actionEmptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.successTint, marginBottom: theme.spacing[3] }, actionEmptyTitle: { ...theme.typography.h4, color: theme.colors.text, textAlign: "center" }, actionEmptyText: { ...theme.typography.bodySmall, color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[2] },
  requestRow: { minHeight: 92, flexDirection: "row", backgroundColor: theme.colors.background }, rowPressed: { backgroundColor: theme.colors.surfaceMuted }, statusRail: { width: 3, borderRadius: theme.radii.pill, marginVertical: 10 }, rowBody: { flex: 1, paddingVertical: 10, paddingLeft: theme.spacing[3] }, rowTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }, guestName: { ...theme.typography.bodySmallMedium, color: theme.colors.text, flex: 1 }, price: { ...theme.typography.bodySmallMedium, color: theme.colors.text, minWidth: 62, textAlign: "right" }, stayText: { ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 4, paddingRight: theme.spacing[3] },
  rowBottom: { minHeight: 22, flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: 7 }, statusBadge: { borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }, statusText: { ...theme.typography.captionMedium, fontSize: 10 }, rowWaiting: { ...theme.typography.caption, color: theme.colors.textMuted, flex: 1 }, channels: { flexDirection: "row", gap: theme.spacing[2] }, channelCompact: { flexDirection: "row", alignItems: "center", gap: 3 }, channelDot: { width: 5, height: 5, borderRadius: 3 },
  expanded: { gap: theme.spacing[3], marginTop: theme.spacing[3], paddingTop: theme.spacing[3], borderTopWidth: 1, borderTopColor: theme.colors.border }, offerSummary: { gap: 3 }, expandedLabel: { ...theme.typography.captionMedium, color: theme.colors.textMuted, fontSize: 10, letterSpacing: 0.5 }, expandedText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary }, deliveryLine: { flexDirection: "row", gap: theme.spacing[2], alignItems: "flex-start" }, deliveryTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, deliveryMeta: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 }, errorCode: { ...theme.typography.captionMedium, color: theme.colors.danger, marginTop: 2 },
});
