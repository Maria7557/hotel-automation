import { monitoredAction } from "../monitoring/actions";
import { scopedApiClient } from "../api/client";
import { t, translateLabel, getLanguage } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Pressable } from "@/monitoring/Pressable";
import * as Clipboard from "expo-clipboard";
import { ArrowLeft, Check, ClipboardCheck, Code2, Copy, Globe2, Monitor, Smartphone } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import type { HotelIntakeSettings, HotelProfile } from "@/api/types";
import { Button, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";
import { WidgetPreview } from "@/components/WidgetPreview";

export function SiteIntegrationScreen({
  initialProfile,
  demo,
  onBack,
  onSaved,
}: {
  initialProfile: HotelProfile;
  demo: boolean;
  onBack: () => void;
  onSaved: (settings: HotelIntakeSettings) => void;
}) {
  const [settings, setSettings] = useState<HotelIntakeSettings | null>(null);
  const [originsText, setOriginsText] = useState("");
  const [savedOriginsText, setSavedOriginsText] = useState("");
  const [widgetCss, setWidgetCss] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"origins" | "css" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [integrationMode, setIntegrationMode] = useState<"adapter" | "widget">("widget");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

  const applySettings = (next: HotelIntakeSettings) => {
    const value = next.allowedOrigins.join("\n");
    setSettings(next);
    setOriginsText(value);
    setSavedOriginsText(value);
    setWidgetCss(next.widgetCss);
  };

  const load = monitoredAction("action.SiteIntegrationScreen.load", "SiteIntegrationScreen.load", async (signalScope) => {
    const apiClient = scopedApiClient(signalScope);
    setLoading(true);
    setError(null);
    try {
      const profile = demo ? initialProfile : await apiClient.getHotel();
      applySettings({ publicKey: profile.publicKey, allowedOrigins: profile.allowedOrigins, widgetCss: profile.widgetCss });
    } catch (nextError) { signalScope.fail(nextError);
      setError(authErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => { void load(); }, [demo, initialProfile.id, initialProfile.publicKey]);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timeout);
  }, [copied]);

  const origins = useMemo(() => parseOrigins(originsText), [originsText, getLanguage()]);
  const validationError = validateOrigins(origins);
  const dirty = originsText !== savedOriginsText;
  const cssDirty = widgetCss !== (settings?.widgetCss ?? "");
  const cssError = widgetCss.length > 60_000 ? t("Custom CSS must be 60,000 characters or fewer.") : null;
  const apiOrigin = demo ? "https://api.example.com" : getApiOrigin();
  const widgetSnippet = settings?.publicKey && apiOrigin
    ? `<script async src="${apiOrigin}/embed.js" data-public-key="${settings.publicKey}"></script>`
    : "";
  const adapterSnippet = settings?.publicKey && apiOrigin
    ? `<script async src="${apiOrigin}/embed.js"
  data-public-key="${settings.publicKey}"
  data-mode="adapter"
  data-submit-behavior="mirror"
  data-form="#booking-form"
  data-check-in="[name='checkin']"
  data-check-out="[name='checkout']"
  data-name="[name='name']"
  data-first-name="[name='firstName']"
  data-last-name="[name='lastName']"
  data-email="[name='email']"
  data-phone="[name='phone']"
  data-adults="[name='adults']"
  data-child-ages="[name='childAges']"
  data-meal-plan="[name='mealPlan']"
  data-note="[name='message']"></script>`
    : "";
  const snippet = integrationMode === "adapter" ? adapterSnippet : widgetSnippet;

  const save = monitoredAction("action.SiteIntegrationScreen.save", "SiteIntegrationScreen.save", async (signalScope) => {
    const apiClient = scopedApiClient(signalScope);
    setError(null);
    setNotice(null);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving("origins");
    try {
      const next = demo
        ? { publicKey: settings?.publicKey ?? initialProfile.publicKey, allowedOrigins: origins, widgetCss: settings?.widgetCss ?? initialProfile.widgetCss }
        : await apiClient.updateIntakeSettings({ allowedOrigins: origins });
      setSettings(next);
      setOriginsText(next.allowedOrigins.join("\n"));
      setSavedOriginsText(next.allowedOrigins.join("\n"));
      onSaved(next);
      setNotice(demo ? t("Demo settings were updated locally. Nothing was sent to the server.") : t("Allowed websites saved."));
    } catch (nextError) { signalScope.fail(nextError);
      setError(authErrorMessage(nextError));
    } finally {
      setSaving(null);
    }
  });

  const saveCss = monitoredAction("action.SiteIntegrationScreen.saveCss", "SiteIntegrationScreen.saveCss", async (signalScope) => {
    const apiClient = scopedApiClient(signalScope);
    setError(null);
    setNotice(null);
    if (!settings || cssError) return;
    setSaving("css");
    try {
      const next = demo ? { ...settings, widgetCss } : await apiClient.updateIntakeSettings({ widgetCss });
      setSettings(next);
      setWidgetCss(next.widgetCss);
      onSaved(next);
      setNotice(demo ? t("Demo settings were updated locally. Nothing was sent to the server.") : t("Custom CSS saved. Your website form will use it when the page is reloaded."));
    } catch (nextError) { signalScope.fail(nextError);
      setError(authErrorMessage(nextError));
    } finally {
      setSaving(null);
    }
  });

  const copySnippet = monitoredAction("action.SiteIntegrationScreen.copySnippet", "SiteIntegrationScreen.copySnippet", async (signalScope) => {
    const apiClient = scopedApiClient(signalScope);
    setError(null);
    if (!snippet) {
      setError("Embed code is unavailable: check the public key and EXPO_PUBLIC_API_URL.");
      return;
    }
    try {
      await Clipboard.setStringAsync(snippet);
      setCopied(true);
    } catch { signalScope.fail(undefined);
      setError("Could not copy the code. Select it manually.");
    }
  });

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title={t("Website form")} onBack={onBack} />
        <Text style={styles.lead}>{t("Choose which websites may send requests to your hotel account, then copy the ready-made form code.")}</Text>
        {demo ? <InlineState tone="warning">{t("Demo mode: settings and embed code are local; no API requests are made")}</InlineState> : null}
        {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
        {notice ? <InlineState tone="success">{translateLabel(notice)}</InlineState> : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={theme.colors.action} />
            <Text style={styles.loadingText}>{t("Loading website settings…")}</Text>
          </View>
        ) : !settings ? (
          <View style={styles.loadFailure}>
            <Globe2 size={28} color={theme.colors.textMuted} />
            <Text style={styles.loadFailureTitle}>{t("Settings were not loaded")}</Text>
            <Text style={styles.loadFailureText}>{t("Real errors are never replaced with demo data.")}</Text>
            <Button signalAction="ui.SiteIntegrationScreen.load.press" signalPlacement="SiteIntegrationScreen.load" variant="secondary" onPress={() => void load()}>{t("Try again")}</Button>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <SectionTitle>{t("Allowed websites")}</SectionTitle>
              <Text style={styles.helper}>{t("Add the website address where your form will appear, for example https://www.hotel.it. Use one address per line, up to 20.")}</Text>
              <Field
                label={t("Website addresses")}
                placeholder={"https://hotel.it\nhttps://www.hotel.it"}
                value={originsText}
                onChangeText={(value) => { setOriginsText(value); setError(null); setNotice(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={6}
                editable={!saving}
                error={validationError ?? undefined}
                helper={t("Enter only the main website address, without pages such as /booking.")}
                style={styles.originsField}
              />
              <View style={styles.exampleRow}>
                <Check size={16} color={theme.colors.success} />
                <Text style={styles.exampleGood}>https://hotel.it</Text>
                <Text style={styles.exampleBad}>{t("not")} https://hotel.it/booking</Text>
              </View>
              <Button signalAction="ui.SiteIntegrationScreen.save.press" signalPlacement="SiteIntegrationScreen.save" icon={Check} loading={saving === "origins"} disabled={!dirty || !!saving} onPress={() => void save()}>
                {dirty ? t("Save websites") : t("Websites saved")}
              </Button>
            </View>

            <View style={styles.section}>
              <SectionTitle>{t("Integration method")}</SectionTitle>
              <View style={styles.modeRow} accessibilityRole="tablist">
                <Pressable signalAction="ui.SiteIntegrationScreen.setIntegrationMode.press" signalPlacement="SiteIntegrationScreen.setIntegrationMode"
                  accessibilityRole="tab"
                  accessibilityState={{ selected: integrationMode === "widget" }}
                  onPress={() => { setIntegrationMode("widget"); setCopied(false); }}
                  style={[styles.modeOption, integrationMode === "widget" && styles.modeOptionActive]}
                >
                  <Text style={styles.modeEyebrow}>{t("MODE 1")}</Text>
                  <Text style={[styles.modeTitle, integrationMode === "widget" && styles.modeTitleActive]}>{t("Ready-made form")}</Text>
                  <Text style={styles.modeText}>{t("Preview and insert our complete form")}</Text>
                </Pressable>
                <Pressable signalAction="ui.SiteIntegrationScreen.setIntegrationMode.press" signalPlacement="SiteIntegrationScreen.setIntegrationMode"
                  accessibilityRole="tab"
                  accessibilityState={{ selected: integrationMode === "adapter" }}
                  onPress={() => { setIntegrationMode("adapter"); setCopied(false); }}
                  style={[styles.modeOption, integrationMode === "adapter" && styles.modeOptionActive]}
                >
                  <Text style={styles.modeEyebrow}>{t("MODE 2")}</Text>
                  <Text style={[styles.modeTitle, integrationMode === "adapter" && styles.modeTitleActive]}>{t("Existing WordPress / CMS form")}</Text>
                  <Text style={styles.modeText}>{t("Keep its design and original submit")}</Text>
                </Pressable>
              </View>
              {integrationMode === "adapter" ? (
                <>
                  <InlineState tone="success">{t("Form connected.")}</InlineState>
                  <View style={styles.flowCard}>
                    <FlowStep number="1" title={t("Find the form")} detail={t("Set data-form to its CSS selector, for example #booking-form.")} />
                    <FlowStep number="2" title={t("Map existing fields")} detail={t("Match each data-* selector to the field names or IDs already in the CMS.")} />
                    <FlowStep number="3" title={t("Mirror every submit")} detail={t("The original WordPress/CMS action continues normally while a copy is posted to the secure CRM intake endpoint.")} />
                  </View>
                </>
              ) : (
                <View style={styles.previewSection}>
                  <View style={styles.cssCard}>
                    <Text style={styles.previewTitle}>{t("Custom CSS")}</Text>
                    <Text style={styles.helper}>{t("Ask Codex to create CSS from your website design, then paste it here. Preview your changes below and save to apply them to your website form.")}</Text>
                    <Field
                      label={t("Form CSS")}
                      value={widgetCss}
                      onChangeText={(value) => { setWidgetCss(value); setError(null); setNotice(null); }}
                      placeholder={".box {\n  font-family: 'Your brand font', sans-serif;\n  background: #faf8f3;\n  border-radius: 0;\n}\nbutton { background: #314d43; }"}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      multiline
                      numberOfLines={12}
                      editable={!saving}
                      error={cssError ?? undefined}
                      helper={t("Paste CSS only, without <style> tags. Use full URLs for fonts and images. Leave empty and save to restore the default design.")}
                      style={styles.cssField}
                    />
                    <Text selectable style={styles.helper}>{t("For Codex: use :host for the widget container, .box for the form, .grid, .two and .three for layout, .room-fields for each room, .child-fields and .ages for children, .consent for checkboxes, and label, input, select, textarea and button for controls. Styles apply only inside this form.")}</Text>
                    <Button signalAction="ui.SiteIntegrationScreen.saveCss.press" signalPlacement="SiteIntegrationScreen.saveCss" icon={Check} loading={saving === "css"} disabled={!cssDirty || !!cssError || !!saving} onPress={() => void saveCss()}>
                      {cssDirty ? t("Save custom CSS") : t("CSS saved")}
                    </Button>
                    {cssDirty ? <Text style={styles.helper}>{t("The preview shows your unsaved CSS. Save to update your website form.")}</Text> : null}
                  </View>
                  <View style={styles.previewHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTitle}>{t("Live form preview")}</Text>
                      <Text style={styles.previewHelp}>{t("This is the complete form inserted by the widget script.")}</Text>
                    </View>
                    <View style={styles.deviceSwitch}>
                      <DeviceButton device="desktop" label={t("Desktop")} active={previewDevice === "desktop"} onPress={() => setPreviewDevice("desktop")} />
                      <DeviceButton device="mobile" label={t("Mobile")} active={previewDevice === "mobile"} onPress={() => setPreviewDevice("mobile")} />
                    </View>
                  </View>
                  <WidgetPreview device={previewDevice} apiOrigin={getApiOrigin()} publicKey={settings.publicKey} css={widgetCss} language={getLanguage()} demo={demo} />
                </View>
              )}
              {!apiOrigin ? <InlineState tone="danger">{t("EXPO_PUBLIC_API_URL is missing or invalid, so the embed code cannot be created.")}</InlineState> : null}
              {!settings.publicKey ? <InlineState tone="danger">{t("The server did not return the hotel public key. Refresh the profile or contact an administrator.")}</InlineState> : null}
              <View style={styles.codeCard}>
                <View style={styles.codeHeading}>
                  <View style={styles.codeIcon}><Code2 size={20} color={theme.colors.action} /></View>
                  <Text style={styles.codeTitle}>{integrationMode === "adapter" ? t("Copy Existing form adapter") : t("Copy script for Form widget")}</Text>
                </View>
                <Text selectable accessibilityLabel={t("Website integration code")} style={styles.codeText}>{snippet || t("Code is not available yet")}</Text>
                <Button signalAction="ui.SiteIntegrationScreen.copySnippet.press" signalPlacement="SiteIntegrationScreen.copySnippet"
                  variant="secondary"
                  icon={copied ? ClipboardCheck : Copy}
                  disabled={!snippet}
                  onPress={() => void copySnippet()}
                >
                  {copied ? t("Copied") : t("Copy code")}
                </Button>
              </View>
              {copied ? <InlineState tone="success">{t("Code copied to the clipboard")}</InlineState> : null}
            </View>

            <View style={styles.installCard}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.installTitle}>{integrationMode === "adapter" ? t("Match your form and fields") : t("Paste it before the closing tag")}</Text>
                <Text style={styles.installText}>
                  {integrationMode === "adapter"
                    ? t("Replace #booking-form and each [name='…'] selector with your website’s field selectors. Map mealPlan to BB, HB or FB. Use one age dropdown per child (under 1 to 17 years), and point data-child-ages at all of those dropdowns. Map the optional message with data-note.")
                    : <>{t("Open your website HTML template and add the copied script immediately before")}{" "}<Text style={styles.inlineCode}>{"</body>"}</Text>.</>}
                </Text>
              </View>
            </View>
            <View style={styles.installCard}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.installTitle}>{t("Check and allow your website address")}</Text>
                <Text style={styles.installText}>
                  {t("Open the published page containing your form and check your browser’s address bar. For https://www.hotel.it/booking, use https://www.hotel.it — leave out /booking and any trailing slash.")}
                </Text>
                <Text style={styles.installText}>
                  {t("In Settings → Website form → Allowed websites, add this address to Allowed origins and select Save websites. Include https:// or http:// and any port shown. Addresses with and without www are separate entries.")}
                </Text>
                <Text style={styles.installText}>
                  {t("“Address not allowed” means the form page’s website address does not match a saved allowed website. Save the matching address, reload the form page and try again.")}

                </Text><Text style={styles.installText}>
                  {integrationMode === "adapter"
                    ? <>{t("Add")}{" "}<Text style={styles.inlineCode}>data-hotel-inquiry-status</Text> {" "}{t("to an empty element inside the form to show sending, success and error messages. The page must also match an allowed website above.")}</>
                    : t("Address not allowed.")}
                </Text>
              </View>
            </View>
            {integrationMode === "adapter" ? (
              <View style={styles.installCard}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>3</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.installTitle}>{t("Add an optional status message")}</Text>
                  <Text style={styles.installText}>
                    {t("Add")}{" "}<Text style={styles.inlineCode}>data-hotel-inquiry-status</Text>{" "}{t("to an empty element inside the form to show sending, success and error messages.")}
                  </Text>
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable signalAction="ui.ScreenHeader.onBack.press" signalPlacement="ScreenHeader.onBack" accessibilityRole="button" accessibilityLabel={t("Back")} onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ArrowLeft size={22} color={theme.colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{translateLabel(title)}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

function FlowStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <View style={styles.flowRow}>
      <View style={styles.flowNumber}><Text style={styles.flowNumberText}>{number}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.flowTitle}>{translateLabel(title)}</Text>
        <Text style={styles.flowDetail}>{translateLabel(detail)}</Text>
      </View>
    </View>
  );
}

function DeviceButton({
  device,
  label,
  active,
  onPress,
}: {
  device: "desktop" | "mobile";
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable signalAction="ui.DeviceButton.onPress.press" signalPlacement="DeviceButton.onPress"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.deviceButton, active && styles.deviceButtonActive]}
    >
      {device === "desktop"
        ? <Monitor size={15} color={active ? theme.colors.action : theme.colors.textMuted} />
        : <Smartphone size={15} color={active ? theme.colors.action : theme.colors.textMuted} />}
      <Text style={[styles.deviceLabel, active && styles.deviceLabelActive]}>{translateLabel(label)}</Text>
    </Pressable>
  );
}

function parseOrigins(value: string): string[] {
  return value.split(/\r?\n/).map((origin) => origin.trim()).filter(Boolean);
}

function validateOrigins(origins: string[]): string | null {
  if (origins.length > 20) return t("You can add up to 20 websites.");
  if (new Set(origins).size !== origins.length) return t("Remove duplicate origins.");
  for (let index = 0; index < origins.length; index += 1) {
    const origin = origins[index]!;
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || origin !== url.origin) {
        return t("Line {{v0}}: keep only the scheme, domain and optional port.", { v0: index + 1 });
      }
    } catch {
      return t("Line {{v0}}: enter a complete origin, for example https://hotel.it.", { v0: index + 1 });
    }
  }
  return null;
}

