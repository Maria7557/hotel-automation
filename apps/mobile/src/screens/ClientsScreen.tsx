import { t, translateLabel, locale } from "../i18n";
import { DetailLink } from "@/components/DetailLink";
import { actionStyles } from "@/components/actionStyles";
import { RequestCard, ContactDetail, CopyValue } from "@/components/RequestCard";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Mail, Phone, Plus, Search, SlidersHorizontal, Users, X } from "lucide-react-native";
import { theme } from "@hotel/design";
import { DEFAULT_GUEST_LANGUAGE } from "@hotel/contracts";
import { apiClient } from "@/api/client";
import type { ClientFilterOptions, ClientFilters, ClientHistory, ClientInput, ClientPage, ClientProfile } from "@/api/types";
import { Button, EmptyState, Field, InlineState, uiStyles } from "@/components/ui";
import { demoClientHistory, demoCreateClient, demoListClients, demoGetClient, demoClientFilterOptions } from "../clients/demo";
import { ClientFiltersModal } from "../clients/ClientFiltersModal";
import { clientFilterSummary } from "../clients/filter-summary";

type NavigationProps = { onOpenRequest: (id: string) => void; onOpenClient: (id: string) => void };

export function ClientsScreen({ demo, onOpenClient, reloadVersion }: { demo: boolean; reloadVersion: number; onOpenClient: (id: string) => void }) {
  const [page, setPage] = useState<ClientPage>({ clients: [], nextCursor: null });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<ClientFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [options, setOptions] = useState<ClientFilterOptions>({ rooms: [], locales: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [reload, setReload] = useState(0);
  const [loadedQuery, setLoadedQuery] = useState("");
  const queryKey = JSON.stringify([demo, search, filters, reload, reloadVersion]);
  const currentQuery = useRef(queryKey);
  currentQuery.current = queryKey;
  const morePending = useRef(false);
  const filterSummary = clientFilterSummary(filters, options);
  const hasQuery = Boolean(search.trim() || filterSummary.length);
  const waiting = loading || loadedQuery !== queryKey;
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = setTimeout(() => {
      void (demo ? Promise.resolve(demoListClients(search, filters)) : apiClient.listClients(search, undefined, filters)).then((data) => {
        if (active && currentQuery.current === queryKey) setPage(data);
      }).catch(() => { if (active && currentQuery.current === queryKey) { setPage({ clients: [], nextCursor: null }); setError("Could not load clients. Please try again."); } })
        .finally(() => { if (active && currentQuery.current === queryKey) { setLoading(false); setLoadedQuery(queryKey); } });
    }, search ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [queryKey]);
  useEffect(() => {
    if (!filtersOpen) return;
    let active = true;
    setOptionsLoading(true); setOptionsError(false);
    void (demo ? Promise.resolve(demoClientFilterOptions()) : apiClient.getClientFilterOptions())
      .then((value) => { if (active) setOptions(value); })
      .catch(() => { if (active) setOptionsError(true); })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [filtersOpen, demo, optionsRetry]);
  const loadMore = async () => {
    if (!page.nextCursor || waiting || morePending.current) return;
    const query = queryKey;
    morePending.current = true;
    setMoreLoading(true); setError(null);
    try {
      const next = await apiClient.listClients(search, page.nextCursor, filters);
      if (query === currentQuery.current) setPage((old) => ({ clients: [...old.clients, ...next.clients.filter((c) => !old.clients.some((o) => o.id === c.id))], nextCursor: next.nextCursor }));
    } catch { if (query === currentQuery.current) setError("Could not load more clients. Please try again."); }
    finally { morePending.current = false; setMoreLoading(false); }
  };
  return <View style={uiStyles.screen}>
    <FlatList
      contentContainerStyle={styles.content}
      data={waiting ? [] : page.clients}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ClientCard client={item} onOpenClient={onOpenClient} />}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      refreshControl={<RefreshControl refreshing={waiting && page.clients.length > 0} onRefresh={() => setReload((v) => v + 1)} tintColor={theme.colors.action} />}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<>
        <View style={styles.heading}><View style={{ flex: 1 }}><Text style={styles.title}>{t("Clients")}</Text><Text style={styles.subtitle}>{t("Your contacts and their enquiries")}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Create client")} onPress={() => { setSuccess(null); setCreating(true); }} style={styles.create}><Plus size={theme.controls.actionIconSize} color={theme.colors.onAction} /><Text style={styles.createText}>{t("Add client")}</Text></Pressable>
        </View>
        <View style={styles.search}><Search size={theme.controls.actionIconSize} color={theme.colors.textMuted} /><TextInput accessibilityLabel={t("Search clients")} placeholder={t("Search name, email or phone")} placeholderTextColor={theme.colors.textMuted} value={search} onChangeText={setSearch} maxLength={160} style={styles.searchInput} />{search ? <Pressable accessibilityRole="button" accessibilityLabel={t("Clear client search")} onPress={() => setSearch("")} style={actionStyles.iconButton}><X size={theme.controls.actionIconSize} color={theme.colors.textMuted} /></Pressable> : null}</View>
        <View style={styles.filterToolbar}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Filter clients{{v0}}", { v0: filterSummary.length ? `, ${filterSummary.length} active` : "" })} onPress={() => setFiltersOpen(true)} style={[styles.filterButton, filterSummary.length > 0 && styles.filterButtonActive]}>
            <SlidersHorizontal size={18} color={theme.colors.action} /><Text style={styles.filterButtonText}>{t("Filters")}</Text>{filterSummary.length ? <View style={styles.filterCount}><Text style={styles.filterCountText}>{filterSummary.length}</Text></View> : null}
          </Pressable>
          {filterSummary.length ? <Pressable accessibilityRole="button" onPress={() => setFilters({})} accessibilityLabel={t("Clear all client filters")} style={actionStyles.control}><Text style={styles.clearText}>{t("Clear all")}</Text></Pressable> : null}
          <Text accessibilityLiveRegion="polite" style={styles.results}>{waiting ? t("Loading…") : `${page.clients.length}${page.nextCursor ? "+" : ""} ${page.clients.length === 1 && !page.nextCursor ? t("client") : t("clients")}${hasQuery ? t(" found") : ""}`}</Text>
        </View>
        {filterSummary.length ? <View style={styles.activeFilters}>{filterSummary.map((item) => <Pressable key={item.keys[0]} accessibilityRole="button" accessibilityLabel={t("Remove filter: {{v0}}", { v0: item.label })} onPress={() => setFilters((current) => { const next = { ...current }; for (const key of item.keys) delete next[key]; return next; })} style={styles.filterChip}><Text style={styles.filterChipText}>{translateLabel(item.label)}</Text><X size={14} color={theme.colors.action} /></Pressable>)}</View> : null}
        <Text style={styles.helper}>{t("Contacts from new requests appear automatically, usually within a minute.")}</Text>
        {success ? <View style={styles.feedback}><InlineState tone="success">{translateLabel(success)}</InlineState></View> : null}
        {error ? <View style={styles.feedback}><InlineState tone="danger">{translateLabel(error)}</InlineState><Button variant="tertiary" onPress={() => setReload((v) => v + 1)}>{t("Try again")}</Button></View> : null}
      </>}
      ListEmptyComponent={waiting ? <ActivityIndicator style={{ marginTop: 35 }} color={theme.colors.action} /> : error ? <View /> : <View style={{ gap: 8 }}><EmptyState title={hasQuery ? t("No matching clients") : t("Your contacts start here")} description={hasQuery ? t("Try a wider reservation period, adjust your filters, or change your search.") : t("Clients appear after their first enquiry. You can also add a contact yourself.")} />{hasQuery ? <Button variant="tertiary" onPress={() => { setFilters({}); setSearch(""); }}>{t("Clear search & filters")}</Button> : null}</View>}
      ListFooterComponent={page.nextCursor && !waiting ? <View style={{ marginTop: 16 }}><Button variant="secondary" loading={moreLoading} onPress={() => void loadMore()}>{t("Load more clients")}</Button></View> : undefined}
      initialNumToRender={12} maxToRenderPerBatch={15} windowSize={7}
    />
    {filtersOpen ? <ClientFiltersModal filters={filters} options={options} optionsLoading={optionsLoading} optionsError={optionsError} onRetryOptions={() => setOptionsRetry((value) => value + 1)} onClose={() => setFiltersOpen(false)} onApply={(value) => { setFilters(value); setFiltersOpen(false); }} /> : null}
    {creating ? <CreateClientModal demo={demo} onClose={() => setCreating(false)} onCreated={(created) => { setCreating(false); setSearch(""); setFilters({}); setSuccess(created ? t("Client added to contacts.") : t("This client is already in your contacts.")); setReload((v) => v + 1); }} /> : null}
  </View>;
}

function ClientCard({ client, onOpenClient }: { client: ClientProfile; onOpenClient: (id: string) => void }) {
  return <View style={styles.card}>
    <DetailLink kind="client" id={client.id} label={t("Open client {{v0}}", { v0: client.name })} onOpen={() => onOpenClient(client.id)} style={styles.cardHeader}>
      <View style={styles.clientIdentity}><View style={styles.avatar}><Users size={theme.controls.actionIconSize} color={theme.colors.action} /></View><View style={{ flex: 1 }}><Text style={styles.name}>{client.name}</Text><Text style={styles.meta}>{client.source === "manual" ? t("Added manually") : t("From enquiry")} · {client.requestCount} {client.requestCount === 1 ? t("enquiry") : t("enquiries")}</Text></View></View>
    </DetailLink>
    {client.email ? <View style={styles.contactLine}><Mail size={theme.controls.actionIconSize} color={theme.colors.textMuted} /><Text selectable style={styles.contactText}>{client.email}</Text></View> : null}
    {client.phone ? <View style={styles.contactLine}><Phone size={theme.controls.actionIconSize} color={theme.colors.textMuted} /><Text selectable style={styles.contactText}>{client.phone}</Text></View> : null}
    <DetailLink kind="client" id={client.id} label={t("View reservations for {{v0}}", { v0: client.name })} onOpen={() => onOpenClient(client.id)} style={styles.reservationLink}>
      <Text style={styles.reservationLinkText}>{t("View reservations")}</Text>
    </DetailLink>
  </View>;
}

function ClientHistoryPanel({ id, demo, onOpenRequest, onOpenClient }: { id: string; demo: boolean } & NavigationProps) {
  const [history, setHistory] = useState<ClientHistory | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void (demo ? Promise.resolve(demoClientHistory(id)) : apiClient.getClientHistory(id)).then((data) => { if (active) { setHistory(data); setError(false); } }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [id, demo, retry]);
  const more = async () => {
    if (!history?.nextCursor || busy) return;
    setBusy(true);
    try { const next = await apiClient.getClientHistory(id, history.nextCursor); setHistory((old) => ({ requests: [...old!.requests, ...next.requests], nextCursor: next.nextCursor })); setError(false); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <View style={{ gap: 8 }}><Text style={styles.historyTitle}>{t("Reservations")}</Text>
    {error ? <><Text style={styles.error}>{t("Could not load reservations.")}</Text><Button variant="tertiary" onPress={() => setRetry((v) => v + 1)}>{t("Retry reservations")}</Button></> : null}
    {!history && !error ? <ActivityIndicator color={theme.colors.action} /> : null}
    {history?.requests.map((request) => <RequestCard key={request.id} request={request} onOpen={() => onOpenRequest(request.id)} onOpenClient={onOpenClient} />)}
    {history && !history.requests.length ? <Text style={styles.meta}>{t("No reservations linked to this client yet.")}</Text> : null}
    {history?.nextCursor ? <Button variant="tertiary" loading={busy} onPress={() => void more()}>{t("More reservations")}</Button> : null}
  </View>;
}

export function ClientScreen({ id, demo, onBack, onOpenRequest, onOpenClient }: { id: string; demo: boolean; onBack: () => void } & NavigationProps) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    void (demo ? Promise.resolve().then(() => demoGetClient(id)) : apiClient.getClient(id))
      .then((value) => { if (active) setClient(value); })
      .catch(() => { if (active) setError("Could not load client. Please try again."); });
    return () => { active = false; };
  }, [id, demo, retry]);
  return <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
    <View style={styles.heading}><Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={onBack} style={styles.close}><ArrowLeft size={theme.controls.actionIconSize} color={theme.colors.text} /></Pressable><Text accessibilityRole="header" style={styles.title}>{t("Client")}</Text></View>
    {error ? <><InlineState tone="danger">{translateLabel(error)}</InlineState><Button onPress={() => setRetry((value) => value + 1)}>{t("Try again")}</Button></> : null}
    {!client && !error ? <ActivityIndicator color={theme.colors.action} /> : null}
    {client ? <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <CopyValue value={client.name} label={t("client name")} />
        {client.email ? <ContactDetail channel="email" detail={{ status: "unused", recipient: client.email }} showDeliveryStatus={false} /> : null}
        {client.phone ? <ContactDetail channel="whatsapp" detail={{ status: "unused", recipient: client.phone }} showDeliveryStatus={false} /> : null}
        <Text style={styles.meta}>{t("Language:")}{" "}{client.locale}</Text>
        <Text style={styles.meta}>{client.requestCount} {client.requestCount === 1 ? t("enquiry") : t("enquiries")}</Text>
        {client.notes ? <Text style={styles.contactText}>{client.notes}</Text> : null}
      </View>
      <ClientHistoryPanel id={client.id} demo={demo} onOpenRequest={onOpenRequest} onOpenClient={onOpenClient} />
    </View> : null}
  </ScrollView>;
}

