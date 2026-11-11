import { t, translateLabel, getLanguage } from "../i18n";
import { requestStatusDescriptions, requestStatusLabels } from "../requests/status";
import { DASHBOARD_PAGE_SIZE, type DashboardQuery } from "@hotel/contracts";
import { RequestCard } from "@/components/RequestCard";
import { actionStyles } from "@/components/actionStyles";
import { PaymentLinkSentAction } from "@/components/PaymentLinkSentAction";
import { Tooltip } from "@/components/Tooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { AlertTriangle, ArrowDown, ArrowUp, BedDouble, Building2, Check, CheckCircle2, ChevronRight, Code2, Inbox, Mail, MessageCircle, Plus, Search, X } from "lucide-react-native";
import { requestStatusAppearance, theme, type StatusColors } from "@hotel/design";
import { apiClient } from "@/api/client";
import type { ConnectionStatus, DashboardSnapshot, HotelProfile, HotelRequest, RequestStatus } from "@/api/types";
import { Button, EmptyState, InlineState, uiStyles } from "@/components/ui";
import { ManualRequestModal } from "../requests/ManualRequestModal";

type ViewMode = "actions" | "all";
type ActionFilter = "new" | "payment" | "attention";
type AllFilter = "all" | RequestStatus;
type FilterColors = { backgroundColor: string; textColor: string };

const filterAppearance = {
  all: { backgroundColor: "#BCC9DE", textColor: "#243752" },
  new: { backgroundColor: requestStatusAppearance.newRequest.backgroundColor, textColor: requestStatusAppearance.newRequest.textColor },
  waiting: { backgroundColor: "#E4C98D", textColor: "#4B3A19" },
  payment: { backgroundColor: "#C2B5D4", textColor: "#35253F" },
  completed: { backgroundColor: "#AFCEBD", textColor: "#193D2F" },
  attention: { backgroundColor: "#D9B5B8", textColor: "#512029" },
} as const satisfies Record<AllFilter, FilterColors>;

type RequestsScreenProps = {
  profile: HotelProfile;
  demo: boolean;
  reloadVersion: number;
  onOpenProfile: () => void;
  onOpenInventory: () => void;
  onOpenConnections: () => void;
  onOpenSiteIntegration: () => void;
  onOpenRequest: (id: string) => void;
  onOpenClient: (id: string) => void;
};