function getApiOrigin(): string | null {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
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
  section: { gap: theme.spacing[4], marginTop: theme.spacing[2] },
  modeRow: { flexDirection: "row", gap: theme.spacing[3] },
  modeOption: { flex: 1, minHeight: 118, gap: theme.spacing[1], padding: theme.spacing[3], borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  modeOptionActive: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint },
  modeEyebrow: { ...theme.typography.captionMedium, color: theme.colors.textMuted },
  modeTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  modeTitleActive: { color: theme.colors.action },
  modeText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  flowCard: { gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  flowRow: { flexDirection: "row", gap: theme.spacing[3], alignItems: "flex-start" },
  flowNumber: { width: 28, height: 28, borderRadius: theme.radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  flowNumberText: { ...theme.typography.captionMedium, color: theme.colors.action },
  flowTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  flowDetail: { ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing[1] },
  previewSection: { gap: theme.spacing[3] },
  cssCard: { gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  cssField: { minHeight: 240, maxHeight: 480, paddingTop: theme.spacing[3], textAlignVertical: "top", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, lineHeight: 20 },
  previewHeader: { gap: theme.spacing[3] },
  previewTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  previewHelp: { ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing[1] },
  deviceSwitch: { alignSelf: "flex-start", flexDirection: "row", padding: 3, borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceMuted },
  deviceButton: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: theme.spacing[1], paddingHorizontal: theme.spacing[3], borderRadius: theme.radii.sm },
  deviceButtonActive: { backgroundColor: theme.colors.surface },
  deviceLabel: { ...theme.typography.captionMedium, color: theme.colors.textMuted },
  deviceLabelActive: { color: theme.colors.action },
  helper: { ...theme.typography.caption, color: theme.colors.textMuted },
  originsField: { minHeight: 138, paddingTop: theme.spacing[3], textAlignVertical: "top" },
  exampleRow: { minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  exampleGood: { ...theme.typography.captionMedium, color: theme.colors.success },
  exampleBad: { ...theme.typography.caption, color: theme.colors.textMuted },
  codeCard: { gap: theme.spacing[4], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  codeHeading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  codeIcon: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  codeTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text, flex: 1 },
  codeText: { ...theme.typography.bodySmall, color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radii.md, padding: theme.spacing[4] },
  installCard: { minHeight: 96, flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  stepNumber: { width: 44, height: 44, borderRadius: theme.radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.action },
  stepNumberText: { ...theme.typography.button, color: theme.colors.onAction },
  installTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  installText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, marginTop: theme.spacing[1] },
  inlineCode: { ...theme.typography.bodySmallMedium, color: theme.colors.action },
});
