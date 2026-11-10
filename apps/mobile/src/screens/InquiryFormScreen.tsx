import { t, translateLabel, getLanguage } from "../i18n";
import { validationMessage } from "@hotel/i18n";

import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowLeft, Send } from "lucide-react-native";
import { DEFAULT_GUEST_LANGUAGE, inquiryFormInputSchema, type MealPlan } from "@hotel/contracts";
import { theme } from "@hotel/design";
import { ApiError, apiClient } from "@/api/client";
import type { HotelProfile, ManualInquiryResult } from "@/api/types";
import { FilterDateField } from "@/clients/FilterDateField";
import { GuestLanguageField } from "@/components/GuestLanguageField";
import { MealPlanField } from "@/components/MealPlanField";
import { ChildrenFields } from "@/requests/ChildrenFields";
import { Button, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";

export function InquiryFormScreen({ profile, demo, onBack, onSubmitted, onOpenRequest }: {
  profile: HotelProfile;
  demo: boolean;
  onBack: () => void;
  onSubmitted: () => void;
  onOpenRequest: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState(DEFAULT_GUEST_LANGUAGE);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState("2");
  const [childAges, setChildAges] = useState<string[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<ManualInquiryResult | null>(null);
  const submitting = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const submit = async () => {
    if (submitting.current) return;
    setError(null);
    const parsed = inquiryFormInputSchema.safeParse({
      guest: { name, email: email.trim() || null, phone: phone.trim() || null, language },
      checkIn, checkOut,
      occupancy: {
        adults: /^\d+$/.test(adults.trim()) ? Number(adults) : NaN,
        childAges: childAges.map((age) => /^\d{1,2}$/.test(age) ? Number(age) : NaN),
      },
      mealPlan, note,
    });
    if (!parsed.success) {
      const messages: Record<string, string> = {
        checkIn: t("Enter a valid check-in date."), checkOut: t("Enter a valid check-out date."),
        "occupancy.adults": t("Enter a whole number of adults, at least 1."),
        "occupancy.childAges": t("Select an age for each child."),
        "guest.language": t("Select the guest’s language."),
        mealPlan: "Choose BB, HB or FB.",
      };
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => {
        const key = issue.path.slice(0, 2).join(".");
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
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR" && Array.isArray(cause.details)) {
        setErrors(Object.fromEntries(cause.details.map((issue: { path: string; message: string }) => [issue.path.split(".").slice(0, 2).join("."), issue.message])));
      }
      setError(cause instanceof ApiError ? cause.message : t("Could not send the request. Please try again."));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const reset = () => {
    setName(""); setEmail(""); setPhone(""); setLanguage(DEFAULT_GUEST_LANGUAGE);
    setCheckIn(""); setCheckOut(""); setAdults("2"); setChildAges([]); setMealPlan(null); setNote("");
    setErrors({}); setError(null); setCreated(null); submission.current = null;
  };

  return <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Back to settings")} disabled={saving} accessibilityState={{ disabled: saving }} onPress={onBack} style={styles.back}><ArrowLeft size={22} color={theme.colors.text} /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{t("Form")}</Text>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.form}>
        <View style={styles.intro}><Text accessibilityRole="header" style={uiStyles.h1}>{t("Request availability")}</Text><Text style={styles.subtitle}>{profile.name}</Text></View>
        {demo ? <InlineState tone="warning">{t("Demo mode: requests stay in this preview and no messages are sent.")}</InlineState> : null}
        {created ? <View style={styles.section}>
          <InlineState tone="success">{t("Request sent. Reservation #")}{created.reservationNumber}.{created.attentionReason === "manual_review" ? t(" Your message will be reviewed before an offer is sent.") : ""}</InlineState>
          <Button onPress={() => onOpenRequest(created.inquiryId)}>{t("View request")}</Button>
          <Button variant="secondary" onPress={reset}>{t("Send another request")}</Button>
        </View> : <>
          {Object.keys(errors).length ? <InlineState tone="danger">{t("Check the highlighted fields.")}</InlineState> : null}
          <View pointerEvents={saving ? "none" : "auto"} style={styles.fields}>
            <View style={styles.section}>
              <SectionTitle>{t("Guest details")}</SectionTitle>
              <Field label={t("Full name")} value={name} onChangeText={setName} error={errors["guest.name"]} maxLength={160} autoComplete="name" editable={!saving} />
              <Text style={styles.hint}>{t("Provide an email or WhatsApp number to receive your offer.")}</Text>
              <Field label={t("Email")} value={email} onChangeText={setEmail} error={errors["guest.email"]} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false} maxLength={320} editable={!saving} />
              <Field label={t("Phone / WhatsApp")} value={phone} onChangeText={setPhone} error={errors["guest.phone"]} keyboardType="phone-pad" autoComplete="tel" helper={t("Include the country code, e.g. +39.")} maxLength={50} editable={!saving} />
              <GuestLanguageField value={language} onChange={setLanguage} error={errors["guest.language"]} disabled={saving} />
            </View>
            <View style={styles.section}>
              <SectionTitle>{t("Stay details")}</SectionTitle>
              <View style={styles.row}>
                <View style={styles.column}><FilterDateField label={t("Check-in")} value={checkIn} onChange={setCheckIn} error={errors.checkIn} /></View>
                <View style={styles.column}><FilterDateField label={t("Check-out")} value={checkOut} onChange={setCheckOut} error={errors.checkOut} /></View>
              </View>
              <Field label={t("Adults")} value={adults} onChangeText={setAdults} error={errors["occupancy.adults"]} keyboardType="number-pad" editable={!saving} />
              <ChildrenFields value={childAges} onChange={setChildAges} error={errors["occupancy.childAges"]} disabled={saving} />
              <MealPlanField value={mealPlan} onChange={setMealPlan} error={errors.mealPlan} disabled={saving} />
              <Field label={t("Message (optional)")} value={note} onChangeText={setNote} error={errors.note} helper={t("An offer is sent automatically unless you leave a message. Messages are reviewed by the hotel first.")} multiline numberOfLines={4} style={styles.notes} maxLength={2_000} editable={!saving} />
            </View>
          </View>
          {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
          <Button icon={Send} onPress={() => void submit()} loading={saving}>{t("Request availability")}</Button>
        </>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
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