function CreateClientModal({ demo, onClose, onCreated }: { demo: boolean; onClose: () => void; onCreated: (created: boolean) => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<string>(DEFAULT_GUEST_LANGUAGE); const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim() || (!email.trim() && !phone.trim())) { setError("Enter a name and at least one email or phone number."); return; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (phone.trim() && !/^\+[1-9]\d{6,14}$/.test(phone.trim().replace(/[\s().-]/g, "").replace(/^00/, "+"))) { setError("Include the phone country code, for example +39 333 1234567."); return; }
    const input: ClientInput = { name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, locale: language.trim() || DEFAULT_GUEST_LANGUAGE, notes: notes.trim() };
    setSaving(true); setError(null);
    try { const result = demo ? demoCreateClient(input) : await apiClient.createClient(input); onCreated(result.created); }
    catch (e) { setError(e instanceof Error ? e.message : t("Could not create client. Try again.")); }
    finally { setSaving(false); }
  };
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!saving) onClose(); }}>
    <SafeAreaView style={uiStyles.screen}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.modalHeading}><Text style={styles.modalTitle}>{t("Add client")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Close client form")} disabled={saving} onPress={onClose} style={styles.close}><X size={theme.controls.actionIconSize} color={theme.colors.text} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>{t("Add a contact without creating a reservation request.")}</Text>
        <Field accessibilityLabel={t("Client name")} label={t("Name")} value={name} onChangeText={setName} maxLength={160} editable={!saving} autoCapitalize="words" />
        <Field accessibilityLabel={t("Client email")} label={t("Email")} value={email} onChangeText={setEmail} maxLength={320} keyboardType="email-address" autoCapitalize="none" editable={!saving} />
        <Field accessibilityLabel={t("Client phone")} label={t("Phone")} value={phone} onChangeText={setPhone} maxLength={50} keyboardType="phone-pad" placeholder="+39 333 1234567" editable={!saving} />
        <Text style={styles.meta}>{t("Provide at least one contact method.")}</Text>
        <Field accessibilityLabel={t("Client language")} label={t("Language")} value={language} onChangeText={setLanguage} maxLength={16} autoCapitalize="none" editable={!saving} placeholder={DEFAULT_GUEST_LANGUAGE} helper={t("Defaults to Italian (it).")} />
        <Field accessibilityLabel={t("Client notes")} label={t("Notes")} value={notes} onChangeText={setNotes} maxLength={2000} multiline numberOfLines={4} editable={!saving} style={{ minHeight: 100, textAlignVertical: "top" }} />
        {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
        <Button icon={Plus} loading={saving} onPress={() => void save()}>{t("Save client")}</Button>
        <Button variant="tertiary" disabled={saving} onPress={onClose}>{t("Cancel")}</Button>
      </ScrollView>
    </KeyboardAvoidingView></SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[8] },
  heading: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 24, marginBottom: 22 }, title: { ...theme.typography.h2, color: theme.colors.text }, subtitle: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, marginTop: 4 },
  create: { ...actionStyles.control, backgroundColor: theme.colors.action }, createText: { ...theme.typography.bodySmallMedium, color: theme.colors.onAction },
  search: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: theme.controls.actionGap, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface }, searchInput: { flex: 1, ...theme.typography.bodySmall, color: theme.colors.text, paddingVertical: 12 },
  filterToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }, filterButton: { ...actionStyles.control, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }, filterButtonActive: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint }, filterButtonText: { ...theme.typography.bodySmallMedium, color: theme.colors.action }, filterCount: { backgroundColor: theme.colors.action, borderRadius: theme.radii.pill, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }, filterCountText: { ...theme.typography.captionMedium, color: theme.colors.onAction }, clearText: { ...theme.typography.captionMedium, color: theme.colors.action }, results: { ...theme.typography.caption, color: theme.colors.textMuted, marginLeft: "auto" }, activeFilters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, filterChip: { minHeight: theme.controls.minTarget, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.colors.actionTint, paddingHorizontal: 12, borderRadius: theme.radii.pill, maxWidth: "100%" }, filterChipText: { ...theme.typography.captionMedium, color: theme.colors.action, flexShrink: 1 },
  reservationLink: { alignSelf: "flex-start", minHeight: theme.controls.actionSize, justifyContent: "center" }, reservationLinkText: { ...theme.typography.captionMedium, color: theme.colors.action, textDecorationLine: "underline" },
  helper: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 10, marginBottom: 20 }, feedback: { marginBottom: 16, gap: 4 },
  card: { ...uiStyles.card, gap: 8 }, cardHeader: { ...actionStyles.content, marginBottom: 4 }, avatar: { ...actionStyles.iconButton, backgroundColor: theme.colors.actionTint, borderRadius: theme.radii.pill }, name: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, meta: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 3 },
  clientIdentity: { ...actionStyles.associated, flex: 1 },
  contactLine: { ...actionStyles.associated, minHeight: theme.controls.actionSize }, contactText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, flexShrink: 1, minWidth: 0 }, details: { gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12, marginTop: 6 }, historyTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, historyRow: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surfaceMuted }, error: { ...theme.typography.caption, color: theme.colors.danger },
  modalHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.controls.contentInset, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }, modalTitle: { ...theme.typography.h3, color: theme.colors.text }, close: { ...actionStyles.iconButton }, form: { padding: theme.controls.contentInset, gap: 18, maxWidth: 640, width: "100%", alignSelf: "center" },
});
