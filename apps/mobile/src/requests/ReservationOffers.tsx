import { t, translateLabel, locale } from "../i18n";
import { formatOccupancy } from "./presentation";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react-native";
import { MAX_RESERVATION_OFFERS, reservationOfferInputSchema, type OfferEditorData, type OfferQuote, type ReservationOffer, type SendReservationOffersInput } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { apiClient } from "../api/client";
import type { HotelRequest, MealPlan } from "../api/types";
import { FilterDateField } from "../clients/FilterDateField";
import { StatusPill } from "../components/StatusPill";
import { SelectField } from "../components/SelectField";
import { ChildrenFields } from "./ChildrenFields";
import { Button, Field, InlineState } from "../components/ui";
import { actionStyles } from "../components/actionStyles";
import { OfferDetails } from "./OfferDetails";
import { extraChargeLabels, newOfferKey, offerMoney } from "./offer-format";
import { hasDuplicateOfferChoices, nextOfferAlternative } from "./offer-alternatives";

type Choice = SendReservationOffersInput["offers"][number];
type Draft = { key: string; roomId: string; planCode: string; planName: string; description: string; checkIn: string; checkOut: string; adults: string; childAges: string[]; mealPlan: MealPlan | ""; extraIds: string[]; discount: string; deposit: string; cancellationPolicy: string; note: string };
type Preview = { input: string; quote: OfferQuote | null; error: string | null; busy: boolean };
const offerStatusLabels = { available: "Active", expired: "Expired", accepted: "Accepted" } as const;

export function ReservationOffers({ request, demo, createSignal = 0, onSent }: { request: HotelRequest; demo: boolean; createSignal?: number; onSent: (request: HotelRequest) => void }) {
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sent, setSent] = useState(false);
  const offers = request.offers ?? [];
  const accepted = !!request.acceptedAt || request.status === "payment" || request.status === "completed";
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(interval); }, []);
  useEffect(() => { if (createSignal > 0 && !accepted) setMode(offers.length ? "edit" : "create"); }, [createSignal]);
  return <View style={styles.section}>
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{t("Offers ·")}{" "}{offers.length}/{MAX_RESERVATION_OFFERS}</Text><Button variant="create" disabled={accepted} onPress={() => { setSent(false); setMode(offers.length ? "edit" : "create"); }}>{offers.length ? t("Edit offers") : t("Create offer")}</Button></View>
    {request.note && request.attentionReason === "manual_review" ? <InlineState tone="warning">{t("Request note:")}{" "}{request.note} {" "}{t("Review it, then create and send the offer.")}</InlineState> : null}
    {offers.map((offer, index) => {
      const status = offer.status === "available" && Date.parse(offer.expiresAt) <= now ? "expired" : offer.status;
      return <View key={offer.id} style={styles.offer}>
        <View style={styles.heading}><Text style={styles.offerTitle}>{t("Offer")}{" "}{index + 1} · {offer.roomName}</Text><StatusPill label={t(offerStatusLabels[status])} tone={status === "accepted" ? "success" : status === "available" ? "action" : "neutral"} /></View>
        <OfferDetails offer={offer} compact />
      </View>;
    })}
    {sent ? <InlineState tone="success">{demo ? t("Offers saved in this demo. No messages were sent.") : t("Offers queued for request #{{v0}}.", { v0: request.reservationNumber })}</InlineState> : null}
    {mode ? <OfferEditor request={request} demo={demo} mode={mode} onClose={() => setMode(null)} onSent={(updated) => { onSent(updated); setSent(true); setMode(null); }} /> : null}
  </View>;
}