export function RequestsScreen({ profile, demo, reloadVersion, onOpenProfile, onOpenInventory, onOpenConnections, onOpenSiteIntegration, onOpenRequest, onOpenClient }: RequestsScreenProps) {
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
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<DashboardQuery["sort"]>("desc");
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const requestSequence = useRef(0);
  const listRef = useRef<FlatList<HotelRequest>>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);

  const scope: DashboardQuery["scope"] = viewMode === "actions" ? "actions" : "today";
  const status = viewMode === "actions" ? actionFilter : allFilter;
  const search = viewMode === "all" ? debouncedSearch : "";
  const load = useCallback(async (refresh = false) => {
    const sequence = ++requestSequence.current;
    setListLoading(!refresh);
    setRefreshing(refresh);
    setError(null);
    try {
      const nextDashboard = await apiClient.getDashboard({ demo, scope, status, search, sort, page, limit: DASHBOARD_PAGE_SIZE });
      if (sequence === requestSequence.current) setDashboard(nextDashboard);
    } catch {
      if (sequence === requestSequence.current) setError("Could not load requests. Check your connection and try again.");
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setListLoading(false);
        setRefreshing(false);
      }
    }
  }, [demo, scope, status, search, sort, page]);
  const latestLoad = useRef(load);
  latestLoad.current = load;

  useEffect(() => {
    const deadline = Date.parse(dashboard?.nextProcessingDeadlineAt ?? "");
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => { void latestLoad.current(true); }, Math.max(250, deadline - Date.now() + 50));
    return () => clearTimeout(timer);
  }, [dashboard?.nextProcessingDeadlineAt]);

  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    void load();
    return () => { requestSequence.current++; };
  }, [load, reloadVersion]);
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(searchQuery.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let cancelled = false;
    const inventory = demo
      ? Promise.resolve({ roomCount: 2, hasRates: true })
      : apiClient.listRooms()
          .then(async (rooms) => {
            const rates = await Promise.all(rooms.map((room) => apiClient.listRates(room.id).catch(() => [])));
            return { roomCount: rooms.length, hasRates: rates.some((roomRates) => roomRates.some((rate) => rate.active)) };
          })
          .catch(() => ({ roomCount: 0, hasRates: false }));
    void Promise.all([
      demo ? Promise.resolve([]) : apiClient.getConnections().catch(() => []),
      inventory,
    ]).then(([nextConnections, nextInventory]) => {
      if (cancelled) return;
      setConnections(nextConnections);
      setRoomCount(nextInventory.roomCount);
      setHasRates(nextInventory.hasRates);
    });
    return () => { cancelled = true; };
  }, [demo, reloadVersion]);

  const connectionIssues = useMemo(
    () => connections.filter((connection) => connection.configured && connection.state !== "connected"),
    [connections, getLanguage()],
  );
  const actionableCount = (dashboard?.newCount ?? 0) + (dashboard?.paymentPendingCount ?? 0) + (dashboard?.attentionCount ?? 0);
  const visibleRequests = listLoading || error ? [] : dashboard?.requests ?? [];

  const markPaymentLinkSent = async (request: HotelRequest) => {
    setBusyRequestId(request.id);
    setActionError(null);
    try {
      await apiClient.markPaymentLinkSent(request.id, { demo });
      await latestLoad.current(true);
    } catch {
      setActionError("Could not mark the payment link as sent. Try again.");
    } finally {
      setBusyRequestId(null);
    }
  };

  const createForm = creating ? <ManualRequestModal demo={demo} onClose={() => setCreating(false)} onCreated={(result) => {
    setCreating(false);
    setViewMode("all");
    setAllFilter("all");
    setSearchQuery(`#${result.reservationNumber}`);
    setDebouncedSearch(`#${result.reservationNumber}`);
    setPage(1);
    setCreatedMessage(demo ? t("Request #{{v0}} added to this demo. No messages were sent.", { v0: result.reservationNumber })
      : result.deliveriesScheduled > 0 ? t("Request #{{v0}} created. The offer is queued for delivery.", { v0: result.reservationNumber })
      : t("Request #{{v0}} saved for review. No guest message was sent.", { v0: result.reservationNumber }));
  }} /> : null;

  if (loading) return <View style={[uiStyles.screen, styles.loading]} accessibilityLabel={t("Loading requests")}><ActivityIndicator color={theme.colors.action} size="large" /><Text style={styles.loadingText}>{t("Loading requests…")}</Text></View>;
  if (!dashboard) return <View style={[uiStyles.screen, styles.errorState]}><EmptyState title={t("Requests unavailable")} description={error ?? t("Try loading again.")} /><Button onPress={() => void load()}>{t("Try again")}</Button></View>;

  const setupComplete = Boolean(profile.name && profile.city && profile.countryCode)
    && roomCount > 0
    && hasRates
    && connections.some((connection) => connection.kind === "mail" && connection.state === "connected")
    && connections.some((connection) => connection.kind === "waha" && connection.state === "connected")
    && profile.allowedOrigins.length > 0;

  if (!demo && !dashboard.hasRequests && !setupComplete) {
    return <><SetupPath
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
      onCreateRequest={() => setCreating(true)}
    />{createForm}</>;
  }

  return <><FlatList
    ref={listRef}
    style={uiStyles.screen}
    contentContainerStyle={styles.content}
    data={visibleRequests}
    keyExtractor={(item) => item.id}
    renderItem={({ item }) => <RequestCard request={item} onOpen={() => onOpenRequest(item.id)} onOpenClient={onOpenClient}>
      {viewMode === "actions" && item.status === "payment" ? <PaymentLinkSentAction busy={busyRequestId === item.id} onPress={() => void markPaymentLinkSent(item)} /> : null}
    </RequestCard>}
    ItemSeparatorComponent={() => <View style={{ height: theme.spacing[3] }} />}
    ListHeaderComponent={<>
      <DashboardHeader
        hotelName={profile.name}
        dashboard={dashboard}
        connectionIssues={connectionIssues}
        actionableCount={actionableCount}
        viewMode={viewMode}
        setViewMode={(value) => { setViewMode(value); setPage(1); }}
        actionFilter={actionFilter}
        setActionFilter={(value) => { setActionFilter(value); setPage(1); }}
        allFilter={allFilter}
        setAllFilter={(value) => { setAllFilter(value); setPage(1); }}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sort={sort}
        setSort={(value) => { setSort(value); setPage(1); }}
        onCreateRequest={() => setCreating(true)}
      />
      {createdMessage ? <View style={styles.requestAlert}><InlineState tone="success">{createdMessage}</InlineState></View> : null}
      {actionError ? <View style={styles.requestAlert}><InlineState tone="danger">{actionError}</InlineState></View> : null}
    </>}
    ListEmptyComponent={listLoading ? <View style={styles.listState}><ActivityIndicator accessibilityLabel={t("Loading requests")} color={theme.colors.action} /></View>
      : error ? <View style={styles.listState}><InlineState tone="danger">{translateLabel(error)}</InlineState><Button variant="secondary" onPress={() => void load()}>{t("Try again")}</Button></View>
      : viewMode === "actions" ? <ActionEmptyState filter={actionFilter} /> : <EmptyState title={t("No matching requests")} description={t("Try another filter or search.")} />}
    ListFooterComponent={!error ? <RequestPagination shownCount={visibleRequests.length} total={dashboard.pagination.total} page={dashboard.pagination.page} limit={dashboard.pagination.limit} loading={listLoading} onPage={setPage} /> : undefined}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.action} />}
    initialNumToRender={14}
    maxToRenderPerBatch={20}
    windowSize={8}
    removeClippedSubviews
    showsVerticalScrollIndicator={false}
  />{createForm}</>;
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
  onCreateRequest: () => void;
}) {
  const { profile, connections, roomCount, hasRates, refreshing, onRefresh, onOpenProfile, onOpenInventory, onOpenConnections, onOpenSiteIntegration, onCreateRequest } = props;
  const mailConnected = connections.some((connection) => connection.kind === "mail" && connection.state === "connected");
  const whatsappConnected = connections.some((connection) => connection.kind === "waha" && connection.state === "connected");
  const steps = [
    { title: t("Hotel profile"), detail: t("Name, location and photos"), complete: Boolean(profile.name && profile.city && profile.countryCode), icon: Building2, onPress: onOpenProfile },
    { title: t("Rooms & rates"), detail: roomCount ? t("Add prices for your rooms") : t("Add your first room and its prices"), complete: roomCount > 0 && hasRates, icon: BedDouble, onPress: onOpenInventory },
    { title: t("Mail"), detail: t("Send offers from your hotel address"), complete: mailConnected, icon: Mail, onPress: onOpenConnections },
    { title: "WhatsApp", detail: t("Send offers from your hotel number"), complete: whatsappConnected, icon: MessageCircle, onPress: onOpenConnections },
    { title: t("Website form"), detail: t("Receive enquiries from your website"), complete: profile.allowedOrigins.length > 0, icon: Code2, onPress: onOpenSiteIntegration },
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
        <View style={{ flex: 1 }}><Text style={styles.greeting}>{t("Welcome to")}</Text><Text style={styles.hotelName} numberOfLines={1}>{profile.name}</Text></View>
      </View>
      <View style={styles.createAction}><NewRequestButton onPress={onCreateRequest} /><Text style={styles.createHint}>{t("Add an enquiry from any channel at any time.")}</Text></View>
      <View style={styles.setupIntro}>
        <Text style={styles.setupTitle}>{completed === steps.length ? t("Ready for your first request") : t("Set up your hotel")}</Text>
        <Text style={styles.setupSubtitle}>{completed === steps.length ? t("Your form and sending channels are ready.") : t("Complete these steps to receive and send offers automatically.")}</Text>
        <View style={styles.setupProgressRow}><Text style={styles.setupProgressLabel}>{completed} {" "}{t("of")}{" "}{steps.length}</Text><Text style={styles.setupProgressPercent}>{progress}</Text></View>
        <View style={styles.setupProgressTrack}><View style={[styles.setupProgressFill, { width: progress }]} /></View>
      </View>
    </>}
    renderItem={({ item, index }) => <SetupStep index={index + 1} {...item} />}
    ItemSeparatorComponent={() => <View style={styles.setupSeparator} />}
    ListFooterComponent={<Text style={styles.setupFooter}>{completed === steps.length ? t("New website enquiries will appear here automatically.") : t("Tap the next unfinished step to continue.")}</Text>}
    showsVerticalScrollIndicator={false}
  />;
}

