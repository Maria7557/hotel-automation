import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MAX_RESERVATION_OFFERS, sendReservationOffersSchema, type ReservationOfferStatus } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { apiClient } from "../api/client";
import type { HotelRequest, Room } from "../api/types";
import { StatusPill } from "../components/StatusPill";
import { Button, Field, InlineState } from "../components/ui";
import { priceCents } from "./offer-input";

type Draft = { roomId: string; planName: string; price: string; note: string };
type OfferRoom = Pick<Room, "id" | "name">;

export function ReservationOffers({ request, demo, onSent }: { request: HotelRequest; demo: boolean; onSent: (request: HotelRequest) => void }) {
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);
  const offers = request.offers ?? [];
  const accepted = !!request.acceptedAt || request.status === "payment" || request.status === "completed";
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Offers · {offers.length}/{MAX_RESERVATION_OFFERS}</Text>
    <Text style={styles.hint}>All offers belong to reservation #{request.reservationNumber}. The guest can accept one.</Text>
    {offers.map((offer, index) => {
      const status: ReservationOfferStatus = offer.status === "available" && Date.parse(offer.expiresAt) <= now ? "expired" : offer.status;
      return <View key={offer.id} style={styles.offer}>
        <View style={styles.heading}><Text style={styles.offerTitle}>Offer {index + 1} · {offer.roomName}</Text><StatusPill label={status} tone={status === "accepted" ? "success" : status === "available" ? "action" : "neutral"} /></View>
        <Text style={styles.body}>{offer.planName} · {offer.mealPlan ?? "Board needed"}</Text>
        <Text selectable style={styles.price}>{new Intl.NumberFormat("en-GB", { style: "currency", currency: offer.currency }).format(offer.totalCents / 100)}</Text>
        {offer.note ? <Text selectable style={styles.body}>{offer.note}</Text> : null}
        <Text style={styles.hint}>{status === "accepted" ? "Accepted · all other offers have expired" : `Valid until ${new Date(offer.expiresAt).toLocaleString()}`}</Text>
      </View>;
    })}
    {!offers.length ? <Text style={styles.hint}>Prepare priced offers using the details agreed by phone or left in the request notes.</Text> : null}
    {sent ? <InlineState tone="success">{demo ? "Offers saved in this demo. No messages were sent." : "Offers queued for delivery. This reservation number stays the same."}</InlineState> : null}
    {!accepted ? <Button variant="secondary" disabled={!request.mealPlan} onPress={() => { setSent(false); setEditing(true); }}>{offers.length ? "Edit & send offers" : "Prepare offers"}</Button> : null}
    {editing ? <OfferEditor request={request} demo={demo} onClose={() => setEditing(false)} onSent={(updated) => { onSent(updated); setSent(true); setEditing(false); }} /> : null}
  </View>;
}

