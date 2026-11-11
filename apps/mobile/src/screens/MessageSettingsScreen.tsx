import { t, translateLabel, getLanguage } from "../i18n";
import { SelectField } from "../components/SelectField";
import type { Language } from "@hotel/i18n";
import type { MessageTemplates } from "../api/types";

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, Building2, Check, ExternalLink, Eye, Mail, MessageCircle, Send, Variable } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import { renderDemoMessagePreview } from "@/api/demo-message-preview";
import type {
  MessageChannel,
  MessagePreview,
  MessageSettings,
  MessageSettingsInput,
  TestSendResult,
} from "@/api/types";
import { Button, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";

const demoSettings: MessageSettings = {
  emailSubjectTemplate: "La sua offerta da {{hotel_name}}",
  emailBodyTemplate: "Gentile {{guest_name}},\n\nLa sua offerta dal {{check_in}} al {{check_out}} è pronta.\nTotale: {{total}}\n\n{{offer_url}}",
  whatsappBodyTemplate: "Gentile {{guest_name}}, la sua offerta da {{hotel_name}} è pronta: {{offer_url}}",
  allowedVariables: ["guest_name", "hotel_name", "check_in", "check_out", "guest_count", "meal_plan", "total", "offer_url"],
};

type ActiveTemplate = "subject" | "email" | "whatsapp";

export function MessageSettingsScreen({ onBack, demo }: { onBack: () => void; demo: boolean }) {
  const [templateLanguage, setTemplateLanguage] = useState<Language>("it");
  const [variants, setVariants] = useState<Partial<Record<Language, MessageTemplates>>>({});
  const [settings, setSettings] = useState<MessageSettings | null>(null);
  const [saved, setSaved] = useState<MessageSettingsInput | null>(null);
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [whatsappBody, setWhatsappBody] = useState("");
  const [activeTemplate, setActiveTemplate] = useState<ActiveTemplate>("email");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const [previewing, setPreviewing] = useState<MessageChannel | null>(null);
  const [testChannel, setTestChannel] = useState<MessageChannel>("email");
  const [recipient, setRecipient] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestSendResult | null>(null);
  const [connectedWhatsappNumber, setConnectedWhatsappNumber] = useState<string | null>(null);

  const applySettings = (next: MessageSettings) => {
    setSettings(next);
    const all = { [next.templateLanguage ?? "it"]: messageTemplates(next), ...next.translations };
    setVariants(all);
    const selected = all[templateLanguage] ?? defaultTemplates(templateLanguage);
    setSubject(selected.emailSubjectTemplate);
    setEmailBody(selected.emailBodyTemplate);
    setWhatsappBody(selected.whatsappBodyTemplate);
    setSaved({ ...messageTemplates(selected), templateLanguage, translations: { ...all, [templateLanguage]: selected } });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (demo) {
        applySettings(demoSettings);
        setConnectedWhatsappNumber(null);
      } else {
        const [nextSettings, connections] = await Promise.all([
          apiClient.getMessageSettings(),
          apiClient.getConnections().catch(() => []),
        ]);
        applySettings(nextSettings);
        const whatsapp = connections.find((connection) => connection.kind === "waha");
        setConnectedWhatsappNumber(whatsapp?.phoneNumber ?? null);
      }
    }
    catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [demo]);
  useEffect(() => { setPreview(null); }, [subject, emailBody, whatsappBody, templateLanguage]);

  const current = useMemo<MessageSettingsInput>(() => ({
    emailSubjectTemplate: subject,
    emailBodyTemplate: emailBody,
    whatsappBodyTemplate: whatsappBody,
    templateLanguage,
    translations: { ...variants, [templateLanguage]: { emailSubjectTemplate: subject, emailBodyTemplate: emailBody, whatsappBodyTemplate: whatsappBody } },
  }), [subject, emailBody, whatsappBody, variants, templateLanguage, getLanguage()]);
  const dirty = saved ? JSON.stringify(current) !== JSON.stringify(saved) : false;
  const valid = subject.trim().length > 0 && !/[\r\n]/.test(subject) && emailBody.trim().length > 0 && whatsappBody.trim().length > 0;
  const recipientIsConnectedWhatsapp = testChannel === "whatsapp"
    && connectedWhatsappNumber !== null
    && phoneDigits(recipient) === phoneDigits(connectedWhatsappNumber);

  const save = async () => {
    setError(null);
    setNotice(null);
    if (!valid) { setError("Complete all three templates. The email subject must be a single line."); return; }
    setSaving(true);
    try {
      if (demo) {
        const next = { ...current, allowedVariables: settings?.allowedVariables ?? demoSettings.allowedVariables };
        applySettings(next);
        setNotice("Demo templates were updated locally. Nothing was sent to the server.");
      } else {
        applySettings(await apiClient.updateMessageSettings(current));
        setNotice("Templates saved.");
      }
      setPreview(null);
      setTestResult(null);
    } catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setSaving(false); }
  };

  const showPreview = async (channel: MessageChannel) => {
    setError(null);
    setNotice(null);
    setPreviewing(channel);
    try {
      setPreview(demo || dirty ? renderDemoPreview(channel, current) : await apiClient.previewMessage(channel, templateLanguage));
    } catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setPreviewing(null); }
  };

  const sendTest = async () => {
    setError(null);
    setNotice(null);
    setTestResult(null);
    const validRecipient = testChannel === "email" ? recipient.includes("@") : /^\+[1-9]\d{7,14}$/.test(recipient);
    if (!validRecipient) {
      setError(testChannel === "email" ? t("Check the recipient email address.") : t("Use a phone number in the format +390000000000."));
      return;
    }
    if (recipientIsConnectedWhatsapp) {
      setError("Use a different recipient. WhatsApp cannot send this test to the same number connected to the hotel account.");
      return;
    }
    setTesting(true);
    try {
      if (demo) {
        setTestResult(fakeDemoResult(testChannel, recipient, current));
      } else {
        setTestResult(await apiClient.testMessage(testChannel, recipient.trim(), templateLanguage));
      }
    } catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setTesting(false); }
  };

  const insertVariable = (variable: string) => {
    const token = `{{${variable}}}`;
    if (activeTemplate === "subject") setSubject((value) => `${value}${value.endsWith(" ") || !value ? "" : " "}${token}`);
    if (activeTemplate === "email") setEmailBody((value) => `${value}${value.endsWith(" ") || value.endsWith("\n") || !value ? "" : " "}${token}`);
    if (activeTemplate === "whatsapp") setWhatsappBody((value) => `${value}${value.endsWith(" ") || !value ? "" : " "}${token}`);
  };

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title={t("Message templates")} onBack={onBack} />
        <Text style={styles.lead}>{t("Customise the text guests receive with their offer link.")}</Text>
        {settings && !Object.keys(settings.translations ?? {}).length ? <View style={{ gap: 8 }}>
          <Text style={uiStyles.body}>{t("Existing templates are preserved. Choose their language; the other language uses built-in messages until you save a translation.")}</Text>
          <SelectField label={t("Legacy template language")} value={settings.templateLanguage ?? "it"} options={[{ value: "it", label: t("Italian") }, { value: "en", label: t("English") }]} onChange={(value) => {
            const language = value as Language;
            const original = messageTemplates(settings);
            setSettings({ ...settings, templateLanguage: language, translations: { [language]: original } });
            setVariants({ [language]: original }); setTemplateLanguage(language);
            setSubject(original.emailSubjectTemplate); setEmailBody(original.emailBodyTemplate); setWhatsappBody(original.whatsappBodyTemplate);
            setPreview(null); setTestResult(null);
          }} disabled={loading || saving || testing} />
        </View> : null}
        <SelectField label={t("Template language")} value={templateLanguage} options={[{ value: "en", label: t("English templates") }, { value: "it", label: t("Italian templates") }]} onChange={(value) => {
          const language = value as Language;
          setVariants((previous) => ({ ...previous, [templateLanguage]: { emailSubjectTemplate: subject, emailBodyTemplate: emailBody, whatsappBodyTemplate: whatsappBody } }));
          const next = variants[language] ?? defaultTemplates(language);
          setTemplateLanguage(language); setSubject(next.emailSubjectTemplate); setEmailBody(next.emailBodyTemplate); setWhatsappBody(next.whatsappBodyTemplate);
          setPreview(null); setTestResult(null);
        }} disabled={loading || saving || testing} />
        <Text style={uiStyles.body}>{t("Edit each language separately. Guest language determines which version is sent.")}</Text>
        {demo ? <InlineState tone="warning">{t("Demo mode: previews are local and test messages are not sent")}</InlineState> : null}
        {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
        {notice ? <InlineState tone="success">{translateLabel(notice)}</InlineState> : null}

        {loading ? (
          <View style={styles.loading}><ActivityIndicator size="large" color={theme.colors.action} /><Text style={styles.loadingText}>{t("Loading templates…")}</Text></View>
        ) : !settings ? (
          <View style={styles.loadFailure}><Mail size={28} color={theme.colors.textMuted} /><Text style={styles.loadFailureTitle}>{t("Templates were not loaded")}</Text><Text style={styles.loadFailureText}>{t("Try again. Real errors are not replaced with demo data.")}</Text><Button variant="secondary" onPress={() => void load()}>{t("Try again")}</Button></View>
        ) : (
          <>
            <View style={styles.section}>
              <SectionTitle>{t("Available variables")}</SectionTitle>
              <Text style={styles.helper}>{t("Tap a variable to add it to the last selected field.")}</Text>
              <View style={styles.variables}>
                {settings.allowedVariables.map((variable) => (
                  <Pressable key={variable} accessibilityRole="button" onPress={() => insertVariable(variable)} style={({ pressed }) => [styles.variable, pressed && styles.pressed]}>
                    <Variable size={14} color={theme.colors.action} /><Text style={styles.variableText}>{`{{${variable}}}`}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <SectionTitle>{t("Email")}</SectionTitle>
              <Field label={t("Email subject")} value={subject} onChangeText={setSubject} onFocus={() => setActiveTemplate("subject")} editable={!saving} maxLength={160} error={subject.includes("\n") ? t("The subject must be a single line") : undefined} />
              <Field label={t("Email body")} value={emailBody} onChangeText={setEmailBody} onFocus={() => setActiveTemplate("email")} editable={!saving} multiline numberOfLines={8} maxLength={5000} style={styles.textArea} />
            </View>

            <View style={styles.section}>
              <SectionTitle>WhatsApp</SectionTitle>
              <Field label={t("WhatsApp message")} value={whatsappBody} onChangeText={setWhatsappBody} onFocus={() => setActiveTemplate("whatsapp")} editable={!saving} multiline numberOfLines={6} maxLength={2000} style={styles.textArea} />
            </View>

            <Button onPress={() => void save()} loading={saving} disabled={!dirty} icon={Check}>{dirty ? t("Save templates") : t("Templates saved")}</Button>

            <View style={styles.section}>
              <SectionTitle>{t("Preview")}</SectionTitle>
              {dirty && !demo ? <InlineState tone="warning">{t("This is a draft preview with sample guest data. Save when you are ready.")}</InlineState> : null}
              <View style={styles.actionRow}>
                <View style={styles.actionHalf}><Button variant="secondary" icon={Mail} loading={previewing === "email"} onPress={() => void showPreview("email")}>{t("Preview email")}</Button></View>
                <View style={styles.actionHalf}><Button variant="secondary" icon={MessageCircle} loading={previewing === "whatsapp"} onPress={() => void showPreview("whatsapp")}>{t("Preview WhatsApp")}</Button></View>
              </View>
              {preview ? <PreviewCard preview={preview} /> : null}
            </View>

            <View style={styles.section}>
              <SectionTitle>{t("Test message")}</SectionTitle>
              <ChannelChoice selected={testChannel} onSelect={(channel) => { setTestChannel(channel); setRecipient(""); setTestResult(null); }} />
              <Field
                label={testChannel === "email" ? t("Recipient email") : t("Recipient WhatsApp")}
                placeholder={testChannel === "email" ? "owner@hotel.it" : "+390000000000"}
                value={recipient}
                onChangeText={setRecipient}
                keyboardType={testChannel === "email" ? "email-address" : "phone-pad"}
                autoCapitalize="none"
                editable={!testing}
                error={recipientIsConnectedWhatsapp ? t("This is the connected hotel WhatsApp number. Enter a different recipient.") : undefined}
              />
              <Button variant="secondary" icon={Send} onPress={() => void sendTest()} loading={testing} disabled={(dirty && !demo) || recipientIsConnectedWhatsapp}>{t("Send test")}</Button>
              <Text style={styles.helper}>{t("With a verified connection, the test is sent through Gmail or WAHA. Without one, a clearly labelled fake record is created and nothing is sent externally.")}</Text>
              {testResult ? <TestResultCard result={testResult} /> : null}
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PreviewCard({ preview }: { preview: MessagePreview }) {
  return (
    <View style={[uiStyles.card, styles.previewCard]}>
      <View style={styles.previewHeading}><Eye size={18} color={theme.colors.action} /><Text style={styles.previewChannel}>{preview.channel === "email" ? t("Email preview") : t("WhatsApp preview")}</Text></View>
      {preview.channel === "email" ? <Text style={styles.previewSubject}>{preview.subject}</Text> : null}
      <Text style={styles.previewText}>{preview.text}</Text>
      <OfferLinkCard offer={preview.offer} />
    </View>
  );
}

function TestResultCard({ result }: { result: TestSendResult }) {
  const Icon = result.accepted ? Check : MessageCircle;
  const recipientIsSender = result.delivery.lastErrorCode === "WAHA_RECIPIENT_IS_SENDER";
  const heading = recipientIsSender
    ? t("Use a different WhatsApp number")
    : result.accepted
      ? t("Accepted by external provider")
      : t("Not sent to an external channel");
  return (
    <View style={[styles.fakeResult, result.accepted && styles.acceptedResult]} accessibilityRole="alert">
      <View style={styles.fakeResultTitle}><Icon size={18} color={result.accepted ? theme.colors.success : theme.colors.warning} /><Text style={[styles.fakeResultHeading, result.accepted && styles.acceptedResultHeading]}>{heading}</Text></View>
      {recipientIsSender ? <Text style={styles.fakeResultText}>{t("This number is connected as the hotel sender, so WhatsApp cannot receive its own test message.")}</Text> : null}
      <Text style={styles.fakeResultText}>{t("Provider:")}{" "}{result.provider} {" "}{t("· accepted:")}{" "}{String(result.accepted)}</Text>
      <Text style={styles.fakeResultText}>{t("Delivery:")}{" "}{result.delivery.state} · {result.delivery.lastErrorCode ?? "no code"}</Text>
      <Text style={styles.fakeResultText}>{t("Recipient:")}{" "}{result.delivery.recipient}</Text>
      <OfferLinkCard offer={result.rendered.offer} />
    </View>
  );
}

function OfferLinkCard({ offer }: { offer: MessagePreview["offer"] }) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const openOffer = async () => {
    setLinkError(null);
    try { await Linking.openURL(offer.url); }
    catch { setLinkError("Could not open the offer. Please try again."); }
  };
  return <View style={styles.offerContext}>
    <Text style={styles.offerContextEyebrow}>{t("Guest offer page preview")}</Text>
    <View style={styles.offerContextHeading}><Building2 size={17} color={theme.colors.action} /><Text style={styles.offerContextTitle}>{offer.hotelName}</Text></View>
    <Text style={styles.offerContextMeta}>{offer.checkIn} → {offer.checkOut}</Text>
    <Text style={styles.offerContextMeta}>{offer.roomNames.length > 0 ? offer.roomNames.join(" · ") : t("No priced rooms are available for this test period")}</Text>
    <Button variant="secondary" icon={ExternalLink} onPress={() => void openOffer()}>{t("Preview the page guests open")}</Button>
    {linkError ? <InlineState tone="danger">{linkError}</InlineState> : null}
  </View>;
}

function ChannelChoice({ selected, onSelect }: { selected: MessageChannel; onSelect: (channel: MessageChannel) => void }) {
  return <View style={styles.channelChoice}>{(["email", "whatsapp"] as const).map((channel) => <Pressable key={channel} accessibilityRole="button" accessibilityState={{ selected: selected === channel }} onPress={() => onSelect(channel)} style={[styles.channelButton, selected === channel && styles.channelButtonSelected]}><Text style={[styles.channelButtonText, selected === channel && styles.channelButtonTextSelected]}>{channel === "email" ? t("Email") : "WhatsApp"}</Text></Pressable>)}</View>;
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><ArrowLeft size={22} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{translateLabel(title)}</Text><View style={{ width: 44 }} /></View>;
}

function toInput(settings: MessageSettings): MessageSettingsInput {
  return { ...messageTemplates(settings), ...(settings.templateLanguage ? { templateLanguage: settings.templateLanguage } : {}), ...(settings.translations ? { translations: settings.translations } : {}) };
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function renderDemoPreview(channel: MessageChannel, settings: MessageSettingsInput): MessagePreview {
  const origin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : process.env.EXPO_PUBLIC_API_URL ?? "https://ospio.online";
  return renderDemoMessagePreview(channel, settings, origin);
}

function fakeDemoResult(channel: MessageChannel, recipient: string, settings: MessageSettingsInput): TestSendResult {
  return { provider: "fake", accepted: false, delivery: { id: "demo", channel, state: "unknown", recipient, lastErrorCode: "FAKE_PROVIDER", createdAt: new Date().toISOString() }, rendered: renderDemoPreview(channel, settings) };
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  pressed: { opacity: 0.65 },
  headerTitle: { ...theme.typography.h3, color: theme.colors.text },
  lead: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: theme.spacing[4] },
  loadingText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  loadFailure: { minHeight: 300, alignItems: "center", justifyContent: "center", gap: theme.spacing[3], padding: theme.spacing[5], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  loadFailureTitle: { ...theme.typography.h4, color: theme.colors.text, textAlign: "center" },
  loadFailureText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, textAlign: "center", marginBottom: theme.spacing[2] },
  section: { gap: theme.spacing[4], marginTop: theme.spacing[3] },
  helper: { ...theme.typography.caption, color: theme.colors.textMuted },
  variables: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  variable: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: theme.spacing[1], paddingHorizontal: theme.spacing[3], borderRadius: theme.radii.pill, backgroundColor: theme.colors.actionTint },
  variableText: { ...theme.typography.captionMedium, color: theme.colors.action },
  textArea: { minHeight: 136, paddingTop: theme.spacing[3], textAlignVertical: "top" },
  actionRow: { flexDirection: "row", gap: theme.spacing[3] },
  actionHalf: { flex: 1 },
  previewCard: { gap: theme.spacing[3] },
  previewHeading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  previewChannel: { ...theme.typography.captionMedium, color: theme.colors.action },
  previewSubject: { ...theme.typography.h4, color: theme.colors.text },
  previewText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  offerContext: { gap: theme.spacing[2], padding: theme.spacing[3], borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint },
  offerContextEyebrow: { ...theme.typography.captionMedium, color: theme.colors.action },
  offerContextHeading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  offerContextTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  offerContextMeta: { ...theme.typography.caption, color: theme.colors.textSecondary },
  channelChoice: { flexDirection: "row", backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radii.md, padding: theme.spacing[1], minHeight: 48 },
  channelButton: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.sm },
  channelButtonSelected: { backgroundColor: theme.colors.surface },
  channelButtonText: { ...theme.typography.button, color: theme.colors.textMuted },
  channelButtonTextSelected: { color: theme.colors.action },
  fakeResult: { borderRadius: theme.radii.md, backgroundColor: theme.colors.warningTint, padding: theme.spacing[3], gap: theme.spacing[2] },
  acceptedResult: { backgroundColor: theme.colors.successTint },
  fakeResultTitle: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  fakeResultHeading: { ...theme.typography.bodySmallMedium, color: theme.colors.warning },
  acceptedResultHeading: { color: theme.colors.success },
  fakeResultText: { ...theme.typography.caption, color: theme.colors.textSecondary },
});

function messageTemplates(settings: MessageTemplates): MessageTemplates { return { emailSubjectTemplate: settings.emailSubjectTemplate, emailBodyTemplate: settings.emailBodyTemplate, whatsappBodyTemplate: settings.whatsappBodyTemplate }; }
function defaultTemplates(language: Language): MessageTemplates {
  return language === "it" ? messageTemplates(demoSettings) : {
    emailSubjectTemplate: "Your offer from {{hotel_name}}",
    emailBodyTemplate: "Hello {{guest_name}},\n\nYour offer for {{check_in}} to {{check_out}} is ready.\nTotal: {{total}}\n\n{{offer_url}}",
    whatsappBodyTemplate: "Hello {{guest_name}}, your offer from {{hotel_name}} is ready: {{offer_url}}",
  };
}