function SetupStep({ index, title, detail, complete, icon: Icon, onPress }: { index: number; title: string; detail: string; complete: boolean; icon: typeof Building2; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${index}. ${title}. ${complete ? t("Completed") : t(detail)}`} onPress={onPress} style={({ pressed }) => [styles.setupStep, pressed && styles.pressed]}>
    <View style={[styles.setupStepNumber, complete && styles.setupStepNumberComplete]}>{complete ? <Check size={18} color={theme.colors.onAction} strokeWidth={3} /> : <Text style={styles.setupStepNumberText}>{index}</Text>}</View>
    <View style={styles.setupStepIcon}><Icon size={20} color={complete ? theme.colors.success : theme.colors.action} /></View>
    <View style={styles.setupStepCopy}><Text style={styles.setupStepTitle}>{translateLabel(title)}</Text><Text style={styles.setupStepDetail}>{complete ? t("Completed") : t(detail)}</Text></View>
    <ChevronRight size={20} color={theme.colors.textMuted} />
  </Pressable>;
}

function DashboardHeader(props: {
  hotelName: string; dashboard: DashboardSnapshot; connectionIssues: ConnectionStatus[];
  actionableCount: number; viewMode: ViewMode; setViewMode: (mode: ViewMode) => void;
  actionFilter: ActionFilter; setActionFilter: (filter: ActionFilter) => void;
  allFilter: AllFilter; setAllFilter: (filter: AllFilter) => void;
  searchQuery: string; setSearchQuery: (value: string) => void;
  sort: DashboardQuery["sort"]; setSort: (value: DashboardQuery["sort"]) => void;
  onCreateRequest: () => void;
}) {
  const { hotelName, dashboard, connectionIssues, actionableCount, viewMode, setViewMode, actionFilter, setActionFilter, allFilter, setAllFilter, searchQuery, setSearchQuery, sort, setSort, onCreateRequest } = props;
  const connectionNames = connectionIssues.map((connection) => connection.kind === "mail" ? t("Mail") : "WhatsApp");

  return <View>
    <View style={styles.header}>
      <View style={styles.hotelAvatar}><Text style={styles.hotelAvatarText}>{hotelName.slice(0, 1).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.greeting}>{t("Today at")}</Text><Text style={styles.hotelName} numberOfLines={1}>{hotelName}</Text></View>
      <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveLabel}>{t("LIVE")}</Text></View>
    </View>
    <View style={styles.createAction}><NewRequestButton onPress={onCreateRequest} /></View>
    <View style={styles.modeSwitch}>
      <ModeButton selected={viewMode === "actions"} label={t("To do")} count={actionableCount} onPress={() => setViewMode("actions")} />
      <ModeButton selected={viewMode === "all"} label={t("All incoming")} count={dashboard.totalCount} onPress={() => setViewMode("all")} />
    </View>

    {viewMode === "actions" ? <>
      <View style={styles.actionMetrics}>
        <ActionMetric selected={actionFilter === "new"} appearance={requestStatusAppearance.newRequest} icon={Inbox} count={dashboard.newCount} label={requestStatusLabels.new} onPress={() => setActionFilter("new")} />
        <ActionMetric selected={actionFilter === "payment"} appearance={requestStatusAppearance.confirmation} icon={CheckCircle2} count={dashboard.paymentPendingCount} label={requestStatusLabels.payment} onPress={() => setActionFilter("payment")} />
        <ActionMetric selected={actionFilter === "attention"} appearance={requestStatusAppearance.deliveryFailed} icon={AlertTriangle} count={dashboard.attentionCount} label={t("Not delivered")} onPress={() => setActionFilter("attention")} />
      </View>
      {connectionNames.length > 0 && actionFilter === "attention" ? <View style={styles.requestAlert}><InlineState tone="danger">{t("Reconnect")}{" "}{connectionNames.join(" and ")}.</InlineState></View> : null}
    </> : <>
      <View style={styles.titleBlock}><Text style={styles.pageTitle}>{t("All incoming")}</Text><Text style={styles.pageSubtitle}>{dashboard.totalCount} {" "}{t("requests received today.")}</Text></View>
      {searchQuery.trim() ? <Text style={styles.pageSubtitle}>{t("Searching requests from all dates.")}</Text> : null}
      <View style={styles.searchField}>
        <Search size={20} color={theme.colors.textMuted} />
        <TextInput accessibilityLabel={t("Search requests by reservation number, guest, room or board")} value={searchQuery} onChangeText={setSearchQuery} maxLength={160} placeholder={t("Search #number, guest, room or board")} placeholderTextColor={theme.colors.textMuted} style={styles.searchInput} returnKeyType="search" />
        {searchQuery ? <Pressable accessibilityRole="button" accessibilityLabel={t("Clear search")} onPress={() => setSearchQuery("")} style={styles.clearSearch}><X size={theme.controls.actionIconSize} color={theme.colors.textMuted} /></Pressable> : null}
      </View>
      <View style={styles.filters}>
        <FilterChip selected={allFilter === "all"} label={t("All")} description={t("All requests, regardless of their status.")} onPress={() => setAllFilter("all")} />
        <FilterChip appearance={filterAppearance.new} selected={allFilter === "new"} label={t("New")} description={requestStatusDescriptions.new} onPress={() => setAllFilter("new")} />
        <FilterChip appearance={filterAppearance.waiting} selected={allFilter === "waiting"} label={requestStatusLabels.waiting} description={t("The offer was sent. Waiting for the guest to reply or accept it.")} onPress={() => setAllFilter("waiting")} />
        <FilterChip appearance={filterAppearance.payment} selected={allFilter === "payment"} label={requestStatusLabels.payment} description={t("Action needed from us: the guest accepted the offer and needs a payment link.")} onPress={() => setAllFilter("payment")} />
        <FilterChip appearance={filterAppearance.completed} selected={allFilter === "completed"} label={requestStatusLabels.completed} description={t("Our work is done: the payment link was sent. Waiting for the client to proceed; payment is not confirmed here.")} onPress={() => setAllFilter("completed")} />
        <FilterChip appearance={filterAppearance.attention} selected={allFilter === "attention"} label={t("Not delivered")} description={requestStatusDescriptions.attention} onPress={() => setAllFilter("attention")} />
      </View>
    </>}
    <View style={styles.listHeading}>
      <Text style={styles.listTitle}>{t("Requests")}</Text>
      <View accessibilityLabel={t("Sort by time received")} style={styles.sortControls}>
        {(["asc", "desc"] as const).map((value) => {
          const Icon = value === "asc" ? ArrowUp : ArrowDown;
          const label = value === "asc" ? t("Oldest first") : t("Newest first");
          return <Pressable key={value} accessibilityRole="button" accessibilityLabel={t("Time received: {{v0}}", { v0: label.toLowerCase() })} accessibilityState={{ selected: sort === value }} onPress={() => setSort(value)} style={({ pressed }) => [styles.sortButton, sort === value && styles.sortSelected, pressed && styles.pressed]}>
            <Icon size={theme.controls.helperIconSize} color={sort === value ? theme.colors.action : theme.colors.textMuted} />
            <Text style={[styles.shownCount, sort === value && styles.sortSelectedText]}>{translateLabel(label)}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  </View>;
}

function RequestPagination({ shownCount, total, page, limit, loading, onPage }: { shownCount: number; total: number; page: number; limit: number; loading: boolean; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <View style={styles.pagination}>
    <Text accessibilityLiveRegion="polite" style={styles.shownCount}>{loading ? t("Loading…") : t("{{v0}} out of {{v1}}", { v0: shownCount, v1: total })}</Text>
    <View style={styles.paginationControls}>
      <View style={styles.paginationButton}><Button variant="secondary" disabled={loading || page <= 1} onPress={() => onPage(page - 1)}>{t("Previous")}</Button></View>
      <Text style={styles.shownCount}>{t("Page")}{" "}{page} {" "}{t("of")}{" "}{pages}</Text>
      <View style={styles.paginationButton}><Button variant="secondary" disabled={loading || page >= pages} onPress={() => onPage(page + 1)}>{t("Next")}</Button></View>
    </View>
  </View>;
}

function ModeButton({ selected, label, count, onPress }: { selected: boolean; label: string; count: number; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.modeButton, selected && styles.modeButtonSelected, pressed && styles.pressed]}>
    <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{translateLabel(label)}</Text>
    <View style={[styles.modeCount, selected && styles.modeCountSelected]}><Text style={[styles.modeCountText, selected && styles.modeCountTextSelected]}>{count}</Text></View>
  </Pressable>;
}

function ActionMetric({ selected, appearance, icon: Icon, count, label, onPress }: { selected: boolean; appearance: StatusColors; icon: typeof CheckCircle2; count: number; label: string; onPress: () => void }) {
  const { color, backgroundColor: tint } = appearance;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t(label)}: ${count}`} accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.actionMetric, selected && { borderColor: color, backgroundColor: tint }, pressed && styles.pressed]}>
    <View style={styles.metricTop}><Icon size={20} color={color} /><Text style={[styles.metricCount, { color }]}>{count}</Text></View>
    <Text style={styles.metricLabel}>{translateLabel(label)}</Text>
  </Pressable>;
}

function NewRequestButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={t("New request")} onPress={onPress} style={({ pressed }) => [styles.create, pressed && styles.pressed]}>
    <Plus size={theme.controls.actionIconSize} color={theme.colors.onAction} />
    <Text style={styles.createText}>{t("New request")}</Text>
  </Pressable>;
}

function ActionEmptyState({ filter }: { filter: ActionFilter }) {
  return <View style={styles.actionEmpty}><View style={styles.actionEmptyIcon}><CheckCircle2 size={26} color={theme.colors.success} /></View><Text style={styles.actionEmptyTitle}>{filter === "new" ? t("No new requests") : filter === "payment" ? t("Nothing to confirm") : t("No unresolved issues")}</Text><Text style={styles.actionEmptyText}>{t("You’re all caught up. New tasks will appear here automatically.")}</Text></View>;
}

function FilterChip({ selected, label, description, onPress, appearance = filterAppearance.all }: { selected: boolean; label: string; description: string; onPress: () => void; appearance?: FilterColors }) {
  return <Tooltip content={translateLabel(description)}>{({ triggerProps, toggle }) => <Pressable
    {...triggerProps}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    onLongPress={toggle}
    style={[styles.filter, { backgroundColor: appearance.backgroundColor, borderColor: selected ? appearance.textColor : "transparent" }]}
  >
    <Text style={[styles.filterText, { color: appearance.textColor }]}>{translateLabel(label)}</Text>
  </Pressable>}</Tooltip>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[8] },
  requestAlert: { marginBottom: theme.spacing[3] },
  createAction: { marginTop: theme.spacing[4], gap: theme.spacing[2] },
  create: { ...actionStyles.control, backgroundColor: theme.colors.action, alignSelf: "flex-end" },
  createText: { ...theme.typography.bodySmallMedium, color: theme.colors.onAction },
  createHint: { ...theme.typography.caption, color: theme.colors.textSecondary },
  setupContent: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[8] },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[3] }, loadingText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  errorState: { flex: 1, justifyContent: "center", padding: theme.spacing[5], gap: theme.spacing[3] },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingTop: theme.spacing[3] },
  hotelAvatar: { width: 40, height: 40, borderRadius: theme.radii.md, backgroundColor: theme.colors.action, alignItems: "center", justifyContent: "center" }, hotelAvatarText: { ...theme.typography.h4, color: theme.colors.onAction },
  greeting: { ...theme.typography.caption, color: theme.colors.textMuted }, hotelName: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  livePill: { minHeight: theme.controls.actionSize, flexDirection: "row", alignItems: "center", gap: theme.controls.actionGap, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing[3], backgroundColor: theme.colors.successTint }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.success }, liveLabel: { ...theme.typography.captionMedium, color: theme.colors.success },
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
  modeSwitch: { flexDirection: "row", gap: theme.controls.actionGap, marginTop: theme.spacing[5], padding: 4, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceMuted },
  modeButton: { flex: 1, minHeight: theme.controls.actionSize, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.controls.actionGap, borderRadius: theme.radii.md },
  modeButtonSelected: { backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  modeLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.textMuted }, modeLabelSelected: { color: theme.colors.text },
  modeCount: { minWidth: 25, height: 25, borderRadius: theme.radii.pill, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.border }, modeCountSelected: { backgroundColor: theme.colors.action }, modeCountText: { ...theme.typography.captionMedium, color: theme.colors.textSecondary }, modeCountTextSelected: { color: theme.colors.onAction },
  titleBlock: { marginTop: theme.spacing[6], marginBottom: theme.spacing[4], gap: 3 }, pageTitle: { ...theme.typography.h2, color: theme.colors.text }, pageSubtitle: { ...theme.typography.bodySmall, color: theme.colors.textMuted },
  actionMetrics: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3], marginTop: theme.spacing[5], marginBottom: theme.spacing[3] },
  actionMetric: { flex: 1, minWidth: 140, minHeight: 92, padding: theme.spacing[3], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing[2] }, metricCount: { ...theme.typography.h2 }, metricLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  listHeading: { marginTop: theme.spacing[5], marginBottom: theme.spacing[3], flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], alignItems: "center", justifyContent: "space-between" }, listTitle: { ...theme.typography.h3, color: theme.colors.text }, shownCount: { ...theme.typography.captionMedium, color: theme.colors.textMuted },
  sortControls: { flexDirection: "row", flexWrap: "wrap", gap: theme.controls.actionGap },
  sortButton: { ...actionStyles.control, gap: theme.controls.helperGap, paddingHorizontal: theme.spacing[2], borderRadius: theme.radii.md },
  sortSelected: { backgroundColor: theme.colors.actionTint }, sortSelectedText: { color: theme.colors.action },
  listState: { alignItems: "center", paddingVertical: theme.spacing[6], gap: theme.spacing[3] },
  pagination: { alignItems: "center", gap: theme.spacing[3], marginTop: theme.spacing[5] },
  paginationControls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  paginationButton: { width: 112 },
  searchField: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: theme.spacing[2], paddingHorizontal: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface }, searchInput: { flex: 1, ...theme.typography.bodySmall, color: theme.colors.text, paddingVertical: theme.spacing[2] }, clearSearch: { ...actionStyles.iconButton, borderRadius: theme.radii.pill, backgroundColor: theme.colors.surfaceMuted },
  filters: { flexDirection: "row", gap: theme.controls.actionGap, marginTop: theme.spacing[3], flexWrap: "wrap" }, filter: { minHeight: theme.controls.actionSize, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.pill, borderWidth: 1, paddingHorizontal: theme.spacing[3] }, filterText: { ...actionStyles.label }, pressed: { opacity: 0.7 },
  actionEmpty: { alignItems: "center", paddingVertical: theme.spacing[10], paddingHorizontal: theme.spacing[5] }, actionEmptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.successTint, marginBottom: theme.spacing[3] }, actionEmptyTitle: { ...theme.typography.h4, color: theme.colors.text, textAlign: "center" }, actionEmptyText: { ...theme.typography.bodySmall, color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[2] },
});
