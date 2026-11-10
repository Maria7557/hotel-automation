import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClipboardPlus, X } from "lucide-react-native";
import { manualInquiryInputSchema, type ManualRequestSource, type MealPlan } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { ApiError, apiClient } from "../api/client";
import type { HotelRequest, ManualInquiryResult } from "../api/types";
import { FilterDateField } from "../clients/FilterDateField";
import { actionStyles } from "../components/actionStyles";
import { Button, Field, InlineState } from "../components/ui";
import { duplicateRequestDraft } from "./duplicate-request";
import { priceCents } from "./offer-input";

export function ManualRequestModal({ locale, demo, initialRequest, onClose, onCreated }: {
  locale: string;
  demo: boolean;
  initialRequest?: HotelRequest;
  onClose: () => void;
  onCreated: (result: ManualInquiryResult) => void;
}) {
  const [initial] = useState(() => initialRequest ? duplicateRequestDraft(initialRequest, locale) : null);
  const [name, setName] = useState(initial?.guest.name ?? "");
  const [email, setEmail] = useState(initial?.guest.email ?? "");
  const [phone, setPhone] = useState(initial?.guest.phone ?? "");
  const [language, setLanguage] = useState(initial?.guest.language ?? locale);
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [adults, setAdults] = useState(String(initial?.occupancy.adults ?? 2));
  const [childAges, setChildAges] = useState(initial?.occupancy.childAges.join(", ") ?? "");
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(initial?.mealPlan ?? null);
  const [receivedVia, setReceivedVia] = useState<ManualRequestSource>(initial?.receivedVia ?? "phone");
  const [note, setNote] = useState(initial?.note ?? "");
  const [offers, setOffers] = useState(() => initial?.offers?.map(({ roomId, planName, totalCents, note }) => ({ roomId, planName, price: (totalCents / 100).toFixed(2), note })) ?? []);
  const [sendOffer, setSendOffer] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const close = () => { if (!submitting.current) onClose(); };

  const submit = async () => {
    if (submitting.current) return;
    const result = manualInquiryInputSchema.safeParse({
      guest: { name, email: email.trim() || null, phone: phone.trim() || null, language },
      checkIn, checkOut,
      occupancy: {
        adults: /^\d+$/.test(adults.trim()) ? Number(adults) : NaN,
        childAges: childAges.trim() ? childAges.split(",").map((age) => /^\d{1,2}$/.test(age.trim()) ? Number(age.trim()) : NaN) : [],
      },
      mealPlan, receivedVia, note, sendOffer,
      ...(offers.length ? { offers: offers.map(({ roomId, planName, price, note }) => ({ roomId, planName, totalCents: priceCents(price), note })) } : {}),
    });
    setError(null);
    if (!result.success) {
      const messages: Record<string, string> = {
        checkIn: "Enter a valid check-in date.", checkOut: "Enter a valid check-out date.",
        "occupancy.adults": "Enter a whole number from 1 to 50.",
        "occupancy.childAges": "Enter up to 20 ages from 0 to 17, separated by commas.",
        mealPlan: "Choose BB, HB or FB.", "guest.language": "Enter a language code, such as en-GB or it.",
      };
      setErrors(Object.fromEntries(result.error.issues.map((issue) => {
        const path = (issue.path[0] === "offers" ? issue.path : issue.path.slice(0, 2)).join(".");
        if (issue.path[0] === "offers" && issue.path[2] === "totalCents") return [path, "Enter a valid total price with up to two decimal places."];
        return [path, issue.code === "custom" ? issue.message : messages[path] ?? issue.message];
      })));
      return;
    }
    setErrors({});
    submitting.current = true;
    setSaving(true);
    const body = JSON.stringify(result.data);
    if (submission.current?.body !== body) {
      submission.current = { body, key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
    }
    try {
      const created = await apiClient.createManualRequest(result.data, submission.current.key, { demo });
      onCreated(created);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR" && Array.isArray(cause.details)) {
        setErrors(Object.fromEntries(cause.details.map((issue: { path: string; message: string }) => [issue.path.startsWith("offers") ? issue.path : issue.path.split(".").slice(0, 2).join("."), issue.message])));
      }
      setError(cause instanceof ApiError ? cause.message : "Could not create the request. Please try again.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={styles.backdrop}><SafeAreaView style={styles.sheet}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View style={styles.heading}><ClipboardPlus size={20} color={theme.colors.action} /><Text accessibilityRole="header" style={styles.title}>New request</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close new request" accessibilityState={{ disabled: saving }} disabled={saving} onPress={close} style={actionStyles.iconButton}><X size={20} color={theme.colors.textMuted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>{initialRequest ? `Duplicating reservation #${initialRequest.reservationNumber}. Review the copied details before creating a new request.` : "Record an enquiry from a call, a walk-in or another conversation."}</Text>
          <View pointerEvents={saving ? "none" : "auto"} style={styles.fields}>
            <Choices label="Received via" value={receivedVia} onChange={setReceivedVia} options={[{ value: "phone", label: "Phone call" }, { value: "walk_in", label: "Walk-in" }, { value: "other", label: "Other" }]} />
            <Text accessibilityRole="header" style={styles.sectionTitle}>Guest details</Text>
            <Field label="Guest name" value={name} onChangeText={setName} error={errors["guest.name"]} maxLength={160} autoComplete="name" editable={!saving} />
            <Field label="Email (optional)" value={email} onChangeText={setEmail} error={errors["guest.email"]} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={320} editable={!saving} />
            <Field label="Phone / WhatsApp (optional)" value={phone} onChangeText={setPhone} error={errors["guest.phone"]} keyboardType="phone-pad" helper="Include the country code, e.g. +39." maxLength={50} editable={!saving} />
            <Field label="Guest language" value={language} onChangeText={setLanguage} error={errors["guest.language"]} helper="Language code for the offer, e.g. en-GB or it." autoCapitalize="none" autoCorrect={false} maxLength={16} editable={!saving} />
            <Text accessibilityRole="header" style={styles.sectionTitle}>Stay details</Text>
            <View style={styles.row}>
              <View style={styles.column}><FilterDateField label="Check-in" value={checkIn} onChange={setCheckIn} error={errors.checkIn} /></View>
              <View style={styles.column}><FilterDateField label="Check-out" value={checkOut} onChange={setCheckOut} error={errors.checkOut} /></View>
            </View>
            <Field label="Adults" value={adults} onChangeText={setAdults} error={errors["occupancy.adults"]} keyboardType="number-pad" maxLength={2} editable={!saving} />
            <Field label="Children’s ages (optional)" value={childAges} onChangeText={setChildAges} error={errors["occupancy.childAges"]} helper="Separate ages with commas, e.g. 4, 9. Leave empty for no children." keyboardType="numbers-and-punctuation" maxLength={78} editable={!saving} />
            <Choices label="Board basis" value={mealPlan} onChange={setMealPlan} options={[{ value: "BB", label: "BB · Breakfast" }, { value: "HB", label: "HB · Half board" }, { value: "FB", label: "FB · Full board" }]} />
            {errors.mealPlan ? <Text accessibilityRole="alert" style={styles.error}>{errors.mealPlan}</Text> : null}
            <Field label="Notes (optional)" value={note} onChangeText={setNote} error={errors.note} helper="Record offers, prices or arrangements discussed by phone. Use Prepare offers on the reservation to review and send up to six choices." multiline numberOfLines={3} style={styles.notes} maxLength={2_000} editable={!saving} />
            {offers.length ? <View style={styles.fields}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Copied offers</Text>
              <Text style={styles.hint}>Review room choices and prices, especially if you change dates, guests or board. Remove an offer to leave it out.</Text>
              {offers.map((offer, index) => <View key={index} style={styles.delivery}>
                <View style={styles.deliveryHeading}><Text style={[styles.label, styles.column]}>{initialRequest?.offers?.find(({ roomId }) => roomId === offer.roomId)?.roomName ?? "Room"}</Text><Button variant="tertiary" disabled={saving} onPress={() => setOffers((current) => current.filter((_, i) => i !== index))}>Remove offer {index + 1}</Button></View>
                <Field label={`Offer ${index + 1} name / terms`} value={offer.planName} onChangeText={(planName) => setOffers((current) => current.map((item, i) => i === index ? { ...item, planName } : item))} error={errors[`offers.${index}.planName`]} maxLength={160} editable={!saving} />
                <Field label={`Offer ${index + 1} total price (${initialRequest?.currency ?? "EUR"})`} value={offer.price} onChangeText={(price) => setOffers((current) => current.map((item, i) => i === index ? { ...item, price } : item))} error={errors[`offers.${index}.totalCents`]} keyboardType="decimal-pad" editable={!saving} />
                <Field label={`Offer ${index + 1} guest note (optional)`} value={offer.note} onChangeText={(note) => setOffers((current) => current.map((item, i) => i === index ? { ...item, note } : item))} error={errors[`offers.${index}.note`]} multiline maxLength={2_000} editable={!saving} />
                {errors[`offers.${index}.roomId`] ? <Text accessibilityRole="alert" style={styles.error}>{errors[`offers.${index}.roomId`]}</Text> : null}
              </View>)}
            </View> : null}
            <View style={styles.delivery}>
              <View style={styles.deliveryHeading}><Text style={styles.label}>Prepare & send offer</Text><Switch accessibilityLabel="Prepare and send offer" value={sendOffer} onValueChange={setSendOffer} disabled={saving} trackColor={{ true: theme.colors.action }} /></View>
              <Text style={styles.hint}>{sendOffer ? offers.length ? "The offers above will be queued for the guest’s email and/or WhatsApp." : "An offer will be calculated from your rates and queued for the guest’s email and/or WhatsApp. Requests without matching rates will need review." : "Save the request for staff review. You can leave contact details empty; no guest message will be sent."}</Text>
            </View>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          {demo ? <Text style={styles.hint}>Demo mode: requests stay in this preview and no messages are sent.</Text> : null}
          {Object.keys(errors).length ? <Text accessibilityRole="alert" style={styles.error}>Check the highlighted fields.</Text> : null}
          {error ? <InlineState tone="danger">{error}</InlineState> : null}
          <View style={styles.row}><View style={styles.column}><Button variant="tertiary" onPress={close} disabled={saving}>Cancel</Button></View><View style={styles.column}><Button onPress={() => void submit()} loading={saving}>{sendOffer ? "Create & send offer" : "Create request"}</Button></View></View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView></View>
  </Modal>;
}

function Choices<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return <View style={styles.choices}><Text style={styles.label}>{label}</Text><View style={styles.choiceRow}>{options.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`${label}: ${option.label}`} accessibilityState={{ checked: value === option.value }} onPress={() => onChange(option.value)} style={[styles.choice, value === option.value && styles.choiceSelected]}><Text style={[styles.choiceText, value === option.value && styles.choiceTextSelected]}>{option.label}</Text></Pressable>)}</View></View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(20, 30, 50, 0.35)", alignItems: "center", justifyContent: "center" },
  sheet: { width: "100%", maxWidth: 640, maxHeight: "94%", backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: "hidden", flexShrink: 1 },
  keyboard: { flexShrink: 1 },
  header: { paddingHorizontal: theme.controls.contentInset, paddingVertical: theme.spacing[3], flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: theme.colors.border },
  heading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }, title: { ...theme.typography.h3, color: theme.colors.text },
  content: { padding: theme.controls.contentInset, gap: theme.spacing[4] }, fields: { gap: theme.spacing[4] },
  hint: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  sectionTitle: { ...theme.typography.h4, color: theme.colors.text, marginTop: theme.spacing[2] },
  label: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  row: { flexDirection: "row", gap: theme.spacing[3] }, column: { flex: 1, minWidth: 0 },
  choices: { gap: theme.spacing[2] }, choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  choice: { minHeight: theme.controls.minTarget, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2], justifyContent: "center", borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md },
  choiceSelected: { backgroundColor: theme.colors.actionTint, borderColor: theme.colors.action },
  choiceText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary }, choiceTextSelected: { color: theme.colors.action },
  notes: { minHeight: 96, paddingTop: theme.spacing[3], textAlignVertical: "top" },
  delivery: { gap: theme.spacing[2], padding: theme.spacing[4], borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceMuted },
  deliveryHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[3] },
  footer: { padding: theme.spacing[4], gap: theme.spacing[3], borderTopWidth: 1, borderColor: theme.colors.border },
  error: { ...theme.typography.caption, color: theme.colors.danger },
});
