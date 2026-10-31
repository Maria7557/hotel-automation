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
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  Mail,
  MessageCircle,
  RefreshCw,
  Server,
} from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import type { ConnectionStatus } from "@/api/types";
import { Button, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";

const demoGoogleConnection: ConnectionStatus = {
    kind: "google",
    configured: false,
    available: false,
    state: "disconnected",
    lastCheckedAt: null,
    lastErrorCode: null,
};

const demoWahaConnection: ConnectionStatus = {
    kind: "waha",
    configured: false,
    available: true,
    state: "disconnected",
    lastCheckedAt: null,
    lastErrorCode: null,
    baseUrl: null,
    sessionName: null,
};

const demoConnections: ConnectionStatus[] = [demoGoogleConnection, demoWahaConnection];

type WahaErrors = Partial<Record<"baseUrl" | "apiKey" | "sessionName", string>>;

export function ConnectionsScreen({ onBack, demo }: { onBack: () => void; demo: boolean }) {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingWaha, setSavingWaha] = useState(false);
  const [checkingWaha, setCheckingWaha] = useState(false);
  const [startingGoogle, setStartingGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [sessionName, setSessionName] = useState("default");
  const [apiKey, setApiKey] = useState("");
  const [wahaErrors, setWahaErrors] = useState<WahaErrors>({});

  const google = useMemo(
    () => connections.find((connection) => connection.kind === "google") ?? demoGoogleConnection,
    [connections],
  );
  const waha = useMemo(
    () => connections.find((connection) => connection.kind === "waha") ?? demoWahaConnection,
    [connections],
  );

  const applyConnections = (next: ConnectionStatus[]) => {
    setConnections(next);
    const nextWaha = next.find((connection) => connection.kind === "waha");
    if (nextWaha) {
      setBaseUrl(nextWaha.baseUrl ?? "");
      setSessionName(nextWaha.sessionName ?? "default");
    }
    setApiKey("");
  };

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      applyConnections(demo ? demoConnections : await apiClient.getConnections());
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      refresh ? setRefreshing(false) : setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [demo]);

  const saveWaha = async () => {
    setError(null);
    setNotice(null);
    const validation = validateWaha({ baseUrl, apiKey, sessionName });
    setWahaErrors(validation);
    if (Object.keys(validation).length > 0) return;
    if (demo) {
      setNotice("Demo mode is view-only. The configuration was not saved.");
      return;
    }

    setSavingWaha(true);
    try {
      const updated = await apiClient.configureWaha({
        baseUrl: baseUrl.trim(),
        apiKey,
        sessionName: sessionName.trim(),
      });
      setConnections((current) => current.map((connection) => connection.kind === "waha" ? updated : connection));
      setBaseUrl(updated.baseUrl ?? baseUrl.trim());
      setSessionName(updated.sessionName ?? sessionName.trim());
      setApiKey("");
      setNotice("WAHA settings saved. A configured status does not confirm message delivery.");
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setSavingWaha(false);
    }
  };

  const openGoogleAuthorization = async () => {
    setError(null);
    setNotice(null);
    if (demo || !google.available) {
      setError("Google OAuth is unavailable. Configure the OAuth variables on the server first.");
      return;
    }

    setStartingGoogle(true);
    try {
      const authorization = await apiClient.startGoogleOAuth();
      const url = new URL(authorization.authorizationUrl);
      if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") {
        throw new Error("Unexpected authorization URL");
      }
      const supported = await Linking.canOpenURL(authorization.authorizationUrl);
      if (!supported) throw new Error("Cannot open authorization URL");
      await Linking.openURL(authorization.authorizationUrl);
      setNotice("Google authorisation opened. This does not mean mail is connected yet; refresh the status when you return.");
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setStartingGoogle(false);
    }
  };

  const checkWaha = async () => {
    setError(null);
    setNotice(null);
    if (demo || !waha.configured) {
      setError("Save the WAHA configuration first.");
      return;
    }
    setCheckingWaha(true);
    try {
      const updated = await apiClient.checkWaha();
      setConnections((current) => current.map((connection) => connection.kind === "waha" ? updated : connection));
      setNotice(updated.state === "connected" ? "The WAHA session is working and ready for a test send." : "WAHA responded, but the session is not ready yet. Check the QR code and session status.");
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setCheckingWaha(false);
    }
  };

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Connections" onBack={onBack} />
        <Text style={styles.lead}>Connect Google Mail and the WAHA gateway. Statuses show only what the server has confirmed.</Text>
        {demo ? <InlineState tone="warning">Demo mode: local statuses are shown and no connections are created</InlineState> : null}
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        {notice ? <InlineState tone="success">{notice}</InlineState> : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={theme.colors.action} />
            <Text style={styles.loadingText}>Checking connections…</Text>
          </View>
        ) : connections.length === 0 && !demo ? (
          <View style={styles.loadFailure}>
            <Server size={28} color={theme.colors.textMuted} />
            <Text style={styles.loadFailureTitle}>Statuses were not loaded</Text>
            <Text style={styles.loadFailureText}>Try again. The app will not replace real connection states with local data.</Text>
            <Button variant="secondary" icon={RefreshCw} onPress={() => void load()}>Try again</Button>
          </View>
        ) : (
          <>
            <View style={styles.refreshRow}>
              <Text style={styles.refreshNote}>Refresh after authorisation or a configuration change.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh statuses"
                accessibilityState={{ busy: refreshing, disabled: refreshing }}
                disabled={refreshing}
                onPress={() => void load(true)}
                style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed, refreshing && styles.disabled]}
              >
                {refreshing ? <ActivityIndicator size="small" color={theme.colors.action} /> : <RefreshCw size={19} color={theme.colors.action} />}
              </Pressable>
            </View>

            <View style={styles.section}>
              <SectionTitle>Google Mail</SectionTitle>
              <ConnectionCard
                connection={google}
                icon={Mail}
                title="Gmail sender"
                unavailableText="CONFIG_REQUIRED · configure Google OAuth on the server"
              />
              {google.lastErrorCode === "TOKEN_EXCHANGE_PENDING" ? (
                <InlineState tone="warning">Authorisation was received, but the token exchange is not complete. Email sending is unavailable.</InlineState>
              ) : null}
              <Button
                variant="secondary"
                icon={ExternalLink}
                disabled={demo || !google.available}
                loading={startingGoogle}
                onPress={() => void openGoogleAuthorization()}
                accessibilityHint={google.available ? "Opens the secure Google page" : "OAuth is not configured on the server"}
              >
                {google.configured ? "Reconnect Google" : "Authorise Google"}
              </Button>
              {!google.available ? <Text style={styles.helper}>The server requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.</Text> : null}
            </View>

            <View style={styles.section}>
              <SectionTitle>WhatsApp · WAHA</SectionTitle>
              <ConnectionCard connection={waha} icon={MessageCircle} title="WAHA API" />
              <View style={styles.formCard}>
                <View style={styles.formHeading}>
                  <View style={styles.formIcon}><Server size={20} color={theme.colors.action} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formTitle}>Gateway configuration</Text>
                    <Text style={styles.formDescription}>The key is encrypted on the server and is never returned to the app.</Text>
                  </View>
                </View>
                <Field
                  label="Base URL"
                  placeholder="https://waha.example.com"
                  value={baseUrl}
                  onChangeText={(value) => { setBaseUrl(value); setWahaErrors((current) => withoutError(current, "baseUrl")); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={!demo && !savingWaha}
                  error={wahaErrors.baseUrl}
                />
                <Field
                  label="Session name"
                  placeholder="hotel-main"
                  value={sessionName}
                  onChangeText={(value) => { setSessionName(value); setWahaErrors((current) => withoutError(current, "sessionName")); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!demo && !savingWaha}
                  error={wahaErrors.sessionName}
                />
                <Field
                  label={waha.configured ? "New API key" : "API key"}
                  placeholder={waha.configured ? "Enter a value to replace the saved key" : "At least 8 characters"}
                  value={apiKey}
                  onChangeText={(value) => { setApiKey(value); setWahaErrors((current) => withoutError(current, "apiKey")); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  textContentType="password"
                  editable={!demo && !savingWaha}
                  error={wahaErrors.apiKey}
                />
                <Button
                  icon={KeyRound}
                  disabled={demo}
                  loading={savingWaha}
                  onPress={() => void saveWaha()}
                >
                  {waha.configured ? "Update WAHA" : "Save WAHA"}
                </Button>
                <Button
                  variant="secondary"
                  icon={RefreshCw}
                  disabled={demo || !waha.configured}
                  loading={checkingWaha}
                  onPress={() => void checkWaha()}
                >
                  Check session
                </Button>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ConnectionCard({
  connection,
  icon: Icon,
  title,
  unavailableText,
}: {
  connection: ConnectionStatus;
  icon: typeof Mail;
  title: string;
  unavailableText?: string;
}) {
  const presentation = connectionPresentation(connection);
  return (
    <View style={styles.statusCard}>
      <View style={[styles.statusIcon, { backgroundColor: presentation.tint }]}><Icon size={22} color={presentation.color} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={[styles.statusLabel, { color: presentation.color }]}>{presentation.label}</Text>
        {!connection.available && unavailableText ? <Text style={styles.statusDetail}>{unavailableText}</Text> : null}
        {connection.lastErrorCode && connection.lastErrorCode !== "TOKEN_EXCHANGE_PENDING" ? <Text style={styles.statusDetail}>Error: {connection.lastErrorCode}</Text> : null}
        {connection.lastCheckedAt ? <Text style={styles.statusDetail}>Checked: {formatDate(connection.lastCheckedAt)}</Text> : <Text style={styles.statusDetail}>The connection has not been checked yet</Text>}
      </View>
    </View>
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

function connectionPresentation(connection: ConnectionStatus) {
  if (!connection.available) return { label: "Unavailable on server", color: theme.colors.warning, tint: theme.colors.warningTint };
  if (!connection.configured) return { label: "Not configured", color: theme.colors.textMuted, tint: theme.colors.surfaceMuted };
  if (connection.state === "connected") return { label: "Connected and verified", color: theme.colors.success, tint: theme.colors.successTint };
  if (connection.lastErrorCode || connection.state === "error" || connection.state === "attention") return { label: "Needs attention", color: theme.colors.danger, tint: theme.colors.dangerTint };
  return { label: "Configured · connection not verified", color: theme.colors.warning, tint: theme.colors.warningTint };
}

function validateWaha(input: { baseUrl: string; apiKey: string; sessionName: string }): WahaErrors {
  const errors: WahaErrors = {};
  try {
    const url = new URL(input.baseUrl.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
      errors.baseUrl = "Enter an HTTP(S) URL without credentials, query parameters or a #fragment.";
    }
  } catch {
    errors.baseUrl = "Enter a complete URL, for example https://waha.example.com.";
  }
  if (input.apiKey.length < 8) errors.apiKey = "The API key must contain at least 8 characters.";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.sessionName.trim())) errors.sessionName = "Use 1–80 Latin letters, numbers, underscores or hyphens.";
  return errors;
}

function withoutError(errors: WahaErrors, key: keyof WahaErrors): WahaErrors {
  const next = { ...errors };
  delete next[key];
  return next;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(date);
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
  headerTitle: { ...theme.typography.h3, color: theme.colors.text },
  lead: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: theme.spacing[4] },
  loadingText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  loadFailure: { minHeight: 300, alignItems: "center", justifyContent: "center", gap: theme.spacing[3], padding: theme.spacing[5], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  loadFailureTitle: { ...theme.typography.h4, color: theme.colors.text, textAlign: "center" },
  loadFailureText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, textAlign: "center", marginBottom: theme.spacing[2] },
  refreshRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  refreshNote: { flex: 1, ...theme.typography.caption, color: theme.colors.textMuted },
  refreshButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint },
  section: { gap: theme.spacing[4], marginTop: theme.spacing[2] },
  helper: { ...theme.typography.caption, color: theme.colors.textMuted },
  statusCard: { minHeight: 112, flexDirection: "row", gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  statusIcon: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center" },
  statusTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  statusLabel: { ...theme.typography.captionMedium, marginTop: theme.spacing[1] },
  statusDetail: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: theme.spacing[1] },
  formCard: { gap: theme.spacing[4], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  formHeading: { flexDirection: "row", gap: theme.spacing[3], alignItems: "flex-start" },
  formIcon: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  formTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  formDescription: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: theme.spacing[1] },
});
