import { monitoredAction } from "../monitoring/actions";
import { scopedApiClient } from "../api/client";
import { t, translateLabel, getLanguage } from "../i18n";
import { validationMessage } from "@hotel/i18n";

import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/monitoring/Pressable";
import { ArrowLeft, Send } from "lucide-react-native";
import { inquiryFormInputSchema } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { ApiError, apiClient } from "@/api/client";
import type { HotelProfile, ManualInquiryResult } from "@/api/types";
import { EnquiryFields, enquiryInput, newEnquiryDraft } from "@/requests/EnquiryFields";
import { Button, InlineState, uiStyles } from "@/components/ui";

export function InquiryFormScreen({ profile, demo, onBack, onSubmitted, onOpenRequest }: {
  profile: HotelProfile;
  demo: boolean;
  onBack: () => void;
  onSubmitted: () => void;
  onOpenRequest: (id: string) => void;
}) {
  const [draft, setDraft] = useState(newEnquiryDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<ManualInquiryResult | null>(null);
  const submitting = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const submit = monitoredAction("action.InquiryFormScreen.submit", "InquiryFormScreen.submit", async (signalScope) => {
    const apiClient = scopedApiClient(signalScope);
    if (submitting.current) return;
    setError(null);
    const parsed = inquiryFormInputSchema.safeParse(enquiryInput(draft));
    if (!parsed.success) {
      const messages: Record<string, string> = {
        checkIn: t("Enter a valid check-in date."), checkOut: t("Enter a valid check-out date."),
        "occupancy.adults": t("Enter a whole number of adults, at least 1."),
        "occupancy.childAges": t("Select an age for each child."),
        "guest.language": t("Select the guest’s language."),
        mealPlan: "Choose BB, HB or FB.",
      };
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => {
        const key = (issue.path[0] === "details" ? issue.path : issue.path.slice(0, 2)).join(".");
        return [key, issue.code === "custom" ? validationMessage(getLanguage(), issue) : messages[key] ?? validationMessage(getLanguage(), issue)];
      })));
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setErrors({});
    submitting.current = true;
    setSaving(true);
    const body = JSON.stringify(parsed.data);
    if (submission.current?.body !== body) {
      submission.current = { body, key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
    }
    try {
      const result = await apiClient.createFormRequest(parsed.data, submission.current.key, { demo });
      setCreated(result);
      onSubmitted();
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (cause) { signalScope.fail(cause);
      if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR" && Array.isArray(cause.details)) {
        const nextErrors = Object.fromEntries(cause.details.map((issue: { path: string; message: string }) => [issue.path.startsWith("details.") ? issue.path : issue.path.split(".").slice(0, 2).join("."), issue.message]));
        setErrors(nextErrors);
        setError(null);
        scroll.current?.scrollTo({ y: 0, animated: true });
      } else {
        setError(cause instanceof ApiError ? cause.message : t("Could not send the request. Please try again."));
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  });

  const reset = () => {
    setDraft(newEnquiryDraft());
    setErrors({}); setError(null); setCreated(null); submission.current = null;
  };

  return <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={styles.header}>
      <Pressable signalAction="ui.InquiryFormScreen.onBack.press" signalPlacement="InquiryFormScreen.onBack" accessibilityRole="button" accessibilityLabel={t("Back to settings")} disabled={saving} accessibilityState={{ disabled: saving }} onPress={onBack} style={styles.back}><ArrowLeft size={22} color={theme.colors.text} /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{t("Form")}</Text>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.form}>
        <View style={styles.intro}><Text accessibilityRole="header" style={uiStyles.h1}>{t("Request availability")}</Text><Text style={styles.subtitle}>{profile.name}</Text></View>
        {demo ? <InlineState tone="warning">{t("Demo mode: requests stay in this preview and no messages are sent.")}</InlineState> : null}
        {created ? <View style={styles.section}>
          <InlineState tone="success">{t("Request sent. Reservation #")}{created.reservationNumber}.{created.attentionReason === "manual_review" ? t(" Your request will be reviewed before an offer is sent.") : ""}</InlineState>
          <Button signalAction="ui.InquiryFormScreen.onOpenRequest.press" signalPlacement="InquiryFormScreen.onOpenRequest" onPress={() => onOpenRequest(created.inquiryId)}>{t("View request")}</Button>
          <Button signalAction="ui.InquiryFormScreen.reset.press" signalPlacement="InquiryFormScreen.reset" variant="secondary" onPress={reset}>{t("Send another request")}</Button>
        </View> : <>
          {Object.keys(errors).length ? <InlineState tone="danger">{inquiryErrorSummary(errors)}</InlineState> : null}
          <View pointerEvents={saving ? "none" : "auto"} style={styles.fields}>
            <EnquiryFields value={draft} onChange={setDraft} errors={errors} disabled={saving} noteHelper={t("Single-room requests can receive an automatic offer. Messages, additional rooms and alternative dates are reviewed by the hotel first.")} />
          </View>
          {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
          <Button signalAction="ui.InquiryFormScreen.submit.press" signalPlacement="InquiryFormScreen.submit" icon={Send} onPress={() => void submit()} loading={saving}>{t("Request availability")}</Button>
        </>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function inquiryErrorSummary(errors: Record<string, string>): string {
  const [key, message] = Object.entries(errors)[0] ?? [];
  if (!key || !message) return t("Check the highlighted fields.");
  const labels: Record<string, string> = {
    "guest.name": t("Full name"), "guest.email": t("Email"), "guest.phone": t("Phone / WhatsApp"), "guest.language": t("Guest language"),
    checkIn: t("Check-in"), checkOut: t("Check-out"), "occupancy.adults": t("Adults"), "occupancy.childAges": t("Child ages"), mealPlan: t("Board basis"), note: t("Message"),
  };
  return t("{{v0}}: {{v1}}", { v0: labels[key] ?? key, v1: translateLabel(message) as string });
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingHorizontal: theme.controls.contentInset, paddingVertical: theme.spacing[3], borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  back: { width: theme.controls.minTarget, height: theme.controls.minTarget, alignItems: "center", justifyContent: "center" },
  title: { ...theme.typography.h3, color: theme.colors.text },
  content: { padding: theme.controls.contentInset, paddingBottom: theme.spacing[10] },
  form: { width: "100%", maxWidth: 680, alignSelf: "center", gap: theme.spacing[5] },
  intro: { gap: theme.spacing[2] }, subtitle: { ...theme.typography.body, color: theme.colors.textSecondary },
  fields: { gap: theme.spacing[6] }, section: { gap: theme.spacing[4] },
  hint: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  row: { flexDirection: "row", gap: theme.spacing[3] }, column: { flex: 1, minWidth: 0 },
  notes: { minHeight: 112, paddingTop: theme.spacing[3], textAlignVertical: "top" },
});
