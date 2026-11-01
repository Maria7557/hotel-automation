import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ArrowLeft, Check, Mail, MessageCircle, RefreshCw } from "lucide-react-native";
import { theme } from "@hotel/design";
import { ApiError, apiClient, authErrorMessage } from "@/api/client";
import type { ConnectionStatus } from "@/api/types";
import { Button, InlineState, uiStyles } from "@/components/ui";

const disconnectedMail: ConnectionStatus = {
  kind: "mail",
  configured: false,
  available: false,
  state: "disconnected",
  lastCheckedAt: null,
  lastErrorCode: null,
};

const disconnectedWaha: ConnectionStatus = {
  kind: "waha",
  configured: false,
  available: false,
  state: "disconnected",
  lastCheckedAt: null,
  lastErrorCode: null,
};

const demoConnections: ConnectionStatus[] = [
  { ...disconnectedMail, available: true },
  { ...disconnectedWaha, available: true },
];

export function ConnectionsScreen({ onBack, demo }: { onBack: () => void; demo: boolean }) {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<ConnectionStatus["kind"] | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<"google" | "microsoft" | "smtp" | null>(null);
  const [smtpHost, setSmtpHost] = useState(""); const [smtpPort, setSmtpPort] = useState<465 | 587>(587);
  const [smtpUser, setSmtpUser] = useState(""); const [smtpPassword, setSmtpPassword] = useState("");

  const mail = useMemo(
    () => connections.find((connection) => connection.kind === "mail") ?? disconnectedMail,
    [connections],
  );
  const waha = useMemo(
    () => connections.find((connection) => connection.kind === "waha") ?? disconnectedWaha,
    [connections],
  );

  const replaceConnection = (updated: ConnectionStatus) => {
    setConnections((current) => [
      ...current.filter((connection) => connection.kind !== updated.kind),
      updated,
    ]);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setConnections(demo ? demoConnections : await apiClient.getConnections());
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [demo]);

  useEffect(() => {
    if (demo) return undefined;
    const refresh = () => {
      void apiClient.getConnections().then(setConnections).catch(() => undefined);
    };
    const nativeSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", refresh);
    }
    return () => {
      nativeSubscription.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", refresh);
      }
    };
  }, [demo]);

  const connectMail = async () => {
    setError(null);
    setNotice(null);
    if (demo) {
      setNotice("Demo mode: no connection was created.");
      return;
    }
    setMailOpen(true);
  };

  const detectMail = async () => {
    if (!email.includes("@")) { setError("Check the email address."); return; }
    setBusyKind("mail"); setError(null);
    try {
      const result = await apiClient.detectMailProvider(email); setProvider(result.provider);
    } catch (nextError) { setError(authErrorMessage(nextError)); } finally { setBusyKind(null); }
  };

  const finishMail = async () => {
    if (!provider) return; setBusyKind("mail"); setError(null);
    try {
      if (provider === "smtp") {
        const updated = await apiClient.connectSmtp({ email, hostname: smtpHost, port: smtpPort, username: smtpUser, appPassword: smtpPassword, encryption: smtpPort === 465 ? "tls" : "starttls" });
        replaceConnection(updated); setMailOpen(false); setSmtpPassword(""); setNotice("Mail is connected and the test email was accepted."); return;
      }
      const authorization = await apiClient.startMailOAuth(provider, email);
      const url = new URL(authorization.authorizationUrl);
      if (url.protocol !== "https:" || !["accounts.google.com", "login.microsoftonline.com"].includes(url.hostname)) {
        throw new Error("Unexpected authorization URL");
      }
      if (!(await Linking.canOpenURL(authorization.authorizationUrl))) {
        throw new Error("Cannot open authorization URL");
      }
      await Linking.openURL(authorization.authorizationUrl);
    } catch (nextError) {
      setError(provider === "microsoft" && nextError instanceof ApiError && nextError.code === "CONFIG_REQUIRED"
        ? "Microsoft connection is temporarily unavailable."
        : authErrorMessage(nextError));
    } finally {
      setBusyKind(null);
    }
  };

  const connectWhatsApp = async () => {
    setError(null);
    setNotice(null);
    if (demo) {
      setNotice("Demo mode: no connection was created.");
      return;
    }
    if (!waha.available) {
      setError("WhatsApp connection is temporarily unavailable.");
      return;
    }
    setBusyKind("waha");
    try {
      const result = await apiClient.connectWaha();
      replaceConnection(result.connection);
      setQrCode(result.qrCode);
      if (result.connection.state === "connected") {
        setNotice("WhatsApp is connected.");
      }
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setBusyKind(null);
    }
  };

  const checkWhatsApp = async () => {
    setError(null);
    setBusyKind("waha");
    try {
      const updated = await apiClient.checkWaha();
      replaceConnection(updated);
      if (updated.state === "connected") {
        setQrCode(null);
        setNotice("WhatsApp is connected.");
      } else {
        setNotice("Scan the QR code, then check the connection again.");
      }
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <View style={uiStyles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader onBack={onBack} />
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        {notice ? <InlineState tone="success">{notice}</InlineState> : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={theme.colors.action} />
          </View>
        ) : (
          <View style={styles.list}>
            <ConnectionRow
              connection={mail}
              title="Mail"
              icon={Mail}
              busy={busyKind === "mail"}
              onPress={() => void connectMail()}
            />
            <ConnectionRow
              connection={waha}
              title="WhatsApp"
              icon={MessageCircle}
              busy={busyKind === "waha"}
              onPress={() => void connectWhatsApp()}
            />
          </View>
        )}

        {qrCode ? (
          <View style={styles.qrCard}>
            <Text style={styles.qrTitle}>Connect WhatsApp</Text>
            <Text style={styles.qrText}>Open WhatsApp → Linked devices → Link a device, then scan this code.</Text>
            <View style={styles.qrFrame}>
              <Image source={{ uri: qrCode }} style={styles.qrImage} resizeMode="contain" />
            </View>
            <Button
              icon={RefreshCw}
              loading={busyKind === "waha"}
              onPress={() => void checkWhatsApp()}
            >
              I scanned the code
            </Button>
          </View>
        ) : null}
        {mailOpen ? <View style={styles.mailCard}>
          <Text style={styles.qrTitle}>Connect mail</Text>
          <Text style={styles.qrText}>Enter the address used to send hotel messages.</Text>
          <TextInput autoCapitalize="none" keyboardType="email-address" placeholder="booking@hotel.it" value={email} onChangeText={(v) => { setEmail(v); setProvider(null); }} style={styles.input} />
          {!provider ? <Button loading={busyKind === "mail"} onPress={() => void detectMail()}>Continue</Button> : <>
            <Text style={styles.providerText}>Suggested: {provider === "google" ? "Google" : provider === "microsoft" ? "Microsoft" : "Other mail provider"}</Text>
            <View style={styles.providerRow}>{(["google", "microsoft", "smtp"] as const).map((value) => <Pressable key={value} onPress={() => setProvider(value)} style={[styles.providerChoice, provider === value && styles.providerSelected]}><Text>{value === "smtp" ? "Other" : value === "microsoft" ? "Microsoft" : "Google"}</Text></Pressable>)}</View>
            {provider === "smtp" ? <>
              <View style={styles.providerRow}>{[
                ["Zoho", "smtp.zoho.com"], ["Namecheap", "mail.privateemail.com"], ["Aruba", "smtps.aruba.it"],
              ].map(([label, host]) => <Pressable key={label} onPress={() => { setSmtpHost(host!); setSmtpPort(465); }} style={styles.providerChoice}><Text>{label}</Text></Pressable>)}</View>
              <TextInput autoCapitalize="none" placeholder="SMTP hostname" value={smtpHost} onChangeText={setSmtpHost} style={styles.input} />
              <View style={styles.providerRow}>{([465, 587] as const).map((port) => <Pressable key={port} onPress={() => setSmtpPort(port)} style={[styles.providerChoice, smtpPort === port && styles.providerSelected]}><Text>{port} · {port === 465 ? "TLS" : "STARTTLS"}</Text></Pressable>)}</View>
              <TextInput autoCapitalize="none" placeholder="Username" value={smtpUser} onChangeText={setSmtpUser} style={styles.input} />
              <TextInput placeholder="App password" secureTextEntry value={smtpPassword} onChangeText={setSmtpPassword} style={styles.input} />
            </> : null}
            <Button loading={busyKind === "mail"} onPress={() => void finishMail()}>Connect and send test</Button>
          </>}
        </View> : null}
      </ScrollView>
    </View>
  );
}

