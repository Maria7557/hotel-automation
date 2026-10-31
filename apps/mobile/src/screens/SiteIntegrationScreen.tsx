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
import * as Clipboard from "expo-clipboard";
import { ArrowLeft, Check, ClipboardCheck, Code2, Copy, Globe2 } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import type { HotelIntakeSettings, HotelProfile } from "@/api/types";
import { Button, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const applySettings = (next: HotelIntakeSettings) => {
    const value = next.allowedOrigins.join("\n");
    setSettings(next);
    setOriginsText(value);
    setSavedOriginsText(value);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = demo ? initialProfile : await apiClient.getHotel();
      applySettings({ publicKey: profile.publicKey, allowedOrigins: profile.allowedOrigins });
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [demo, initialProfile]);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timeout);
  }, [copied]);

  const origins = useMemo(() => parseOrigins(originsText), [originsText]);
  const validationError = validateOrigins(origins);
  const dirty = originsText !== savedOriginsText;
  const apiOrigin = demo ? "https://api.example.com" : getApiOrigin();
  const snippet = settings?.publicKey && apiOrigin
    ? `<script async src="${apiOrigin}/embed.js" data-public-key="${settings.publicKey}"></script>`
    : "";

  const save = async () => {
    setError(null);
    setNotice(null);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      const next = demo
        ? { publicKey: settings?.publicKey ?? initialProfile.publicKey, allowedOrigins: origins }
        : await apiClient.updateIntakeSettings(origins);
      applySettings(next);
      onSaved(next);
      setNotice(demo ? "Demo settings were updated locally. Nothing was sent to the server." : "Allowed websites saved.");
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };

  const copySnippet = async () => {
    setError(null);
    if (!snippet) {
      setError("Embed code is unavailable: check the public key and EXPO_PUBLIC_API_URL.");
      return;
    }
    try {
      await Clipboard.setStringAsync(snippet);
      setCopied(true);
    } catch {
      setError("Could not copy the code. Select it manually.");
    }
  };

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Website form" onBack={onBack} />
        <Text style={styles.lead}>Allow your hotel website and add one script to display the enquiry form.</Text>
        {demo ? <InlineState tone="warning">Demo mode: settings and embed code are local; no API requests are made</InlineState> : null}
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        {notice ? <InlineState tone="success">{notice}</InlineState> : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={theme.colors.action} />
            <Text style={styles.loadingText}>Loading website settings…</Text>
          </View>
        ) : !settings ? (
          <View style={styles.loadFailure}>
            <Globe2 size={28} color={theme.colors.textMuted} />
            <Text style={styles.loadFailureTitle}>Settings were not loaded</Text>
            <Text style={styles.loadFailureText}>Real errors are never replaced with demo data.</Text>
            <Button variant="secondary" onPress={() => void load()}>Try again</Button>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <SectionTitle>Allowed websites</SectionTitle>
              <Text style={styles.helper}>One exact origin per line, up to 20. Enter only the scheme, domain and optional port.</Text>
              <Field
                label="Allowed origins"
                placeholder={"https://hotel.it\nhttps://www.hotel.it"}
                value={originsText}
                onChangeText={(value) => { setOriginsText(value); setError(null); setNotice(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={6}
                editable={!saving}
                error={validationError ?? undefined}
                helper="Do not include /path, ?query, #fragment or a trailing slash."
                style={styles.originsField}
              />
              <View style={styles.exampleRow}>
                <Check size={16} color={theme.colors.success} />
                <Text style={styles.exampleGood}>https://hotel.it</Text>
                <Text style={styles.exampleBad}>not https://hotel.it/booking</Text>
              </View>
              <Button icon={Check} loading={saving} disabled={!dirty} onPress={() => void save()}>
                {dirty ? "Save websites" : "Websites saved"}
              </Button>
            </View>

            <View style={styles.section}>
              <SectionTitle>Website code</SectionTitle>
              {!apiOrigin ? <InlineState tone="danger">EXPO_PUBLIC_API_URL is missing or invalid, so the embed code cannot be created.</InlineState> : null}
              {!settings.publicKey ? <InlineState tone="danger">The server did not return the hotel public key. Refresh the profile or contact an administrator.</InlineState> : null}
              <View style={styles.codeCard}>
                <View style={styles.codeHeading}>
                  <View style={styles.codeIcon}><Code2 size={20} color={theme.colors.action} /></View>
                  <Text style={styles.codeTitle}>Embed script</Text>
                </View>
                <Text selectable accessibilityLabel="Form embed code" style={styles.codeText}>{snippet || "Code is not available yet"}</Text>
                <Button
                  variant="secondary"
                  icon={copied ? ClipboardCheck : Copy}
                  disabled={!snippet}
                  onPress={() => void copySnippet()}
                >
                  {copied ? "Copied" : "Copy code"}
                </Button>
              </View>
              {copied ? <InlineState tone="success">Code copied to the clipboard</InlineState> : null}
            </View>

            <View style={styles.installCard}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.installTitle}>Paste it before the closing tag</Text>
                <Text style={styles.installText}>Open your website HTML template and add the copied script immediately before <Text style={styles.inlineCode}>{"</body>"}</Text>.</Text>
              </View>
            </View>
            <View style={styles.installCard}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.installTitle}>Check the exact origin</Text>
                <Text style={styles.installText}>The page address must match one of the origins above, or the server will reject the enquiry.</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ArrowLeft size={22} color={theme.colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

function parseOrigins(value: string): string[] {
  return value.split(/\r?\n/).map((origin) => origin.trim()).filter(Boolean);
}

function validateOrigins(origins: string[]): string | null {
  if (origins.length > 20) return "You can add up to 20 websites.";
  if (new Set(origins).size !== origins.length) return "Remove duplicate origins.";
  for (let index = 0; index < origins.length; index += 1) {
    const origin = origins[index]!;
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || origin !== url.origin) {
        return `Line ${index + 1}: keep only the scheme, domain and optional port.`;
      }
    } catch {
      return `Line ${index + 1}: enter a complete origin, for example https://hotel.it.`;
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
  helper: { ...theme.typography.caption, color: theme.colors.textMuted },
  originsField: { minHeight: 138, paddingTop: theme.spacing[3], textAlignVertical: "top" },
  exampleRow: { minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  exampleGood: { ...theme.typography.captionMedium, color: theme.colors.success },
  exampleBad: { ...theme.typography.caption, color: theme.colors.textMuted },
  codeCard: { gap: theme.spacing[4], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  codeHeading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  codeIcon: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  codeTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  codeText: { ...theme.typography.bodySmall, color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radii.md, padding: theme.spacing[4] },
  installCard: { minHeight: 96, flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  stepNumber: { width: 44, height: 44, borderRadius: theme.radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.action },
  stepNumberText: { ...theme.typography.button, color: theme.colors.onAction },
  installTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  installText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, marginTop: theme.spacing[1] },
  inlineCode: { ...theme.typography.bodySmallMedium, color: theme.colors.action },
});