function OfferEditor({ request, demo, mode, onClose, onSent }: { request: HotelRequest; demo: boolean; mode: "create" | "edit"; onClose: () => void; onSent: (request: HotelRequest) => void }) {
  const [data, setData] = useState<OfferEditorData | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const submitting = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void apiClient.getOfferEditor(request.id, { demo }).then((editor) => {
      if (!active) return;
      setData(editor);
      const initial = (request.offers ?? []).map((offer) => makeDraft(request, editor, offer));
      if (!initial.length) initial.push(makeDraft(request, editor));
      setDrafts(initial); setExpanded(initial.at(-1)?.key ?? null);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("Could not prepare offers.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request.id, demo, mode, reload]);
  const onPreview = useCallback((key: string, value: Preview) => setPreviews((current) => ({ ...current, [key]: value })), []);
  const update = (key: string, patch: Partial<Draft>) => setDrafts((items) => items.map((item) => item.key === key ? { ...item, ...patch } : item));
  const close = () => { if (!submitting.current) onClose(); };
  const duplicateChoices = hasDuplicateOfferChoices(drafts);
  const ready = drafts.length > 0 && !duplicateChoices && drafts.every((draft) => {
    const preview = previews[draft.key];
    return !!preview?.quote && !preview.busy && preview.input === JSON.stringify(draftInput(draft));
  });
  const send = async () => {
    if (submitting.current || !ready) return;
    const input: SendReservationOffersInput = { baseOfferId: request.currentOfferId ?? null,
      offers: drafts.map((draft) => ({ ...draftInput(draft), quotedTotalCents: previews[draft.key]!.quote!.totalCents })) };
    const body = JSON.stringify(input);
    if (submission.current?.body !== body) submission.current = { body, key: newOfferKey() };
    submitting.current = true; setSaving(true); setError(null);
    try { onSent(await apiClient.sendReservationOffers(request.id, input, submission.current.key, { demo })); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not send offers. Try again."));
      setDrafts((items) => items.map((item) => ({ ...item, key: newOfferKey() })));
    } finally { submitting.current = false; setSaving(false); }
  };
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={styles.backdrop}><SafeAreaView style={styles.sheet}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}><View style={styles.grow}><Text accessibilityRole="header" style={styles.title}>{mode === "create" ? t("Create offer") : t("Edit offers")}</Text><Text style={styles.hint}>{t("Request #")}{request.reservationNumber} · {drafts.length}/{MAX_RESERVATION_OFFERS}</Text></View><Button variant="tertiary" icon={X} disabled={saving} onPress={close}>{t("Close")}</Button></View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.note}><Text style={styles.offerTitle}>{request.guestName}</Text><Text style={styles.hint}>{request.checkIn} — {request.checkOut} · {formatOccupancy(request)} · {request.mealPlan ?? t("Choose board")}</Text>{request.note ? <Text selectable numberOfLines={3} style={styles.body}>{t("Request note:")}{" "}{request.note}</Text> : null}</View>
        {request.currentOfferId ? <InlineState tone="warning">{t("Replaces link")}</InlineState> : null}
        {loading ? <ActivityIndicator color={theme.colors.action} /> : !data ? <Button onPress={() => setReload((value) => value + 1)}>{t("Try again")}</Button> : !data.rooms.length ? <InlineState tone="warning">{t("Add rooms and rates in Settings → Rooms & rates, then return to create an offer.")}</InlineState> : null}
        {data ? <View pointerEvents={saving ? "none" : "auto"} style={styles.section}>
          {drafts.map((draft, index) => <DraftOffer key={draft.key} draft={draft} index={index} request={request} demo={demo} data={data} expanded={expanded === draft.key} removable={drafts.length > 1} preview={previews[draft.key]} onExpand={() => setExpanded(expanded === draft.key ? null : draft.key)} onChange={(patch) => update(draft.key, patch)} onRemove={() => setDrafts((items) => items.filter((item) => item.key !== draft.key))} onPreview={onPreview} />)}
          <Button variant="secondary" icon={Plus} disabled={saving || !data.rooms.length || drafts.length >= MAX_RESERVATION_OFFERS || !nextOfferAlternative(data, drafts, request)} onPress={() => { if (saving || drafts.length >= MAX_RESERVATION_OFFERS || !nextOfferAlternative(data, drafts, request)) return; const next = makeDraft(request, data, undefined, drafts); setDrafts((items) => [...items, next]); setExpanded(next.key); }}>{t("Add offer")}</Button>
        </View> : null}
      </ScrollView>
      <View style={styles.footer}>{duplicateChoices ? <InlineState tone="danger">{t("Choose a different room, rate, board or stay dates for each offer.")}</InlineState> : null}{error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}{!request.email.recipient && !request.whatsapp.recipient ? <InlineState tone="warning">{t("This request needs an email or WhatsApp number before offers can be sent.")}</InlineState> : null}
        <Button loading={saving} disabled={loading || !ready || (!demo && !request.email.recipient && !request.whatsapp.recipient)} onPress={() => void send()}>{t("Send")}</Button>
      </View>
    </KeyboardAvoidingView></SafeAreaView></View>
  </Modal>;
}

function DraftOffer({ draft, index, request, demo, data, expanded, removable, preview, onExpand, onChange, onRemove, onPreview }: {
  draft: Draft; index: number; request: HotelRequest; demo: boolean; data: OfferEditorData; expanded: boolean; removable: boolean; preview: Preview | undefined;
  onExpand: () => void; onChange: (patch: Partial<Draft>) => void; onRemove: () => void; onPreview: (key: string, value: Preview) => void;
}) {
  const input = JSON.stringify(draftInput(draft));
  useEffect(() => {
    let active = true;
    onPreview(draft.key, { input, quote: null, error: null, busy: true });
    const timeout = setTimeout(() => {
      const parsed = reservationOfferInputSchema.safeParse(JSON.parse(input));
      if (!parsed.success) { onPreview(draft.key, { input, quote: null, error: t("Check the dates, guests and percentages before calculating."), busy: false }); return; }
      void apiClient.previewReservationOffer(request.id, parsed.data, { demo }).then((quote) => { if (active) onPreview(draft.key, { input, quote, error: null, busy: false }); })
        .catch((cause) => { if (active) onPreview(draft.key, { input, quote: null, error: cause instanceof Error ? cause.message : t("Could not calculate the rate."), busy: false }); });
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [input, request.id, demo, draft.key, onPreview]);
  const plans = data.plans.filter((plan) => plan.roomId === draft.roomId && plan.mealPlan === draft.mealPlan);
  const selectRoomOrBoard = (patch: Pick<Partial<Draft>, "roomId" | "mealPlan">) => {
    const plan = data.plans.find((plan) => plan.roomId === (patch.roomId ?? draft.roomId) && plan.mealPlan === (patch.mealPlan ?? draft.mealPlan));
    onChange({ ...patch, planCode: plan?.planCode ?? "", planName: plan?.planName ?? t("Stay offer") });
  };
  const roomName = data.rooms.find(({ id }) => id === draft.roomId)?.name ?? t("Choose room");
  return <View style={styles.offer}>
    <View style={styles.heading}><Pressable accessibilityRole="button" accessibilityLabel={t("{{v0}} offer {{v1}}", { v0: expanded ? "Collapse" : "Expand", v1: index + 1 })} accessibilityState={{ expanded }} onPress={onExpand} style={styles.draftSummary}>
      <View style={styles.grow}><Text style={styles.offerTitle}>{t("Offer")}{" "}{index + 1} · {roomName}</Text><Text style={styles.hint}>{draft.planName} · {draft.mealPlan}</Text></View><Text style={styles.offerTitle}>{preview?.quote ? offerMoney(preview.quote.totalCents, preview.quote.currency) : "Calculating…"}</Text>{expanded ? <ChevronUp size={18} color={theme.colors.textMuted} /> : <ChevronDown size={18} color={theme.colors.textMuted} />}
    </Pressable>{removable ? <Pressable accessibilityRole="button" accessibilityLabel={t("Remove offer")} onPress={onRemove} style={actionStyles.iconButton}><Trash2 size={18} color={theme.colors.danger} /></Pressable> : null}</View>
    {expanded ? <View style={styles.section}>
      <View style={styles.row}><View style={styles.grow}><FilterDateField label={t("Check-in")} value={draft.checkIn} onChange={(checkIn) => onChange({ checkIn })} /></View><View style={styles.grow}><FilterDateField label={t("Check-out")} value={draft.checkOut} onChange={(checkOut) => onChange({ checkOut })} /></View></View>
      <SelectField label={t("Adults")} value={draft.adults} options={Array.from({ length: 50 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onChange={(adults) => onChange({ adults })} />
      <ChildrenFields value={draft.childAges} onChange={(childAges) => onChange({ childAges })} />
      <Choices label={t("Board")} value={draft.mealPlan} options={[{ value: "", label: t("Choose board") }, { value: "BB", label: t("BB · Breakfast") }, { value: "HB", label: t("HB · Half board") }, { value: "FB", label: t("FB · Full board") }]} onChange={(mealPlan) => selectRoomOrBoard({ mealPlan: mealPlan as MealPlan | "" })} />
      <Choices label={t("Room")} value={draft.roomId} options={data.rooms.map((room) => ({ value: room.id, label: t("{{v0}} · up to {{v1}}", { v0: room.name, v1: room.maxGuests }) }))} onChange={(roomId) => selectRoomOrBoard({ roomId })} />
      <Choices label={t("Rate")} value={draft.planCode} options={plans.map((plan) => ({ value: plan.planCode, label: plan.planName }))} onChange={(planCode) => onChange({ planCode, planName: plans.find((plan) => plan.planCode === planCode)!.planName })} />
      {!plans.length ? <InlineState tone="warning">{t("No rate is configured for this room and board. Choose another combination or add rates in Settings.")}</InlineState> : null}
      <Field label={t("Name")} value={draft.planName} onChangeText={(planName) => onChange({ planName })} maxLength={160} />
      <Field label={t("Description")} value={draft.description} onChangeText={(description) => onChange({ description })} multiline maxLength={2000} />
      <Text accessibilityRole="header" style={styles.offerTitle}>{t("Extras")}</Text>
      {draft.extraIds.some((id) => !data.settings.extras.some((extra) => extra.id === id && extra.active)) ? <><InlineState tone="warning">{t("Some previously selected extras are no longer available.")}</InlineState><Button variant="secondary" onPress={() => onChange({ extraIds: draft.extraIds.filter((id) => data.settings.extras.some((extra) => extra.id === id && extra.active)) })}>{t("Remove extras")}</Button></> : null}
      {data.settings.extras.filter((extra) => extra.active).map((extra) => <View key={extra.id} style={styles.heading}><View style={styles.grow}><Text style={styles.body}>{extra.name} · {offerMoney(extra.unitPriceCents, request.currency)}</Text><Text style={styles.hint}>{translateLabel(extraChargeLabels[extra.chargeMode])}{extra.description ? ` · ${extra.description}` : ""}</Text></View><Switch accessibilityLabel={t("Offer {{v0}} extra: {{v1}}", { v0: index + 1, v1: extra.name })} value={draft.extraIds.includes(extra.id)} onValueChange={(selected) => onChange({ extraIds: selected ? [...draft.extraIds, extra.id] : draft.extraIds.filter((id) => id !== extra.id) })} trackColor={{ true: theme.colors.action }} /></View>)}
      <View style={styles.row}><View style={styles.grow}><Field label={t("Discount (%)")} value={draft.discount} keyboardType="decimal-pad" onChangeText={(discount) => onChange({ discount })} /></View><View style={styles.grow}><Field label={t("Deposit (%)")} value={draft.deposit} keyboardType="decimal-pad" onChangeText={(deposit) => onChange({ deposit })} /></View></View>
      <Field label={t("Cancellation")} value={draft.cancellationPolicy} onChangeText={(cancellationPolicy) => onChange({ cancellationPolicy })} placeholder={t("For example: Free cancellation until 7 days before arrival.")} multiline maxLength={4000} />
      <Field label={t("Guest note")} value={draft.note} onChangeText={(note) => onChange({ note })} multiline maxLength={2000} />
      <View style={styles.note}><Text style={styles.offerTitle}>{t("Calculated price")}</Text>{preview?.busy ? <ActivityIndicator color={theme.colors.action} /> : preview?.quote ? <OfferDetails offer={preview.quote} /> : null}</View>
    </View> : null}
    {preview?.error ? <InlineState tone="danger">{preview.error}</InlineState> : null}
  </View>;
}

function makeDraft(request: HotelRequest, data: OfferEditorData, offer?: ReservationOffer, existing?: Draft[]): Draft {
  const suggestion = existing
    ? nextOfferAlternative(data, existing, request)
    : data.suggestions.find((item) => item.roomName === request.roomLabel) ?? data.suggestions[0];
  const roomId = offer?.roomId ?? suggestion?.roomId ?? (existing ? "" : data.rooms[0]?.id ?? "");
  const mealPlan = offer?.mealPlan ?? suggestion?.mealPlan ?? request.mealPlan ?? "";
  const plans = data.plans.filter((plan) => plan.roomId === roomId && plan.mealPlan === mealPlan);
  const preferredPlanCode = offer?.planCode ?? suggestion?.planCode;
  const plan = plans.find((plan) => plan.planCode === preferredPlanCode) ?? plans[0];
  return { key: newOfferKey(), roomId, planCode: plan?.planCode ?? "", planName: offer?.planName ?? plan?.planName ?? t("Stay offer"), description: offer?.description ?? "",
    checkIn: offer?.checkIn ?? request.checkIn, checkOut: offer?.checkOut ?? request.checkOut, adults: String(offer?.occupancy?.adults ?? request.occupancy.adults), childAges: (offer?.occupancy?.childAges ?? request.occupancy.childAges).map(String), mealPlan,
    extraIds: offer?.extras?.map(({ id }) => id) ?? data.settings.extras.filter((extra) => extra.active && extra.defaultSelected).map(({ id }) => id),
    discount: String(offer?.discountPercent ?? 0), deposit: String(offer?.depositPercent ?? data.settings.defaultDepositPercent), cancellationPolicy: offer?.cancellationPolicy ?? data.settings.cancellationPolicy, note: offer?.note ?? "" };
}
function draftInput(draft: Draft): Choice {
  return { roomId: draft.roomId, ...(draft.planCode ? { planCode: draft.planCode } : {}), pricingMode: "automatic", planName: draft.planName,
    description: draft.description, checkIn: draft.checkIn, checkOut: draft.checkOut,
    occupancy: { adults: /^\d+$/.test(draft.adults.trim()) ? Number(draft.adults) : NaN, childAges: draft.childAges.map((age) => /^\d{1,2}$/.test(age.trim()) ? Number(age) : NaN) },
    ...(draft.mealPlan ? { mealPlan: draft.mealPlan } : {}), extraIds: draft.extraIds, discountPercent: draft.discount.trim() ? Number(draft.discount.replace(",", ".")) : 0,
    depositPercent: draft.deposit.trim() ? Number(draft.deposit.replace(",", ".")) : NaN, cancellationPolicy: draft.cancellationPolicy, note: draft.note };
}
function Choices({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <SelectField label={translateLabel(label)} value={value} options={options} onChange={onChange} />;
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[4] }, smallGap: { gap: theme.spacing[2] }, title: { ...theme.typography.h3, color: theme.colors.text, flexShrink: 1 },
  offer: { padding: theme.spacing[4], gap: theme.spacing[4], borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.spacing[3], flexWrap: "wrap" }, draftSummary: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }, grow: { flex: 1, minWidth: 0 }, row: { flexDirection: "row", gap: theme.spacing[3] },
  offerTitle: { ...theme.typography.bodyMedium, color: theme.colors.text, flexShrink: 1 }, body: { ...theme.typography.bodySmall, color: theme.colors.text }, hint: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  backdrop: { flex: 1, backgroundColor: "rgba(20, 30, 50, 0.35)", alignItems: "center", justifyContent: "center" }, sheet: { width: "100%", maxWidth: 760, maxHeight: "94%", backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: "hidden", flexShrink: 1 }, keyboard: { flexShrink: 1 },
  header: { padding: theme.controls.contentInset, borderBottomWidth: 1, borderColor: theme.colors.border, flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }, content: { padding: theme.controls.contentInset, gap: theme.spacing[4] }, footer: { padding: theme.spacing[4], gap: theme.spacing[2], borderTopWidth: 1, borderColor: theme.colors.border },
  note: { backgroundColor: theme.colors.surfaceMuted, padding: theme.spacing[3], borderRadius: theme.radii.md, gap: theme.spacing[2] }, choices: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] }, choice: { padding: theme.spacing[3], minHeight: theme.controls.minTarget, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md }, selected: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint },
});