function ConnectionRow({
  connection,
  title,
  icon: Icon,
  busy,
  onPress,
}: {
  connection: ConnectionStatus;
  title: string;
  icon: typeof Mail;
  busy: boolean;
  onPress: () => void;
}) {
  const connected = connection.state === "connected";
  const needsReconnect = connection.configured && (
    connection.state === "attention" || connection.state === "error" || Boolean(connection.lastErrorCode)
  );
  const label = needsReconnect ? "Reconnect" : "Connect";

  return (
    <View style={styles.connectionRow}>
      <View style={[styles.icon, connected && styles.iconConnected]}>
        <Icon size={24} color={connected ? theme.colors.success : theme.colors.action} />
      </View>
      <View style={styles.connectionCopy}>
        <Text style={styles.connectionTitle}>{title}</Text>
        <Text style={[styles.connectionStatus, connected && styles.connectedText]}>
          {connected ? "Connected" : needsReconnect ? "Connection lost" : "Not connected"}
        </Text>
      </View>
      {connected ? (
        <View style={styles.connectedBadge}>
          <Check size={17} color={theme.colors.success} />
          <Text style={styles.connectedBadgeText}>Connected</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${title}`}
          accessibilityState={{ disabled: busy || !connection.available, busy }}
          disabled={busy || !connection.available}
          onPress={onPress}
          style={({ pressed }) => [
            styles.connectButton,
            pressed && styles.pressed,
            (busy || !connection.available) && styles.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.action} />
          ) : (
            <Text style={styles.connectButtonText}>{label}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function ScreenHeader({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ArrowLeft size={22} color={theme.colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Connections</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.controls.contentInset,
    paddingBottom: theme.spacing[10],
    gap: theme.spacing[4],
  },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  headerTitle: { ...theme.typography.h3, color: theme.colors.text },
  loading: { minHeight: 260, alignItems: "center", justifyContent: "center" },
  list: { gap: theme.spacing[3] },
  connectionRow: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.actionTint,
  },
  iconConnected: { backgroundColor: theme.colors.successTint },
  connectionCopy: { flex: 1, minWidth: 0 },
  connectionTitle: { ...theme.typography.bodyMedium, color: theme.colors.text },
  connectionStatus: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  connectedText: { color: theme.colors.success },
  connectButton: {
    minWidth: 112,
    height: 44,
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.actionTint,
  },
  connectButtonText: { ...theme.typography.bodySmallMedium, color: theme.colors.action },
  connectedBadge: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  connectedBadgeText: { ...theme.typography.captionMedium, color: theme.colors.success },
  qrCard: {
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[5],
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  mailCard: { gap: theme.spacing[3], padding: theme.spacing[5], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  input: { minHeight: 48, paddingHorizontal: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, color: theme.colors.text, backgroundColor: theme.colors.background },
  providerText: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  providerRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  providerChoice: { paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2], borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border },
  providerSelected: { borderColor: theme.colors.action, backgroundColor: theme.colors.actionTint },
  qrTitle: { ...theme.typography.h4, color: theme.colors.text },
  qrText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, textAlign: "center", maxWidth: 460 },
  qrFrame: {
    width: 260,
    height: 260,
    padding: theme.spacing[3],
    borderRadius: theme.radii.lg,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  qrImage: { width: "100%", height: "100%" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.45 },
});
