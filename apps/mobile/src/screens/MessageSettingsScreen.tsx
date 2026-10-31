import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, Check, Eye, Mail, MessageCircle, Send, Variable } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import type {
  MessageChannel,
  MessagePreview,
  MessageSettings,
  MessageSettingsInput,
  TestSendResult,
} from "@/api/types";
import { Button, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";

const demoSettings: MessageSettings = {
  emailSubjectTemplate: "Your offer from {{hotel_name}}",
  emailBodyTemplate: "Hello {{guest_name}},\n\nYour offer for {{check_in}} to {{check_out}} is ready.\nTotal: {{total}}\n\n{{offer_url}}",
  whatsappBodyTemplate: "Hello {{guest_name}}, your offer from {{hotel_name}} is ready: {{offer_url}}",
  allowedVariables: ["guest_name", "hotel_name", "check_in", "check_out", "guest_count", "total", "offer_url"],
};

type ActiveTemplate = "subject" | "email" | "whatsapp";

export function MessageSettingsScreen({ onBack, demo }: { onBack: () => void; demo: boolean }) {
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

  const applySettings = (next: MessageSettings) => {
    setSettings(next);
    setSubject(next.emailSubjectTemplate);
    setEmailBody(next.emailBodyTemplate);
    setWhatsappBody(next.whatsappBodyTemplate);
    setSaved(toInput(next));
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try { applySettings(demo ? demoSettings : await apiClient.getMessageSettings()); }
    catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [demo]);

  const current = useMemo<MessageSettingsInput>(() => ({
    emailSubjectTemplate: subject,
    emailBodyTemplate: emailBody,
    whatsappBodyTemplate: whatsappBody,
  }), [subject, emailBody, whatsappBody]);
  const dirty = saved ? JSON.stringify(current) !== JSON.stringify(saved) : false;
  const valid = subject.trim().length > 0 && !/[\r\n]/.test(subject) && emailBody.trim().length > 0 && whatsappBody.trim().length > 0;

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
      setPreview(demo ? renderDemoPreview(channel, current) : await apiClient.previewMessage(channel));
    } catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setPreviewing(null); }
  };

  const sendTest = async () => {
    setError(null);
    setNotice(null);
    setTestResult(null);
    const validRecipient = testChannel === "email" ? recipient.includes("@") : /^\+[1-9]\d{7,14}$/.test(recipient);
    if (!validRecipient) {
      setError(testChannel === "email" ? "Check the recipient email address." : "Use a phone number in the format +390000000000.");
      return;
    }
    setTesting(true);
    try {
      if (demo) {
        setTestResult(fakeDemoResult(testChannel, recipient, current));
      } else {
        setTestResult(await apiClient.testMessage(testChannel, recipient.trim()));
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
        <ScreenHeader title="Message templates" onBack={onBack} />
        <Text style={styles.lead}>Customise the text guests receive with their offer link.</Text>
        {demo ? <InlineState tone="warning">Demo mode: previews are local and test messages are not sent</InlineState> : null}
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        {notice ? <InlineState tone="success">{notice}</InlineState> : null}

        {loading ? (
          <View style={styles.loading}><ActivityIndicator size="large" color={theme.colors.action} /><Text style={styles.loadingText}>Loading templates…</Text></View>
        ) : !settings ? (
          <View style={styles.loadFailure}><Mail size={28} color={theme.colors.textMuted} /><Text style={styles.loadFailureTitle}>Templates were not loaded</Text><Text style={styles.loadFailureText}>Try again. Real errors are not replaced with demo data.</Text><Button variant="secondary" onPress={() => void load()}>Try again</Button></View>
        ) : (
          <>
            <View style={styles.section}>
              <SectionTitle>Available variables</SectionTitle>
              <Text style={styles.helper}>Tap a variable to add it to the last selected field.</Text>
              <View style={styles.variables}>
                {settings.allowedVariables.map((variable) => (
                  <Pressable key={variable} accessibilityRole="button" onPress={() => insertVariable(variable)} style={({ pressed }) => [styles.variable, pressed && styles.pressed]}>
                    <Variable size={14} color={theme.colors.action} /><Text style={styles.variableText}>{`{{${variable}}}`}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <SectionTitle>Email</SectionTitle>
              <Field label="Email subject" value={subject} onChangeText={setSubject} onFocus={() => setActiveTemplate("subject")} editable={!saving} maxLength={160} error={subject.includes("\n") ? "The subject must be a single line" : undefined} />
              <Field label="Email body" value={emailBody} onChangeText={setEmailBody} onFocus={() => setActiveTemplate("email")} editable={!saving} multiline numberOfLines={8} maxLength={5000} style={styles.textArea} />
            </View>

            <View style={styles.section}>
              <SectionTitle>WhatsApp</SectionTitle>
              <Field label="WhatsApp message" value={whatsappBody} onChangeText={setWhatsappBody} onFocus={() => setActiveTemplate("whatsapp")} editable={!saving} multiline numberOfLines={6} maxLength={2000} style={styles.textArea} />
            </View>

            <Button onPress={() => void save()} loading={saving} disabled={!dirty} icon={Check}>{dirty ? "Save templates" : "Templates saved"}</Button>

            <View style={styles.section}>
              <SectionTitle>Preview</SectionTitle>
              {dirty && !demo ? <InlineState tone="warning">Save changes before generating a server preview</InlineState> : null}
              <View style={styles.actionRow}>
                <View style={styles.actionHalf}><Button variant="secondary" icon={Mail} disabled={dirty && !demo} loading={previewing === "email"} onPress={() => void showPreview("email")}>Email</Button></View>
                <View style={styles.actionHalf}><Button variant="secondary" icon={MessageCircle} disabled={dirty && !demo} loading={previewing === "whatsapp"} onPress={() => void showPreview("whatsapp")}>WhatsApp</Button></View>
              </View>
              {preview ? <PreviewCard preview={preview} /> : null}
            </View>

            <View style={styles.section}>
              <SectionTitle>Test message</SectionTitle>
              <ChannelChoice selected={testChannel} onSelect={(channel) => { setTestChannel(channel); setRecipient(""); setTestResult(null); }} />
              <Field
                label={testChannel === "email" ? "Recipient email" : "Recipient WhatsApp"}
                placeholder={testChannel === "email" ? "owner@hotel.it" : "+390000000000"}
                value={recipient}
                onChangeText={setRecipient}
                keyboardType={testChannel === "email" ? "email-address" : "phone-pad"}
                autoCapitalize="none"
                editable={!testing}
              />
              <Button variant="secondary" icon={Send} onPress={() => void sendTest()} loading={testing} disabled={dirty && !demo}>Send test</Button>
              <Text style={styles.helper}>With a verified connection, the test is sent through Gmail or WAHA. Without one, a clearly labelled fake record is created and nothing is sent externally.</Text>
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
      <View style={styles.previewHeading}><Eye size={18} color={theme.colors.action} /><Text style={styles.previewChannel}>{preview.channel === "email" ? "Email preview" : "WhatsApp preview"}</Text></View>
      {preview.channel === "email" ? <Text style={styles.previewSubject}>{preview.subject}</Text> : null}
      <Text style={styles.previewText}>{preview.text}</Text>
    </View>
  );
}

function TestResultCard({ result }: { result: TestSendResult }) {
  const Icon = result.accepted ? Check : MessageCircle;
  return (
    <View style={[styles.fakeResult, result.accepted && styles.acceptedResult]} accessibilityRole="alert">
      <View style={styles.fakeResultTitle}><Icon size={18} color={result.accepted ? theme.colors.success : theme.colors.warning} /><Text style={[styles.fakeResultHeading, result.accepted && styles.acceptedResultHeading]}>{result.accepted ? "Accepted by external provider" : "Not sent to an external channel"}</Text></View>
      <Text style={styles.fakeResultText}>Provider: {result.provider} · accepted: {String(result.accepted)}</Text>
      <Text style={styles.fakeResultText}>Delivery: {result.delivery.state} · {result.delivery.lastErrorCode ?? "no code"}</Text>
      <Text style={styles.fakeResultText}>Recipient: {result.delivery.recipient}</Text>
    </View>
  );
}

function ChannelChoice({ selected, onSelect }: { selected: MessageChannel; onSelect: (channel: MessageChannel) => void }) {
  return <View style={styles.channelChoice}>{(["email", "whatsapp"] as const).map((channel) => <Pressable key={channel} accessibilityRole="button" accessibilityState={{ selected: selected === channel }} onPress={() => onSelect(channel)} style={[styles.channelButton, selected === channel && styles.channelButtonSelected]}><Text style={[styles.channelButtonText, selected === channel && styles.channelButtonTextSelected]}>{channel === "email" ? "Email" : "WhatsApp"}</Text></Pressable>)}</View>;
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><ArrowLeft size={22} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{title}</Text><View style={{ width: 44 }} /></View>;
}

function toInput(settings: MessageSettings): MessageSettingsInput {
  return { emailSubjectTemplate: settings.emailSubjectTemplate, emailBodyTemplate: settings.emailBodyTemplate, whatsappBodyTemplate: settings.whatsappBodyTemplate };
}

function renderDemoPreview(channel: MessageChannel, settings: MessageSettingsInput): MessagePreview {
  const values: Record<string, string> = { guest_name: "Mario Rossi", hotel_name: "Casa Aurelia", check_in: "2027-06-10", check_out: "2027-06-12", guest_count: "2", total: "240,00 €", offer_url: "https://example.com/proposal/preview" };
  const render = (value: string) => value.replace(/{{\s*([a-z_][a-z0-9_]*)\s*}}/g, (_, key: string) => values[key] ?? "");
  return channel === "email" ? { channel, subject: render(settings.emailSubjectTemplate), text: render(settings.emailBodyTemplate), html: "" } : { channel, text: render(settings.whatsappBodyTemplate) };
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
