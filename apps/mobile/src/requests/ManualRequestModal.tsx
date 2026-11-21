import { Switch } from "../monitoring/controls";
import { monitoredAction } from "../monitoring/actions";
import { scopedApiClient } from "../api/client";
import { t, translateLabel, getLanguage, locale } from "../i18n";
import { validationMessage } from "@hotel/i18n";

import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/monitoring/Pressable";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClipboardPlus, Trash2, X } from "lucide-react-native";
import { DEFAULT_GUEST_LANGUAGE, manualInquiryInputSchema, type ManualRequestSource, type MealPlan } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { ApiError, apiClient } from "../api/client";
import type { ClientProfile, HotelRequest, ManualInquiryResult } from "../api/types";
import { ExistingClientPicker } from "../clients/ExistingClientPicker";
import { demoLinkRequestClient } from "../clients/demo";
import { actionStyles } from "../components/actionStyles";
import { EnquiryFields, enquiryInput, newEnquiryDraft } from "./EnquiryFields";
import { Button, Field, InlineState } from "../components/ui";
import { duplicateRequestDraft } from "./duplicate-request";
import { requestSourceOptions } from "./sources";

export function ManualRequestModal({ demo, initialRequest, onClose, onCreated }: {
  demo: boolean;
  initialRequest?: HotelRequest;
  onClose: () => void;
  onCreated: (result: ManualInquiryResult) => void;
}) {
  const [initial] = useState(() => initialRequest ? duplicateRequestDraft(initialRequest) : null);
  const [draft, setDraft] = useState(() => newEnquiryDraft(initial));
  const [receivedVia, setReceivedVia] = useState<ManualRequestSource>(initial?.receivedVia ?? "phone");
  const [offers, setOffers] = useState(() => initial?.offers?.map(({ totalCents: _oldPrice, ...choice }) => ({ ...choice, pricingMode: "automatic" as const })) ?? []);
  const [sendOffer, setSendOffer] = useState(initial?.sendOffer ?? true);
  const [guestMode, setGuestMode] = useState<"manual" | "existing">("manual");
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const needsReview = draft.rooms.length > 1 || draft.alternativeDates.length > 0;
  const close = () => { if (!submitting.current) onClose(); };
  const selectClient = (client: ClientProfile) => {
    setSelectedClient(client);
    const [firstName = "", ...lastName] = client.name.trim().split(/\s+/);
    setDraft((current) => ({ ...current, firstName, lastName: lastName.join(" "), email: client.email ?? "", phone: client.phone ?? "", language: client.locale || DEFAULT_GUEST_LANGUAGE }));
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== "client" && !key.startsWith("guest."))));
  };

  const submit = monitoredAction("action.ManualRequestModal.submit", "ManualRequestModal.submit", async (signalScope) => {
    const apiClient = scopedApiClient(signalScope);
    if (submitting.current) return;
    if (guestMode === "existing" && !selectedClient) {
      setErrors({ client: t("Choose a client.") });
      setError(null);
      return;
    }
    const input = enquiryInput(draft);
    const result = manualInquiryInputSchema.safeParse({
      ...input, guest: { ...input.guest, email: draft.email.trim(), phone: draft.phone.trim() },
      receivedVia, sendOffer: sendOffer && !needsReview,
      ...(offers.length ? { offers } : {}),
    });
    setError(null);
    if (!result.success) {
      const messages: Record<string, string> = {
        checkIn: t("Enter a valid check-in date."), checkOut: t("Enter a valid check-out date."),
        "occupancy.adults": t("Enter a whole number from 1 to 50."),
        "occupancy.childAges": t("Select an age for each child (up to 20 children)."),
        mealPlan: "Choose BB, HB or FB.", "guest.language": t("Select the guest’s language."),
      };
      setErrors(Object.fromEntries(result.error.issues.map((issue) => {
        const path = (["offers", "details"].includes(String(issue.path[0])) ? issue.path : issue.path.slice(0, 2)).join(".");
        if (issue.path[0] === "offers" && issue.path[2] === "totalCents") return [path, t("Enter a valid total price with up to two decimal places.")];
        return [path, issue.code === "custom" ? validationMessage(getLanguage(), issue) : messages[path] ?? validationMessage(getLanguage(), issue)];
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
      if (demo && guestMode === "existing" && selectedClient) demoLinkRequestClient(created.inquiryId, selectedClient.id);
      onCreated(created);
    } catch (cause) { signalScope.fail(cause);
      if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR" && Array.isArray(cause.details)) {
        setErrors(Object.fromEntries(cause.details.map((issue: { path: string; message: string }) => [/^(offers|details)\./.test(issue.path) ? issue.path : issue.path.split(".").slice(0, 2).join("."), issue.message])));
        setError(null);
      } else {
        setError(cause instanceof ApiError ? cause.message : t("Could not create the request. Please try again."));
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  });

  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={styles.backdrop}><SafeAreaView style={styles.sheet}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View style={styles.heading}><ClipboardPlus size={20} color={theme.colors.action} /><Text accessibilityRole="header" style={styles.title}>{t("New request")}</Text></View>
          <Pressable signalAction="ui.ManualRequestModal.close.press" signalPlacement="ManualRequestModal.close" accessibilityRole="button" accessibilityLabel={t("Close new request")} accessibilityState={{ disabled: saving }} disabled={saving} onPress={close} style={actionStyles.iconButton}><X size={20} color={theme.colors.textMuted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>{initialRequest ? t("Duplicating request #{{v0}}.", { v0: initialRequest.reservationNumber }) : t("New request")}</Text>
          <View pointerEvents={saving ? "none" : "auto"} style={styles.fields}>
            <Choices label={t("Received via")} value={receivedVia} onChange={setReceivedVia} options={requestSourceOptions.map((option) => ({ ...option, label: t(option.label) }))} />
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Guest details")}</Text>
            <Choices label={t("Guest")} value={guestMode} onChange={(value) => { setGuestMode(value); setErrors({}); if (value === "existing" && selectedClient) selectClient(selectedClient); }} options={[{ value: "manual", label: t("Enter details") }, { value: "existing", label: t("Choose existing client") }]} />
            {guestMode === "existing" ? <ExistingClientPicker demo={demo} selected={selectedClient} disabled={saving} onSelect={selectClient} error={errors.client} /> : null}
            <EnquiryFields value={draft} onChange={setDraft} errors={errors} disabled={saving} staff contactsVisible={guestMode === "manual" || !!selectedClient} noteHelper={t("Record offers, prices or arrangements discussed by phone. Use Prepare offers on the reservation to review and send up to six choices.")} />
            {offers.length ? <View style={styles.fields}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Copied offers")}</Text>
              {offers.map((offer, index) => <View key={index} style={styles.delivery}>
                <View style={styles.deliveryHeading}><Text style={[styles.label, styles.column]}>{initialRequest?.offers?.find(({ roomId }) => roomId === offer.roomId)?.roomName ?? t("Room")}</Text><Pressable signalAction="ui.ManualRequestModal.setOffers.press" signalPlacement="ManualRequestModal.setOffers" accessibilityRole="button" accessibilityLabel={t("Remove offer")} disabled={saving} onPress={() => setOffers((current) => current.filter((_, i) => i !== index))} style={actionStyles.iconButton}><Trash2 size={18} color={theme.colors.danger} /></Pressable></View>
                <Field label={t("Name")} value={offer.planName ?? t("Stay offer")} onChangeText={(planName) => setOffers((current) => current.map((item, i) => i === index ? { ...item, planName } : item))} error={errors[`offers.${index}.planName`]} maxLength={160} editable={!saving} />
                <Field label={t("Guest note")} value={offer.note} onChangeText={(note) => setOffers((current) => current.map((item, i) => i === index ? { ...item, note } : item))} error={errors[`offers.${index}.note`]} multiline maxLength={2_000} editable={!saving} />
                {errors[`offers.${index}.roomId`] ? <Text accessibilityRole="alert" style={styles.error}>{errors[`offers.${index}.roomId`]}</Text> : null}
              </View>)}
            </View> : null}
            <View style={styles.delivery}>
              <View style={styles.deliveryHeading}><Text style={styles.label}>{t("Send offer now")}</Text><Switch signalPlacement="ManualRequestModal" accessibilityLabel={t("Send offer now")} value={sendOffer && !needsReview} onValueChange={setSendOffer} disabled={saving || needsReview} trackColor={{ true: theme.colors.action }} /></View>
              <Text style={styles.hint}>{sendOffer && !needsReview ? t("Send by email and WhatsApp.") : t("Save only. Send later.")}</Text>
            </View>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          {demo ? <Text style={styles.hint}>{t("Demo mode: requests stay in this preview and no messages are sent.")}</Text> : null}
          {Object.keys(errors).length ? <Text accessibilityRole="alert" style={styles.error}>{manualRequestErrorSummary(errors)}</Text> : null}
          {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
          <View style={styles.row}><View style={styles.column}><Button signalAction="ui.ManualRequestModal.close.press" signalPlacement="ManualRequestModal.close" variant="tertiary" onPress={close} disabled={saving}>{t("Cancel")}</Button></View><View style={styles.column}><Button signalAction="ui.ManualRequestModal.submit.press" signalPlacement="ManualRequestModal.submit" onPress={() => void submit()} loading={saving}>{sendOffer && !needsReview ? t("Create & send offer") : t("Create request")}</Button></View></View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView></View>
  </Modal>;
}

function manualRequestErrorSummary(errors: Record<string, string>): string {
  const [key, message] = Object.entries(errors)[0] ?? [];
  if (!key || !message) return t("Check the highlighted fields.");
  const labels: Record<string, string> = {
    client: t("Guest"), "guest.name": t("Guest name"), "guest.email": t("Email"), "guest.phone": t("Phone / WhatsApp"), "guest.language": t("Guest language"),
    checkIn: t("Check-in"), checkOut: t("Check-out"), "occupancy.adults": t("Adults"), "occupancy.childAges": t("Child ages"), mealPlan: t("Board basis"), note: t("Notes"),
  };
  return t("{{v0}}: {{v1}}", { v0: labels[key] ?? key, v1: translateLabel(message) as string });
}

function Choices<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return <View style={styles.choices}><Text style={styles.label}>{translateLabel(label)}</Text><View style={styles.choiceRow}>{options.map((option) => <Pressable signalAction="ui.Choices.onChange.press" signalPlacement="Choices.onChange" key={option.value} accessibilityRole="radio" accessibilityLabel={`${label}: ${option.label}`} accessibilityState={{ checked: value === option.value }} onPress={() => onChange(option.value)} style={[styles.choice, value === option.value && styles.choiceSelected]}><Text style={[styles.choiceText, value === option.value && styles.choiceTextSelected]}>{translateLabel(option.label)}</Text></Pressable>)}</View></View>;
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