function OfferEditor({ request, demo, onClose, onSent }: { request: HotelRequest; demo: boolean; onClose: () => void; onSent: (request: HotelRequest) => void }) {
  const [rooms, setRooms] = useState<OfferRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>(() => request.offers?.map((offer) => ({ roomId: offer.roomId, planName: offer.planName, price: (offer.totalCents / 100).toFixed(2), note: offer.note })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const submitting = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const demoRooms: OfferRoom[] = request.offers?.length ? request.offers.map(({ roomId, roomName }) => ({ id: roomId, name: roomName }))
      : [{ id: "00000000-0000-4000-8000-000000000001", name: request.roomLabel === "No offer created" ? "Deluxe Room" : request.roomLabel }];
    void (demo ? Promise.resolve(demoRooms) : apiClient.listRooms()).then((all) => {
      if (!active) return;
      const available = all.filter((room) => !("active" in room) || room.active);
      setRooms(available);
      setDrafts((existing) => existing.length ? existing : available[0] ? [{ roomId: available[0].id, planName: "Personal offer", price: "", note: "" }] : []);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load rooms."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo, request.id, reload]);
  const update = (index: number, patch: Partial<Draft>) => setDrafts((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  const close = () => { if (!submitting.current) onClose(); };
  const send = async () => {
    if (submitting.current) return;
    const parsed = sendReservationOffersSchema.safeParse({ baseOfferId: request.currentOfferId ?? null, offers: drafts.map((draft) => ({
      roomId: draft.roomId, planName: draft.planName, note: draft.note, totalCents: priceCents(draft.price),
    })) });
    if (!parsed.success) { setError("Choose a room, enter an offer name and a valid total price for each of the 1–6 offers."); return; }
    const body = JSON.stringify(parsed.data);
    if (submission.current?.body !== body) submission.current = { body, key: newKey() };
    submitting.current = true; setSaving(true); setError(null);
    try { onSent(await apiClient.sendReservationOffers(request.id, parsed.data, submission.current.key, { demo })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send offers. Try again."); }
    finally { submitting.current = false; setSaving(false); }
  };
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={styles.backdrop}><SafeAreaView style={styles.sheet}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Offers for reservation #{request.reservationNumber}</Text></View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>{request.checkIn} — {request.checkOut} · {request.guestLabel} · {request.mealPlan}</Text>
          {request.note ? <View style={styles.note}><Text style={styles.offerTitle}>Request notes</Text><Text selectable style={styles.body}>{request.note}</Text></View> : null}
          <Text style={styles.hint}>Add up to six offers with the agreed total stay prices. All choices are sent together by email and/or WhatsApp and remain available for seven days.</Text>
          {request.currentOfferId ? <Text style={styles.hint}>Sending these changes expires the previous offers and sends a new link for this same reservation.</Text> : null}
          {loading ? <ActivityIndicator color={theme.colors.action} /> : !rooms.length ? <><InlineState tone="warning">Add an active room in Inventory before preparing offers.</InlineState><Button variant="tertiary" onPress={() => setReload((value) => value + 1)}>Reload rooms</Button></> : null}
          <View pointerEvents={saving ? "none" : "auto"} style={styles.section}>
            {drafts.map((draft, index) => <View key={index} style={styles.offer}>
              <View style={styles.heading}><Text style={styles.offerTitle}>Offer {index + 1}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Remove offer ${index + 1}`} disabled={saving} onPress={() => setDrafts((items) => items.filter((_, i) => i !== index))}><Text style={styles.link}>Remove</Text></Pressable></View>
              <Text style={styles.body}>Room</Text>
              <View style={styles.choices}>{rooms.map((room) => <Pressable key={room.id} accessibilityRole="radio" accessibilityLabel={`Offer ${index + 1}: ${room.name}`} accessibilityState={{ checked: draft.roomId === room.id }} onPress={() => update(index, { roomId: room.id })} style={[styles.choice, draft.roomId === room.id && styles.selected]}><Text style={styles.body}>{room.name}</Text></Pressable>)}</View>
              <Field label={`Offer ${index + 1} name / terms`} value={draft.planName} onChangeText={(planName) => update(index, { planName })} maxLength={160} editable={!saving} />
              <Field label={`Offer ${index + 1} total price (${request.currency})`} value={draft.price} onChangeText={(price) => update(index, { price })} keyboardType="decimal-pad" placeholder="0.00" helper="Total for the entire stay, including the requested board." editable={!saving} />
              <Field label={`Offer ${index + 1} guest note (optional)`} value={draft.note} onChangeText={(note) => update(index, { note })} multiline numberOfLines={3} maxLength={2_000} editable={!saving} />
            </View>)}
            <Button variant="tertiary" disabled={saving || loading || !rooms.length || drafts.length >= MAX_RESERVATION_OFFERS} onPress={() => setDrafts((items) => [...items, { roomId: rooms[0]!.id, planName: "Personal offer", price: "", note: "" }])}>Add offer · {drafts.length}/{MAX_RESERVATION_OFFERS}</Button>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          {error ? <InlineState tone="danger">{error}</InlineState> : null}
          {demo ? <Text style={styles.hint}>Demo mode · no messages will be sent.</Text> : null}
          <Button loading={saving} disabled={loading || !rooms.length || !drafts.length} onPress={() => void send()}>Send {drafts.length} {drafts.length === 1 ? "offer" : "offers"}</Button>
          <Button variant="tertiary" disabled={saving} onPress={close}>Cancel</Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView></View>
  </Modal>;
}

function newKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[4] }, title: { ...theme.typography.h3, color: theme.colors.text, flexShrink: 1 },
  offer: { padding: theme.spacing[4], gap: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.spacing[3] },
  offerTitle: { ...theme.typography.bodyMedium, color: theme.colors.text, flexShrink: 1 }, body: { ...theme.typography.bodySmall, color: theme.colors.text }, hint: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  price: { ...theme.typography.h3, color: theme.colors.text }, link: { ...theme.typography.bodySmallMedium, color: theme.colors.action, paddingVertical: theme.spacing[2] },
  backdrop: { flex: 1, backgroundColor: "rgba(20, 30, 50, 0.35)", alignItems: "center", justifyContent: "center" }, sheet: { width: "100%", maxWidth: 680, maxHeight: "94%", backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: "hidden", flexShrink: 1 }, keyboard: { flexShrink: 1 },
  header: { padding: theme.controls.contentInset, borderBottomWidth: 1, borderColor: theme.colors.border }, content: { padding: theme.controls.contentInset, gap: theme.spacing[4] }, footer: { padding: theme.spacing[4], gap: theme.spacing[2], borderTopWidth: 1, borderColor: theme.colors.border },
  note: { backgroundColor: theme.colors.surfaceMuted, padding: theme.spacing[3], borderRadius: theme.radii.md, gap: theme.spacing[2] }, choices: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] }, choice: { padding: theme.spacing[3], minHeight: theme.controls.minTarget, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md }, selected: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint },
});
