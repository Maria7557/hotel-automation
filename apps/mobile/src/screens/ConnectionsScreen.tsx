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
  View,
} from "react-native";
import { ArrowLeft, Check, Mail, MessageCircle, RefreshCw } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import type { ConnectionStatus } from "@/api/types";
import { Button, InlineState, uiStyles } from "@/components/ui";

const disconnectedGoogle: ConnectionStatus = {
  kind: "google",
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
  { ...disconnectedGoogle, available: true },
  { ...disconnectedWaha, available: true },
];

export function ConnectionsScreen({ onBack, demo }: { onBack: () => void; demo: boolean }) {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<ConnectionStatus["kind"] | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const google = useMemo(
    () => connections.find((connection) => connection.kind === "google") ?? disconnectedGoogle,
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
    if (!google.available) {
      setError("Mail connection is temporarily unavailable.");
      return;
    }
    setBusyKind("google");
    try {
      const authorization = await apiClient.startGoogleOAuth();
      const url = new URL(authorization.authorizationUrl);
      if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") {
        throw new Error("Unexpected authorization URL");
      }
      if (!(await Linking.canOpenURL(authorization.authorizationUrl))) {
        throw new Error("Cannot open authorization URL");
      }
      await Linking.openURL(authorization.authorizationUrl);
    } catch (nextError) {
      setError(authErrorMessage(nextError));
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
              connection={google}
              title="Mail"
              icon={Mail}
              busy={busyKind === "google"}
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
