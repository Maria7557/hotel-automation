import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { ArrowLeft, Bell, Check, Mail } from "lucide-react-native";
import { theme } from "@hotel/design";

import { ApiError, apiClient } from "@/api/client";
import type { NotificationSettings } from "@/api/types";
import { InlineState, SectionTitle, uiStyles } from "@/components/ui";
import { registerThisPhoneForPush } from "@/notifications/push-registration";

export function NotificationSettingsScreen({ onBack, demo }: { onBack: () => void; demo: boolean }) {
  const [settings, setSettings] = useState<NotificationSettings | null>(demo ? demoSettings : null);
  const [pushAllRequests, setPushAllRequests] = useState(false);
  const [emailIncomingRequests, setEmailIncomingRequests] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = (next: NotificationSettings) => {
    setSettings(next);
    setPushAllRequests(next.pushAllRequests);
    setEmailIncomingRequests(next.emailIncomingRequests);
    setEmailAddress(next.emailAddress);
  };

  useEffect(() => {
    if (demo) {
      apply(demoSettings);
      return;
    }
    let active = true;
    apiClient.getNotificationSettings()
      .then((next) => { if (active) apply(next); })
      .catch((cause) => { if (active) setError(messageFor(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo]);

  const save = async () => {
    if (emailIncomingRequests && !/^\S+@\S+\.\S+$/.test(emailAddress.trim())) {
      setError("Enter the email address for notifications.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = demo
        ? { ...demoSettings, pushAllRequests, emailIncomingRequests, emailAddress: emailAddress.trim() }
        : await apiClient.updateNotificationSettings({
            pushAllRequests,
            emailIncomingRequests,
            emailAddress: emailIncomingRequests ? emailAddress.trim() : (emailAddress.trim() || null),
          });
      apply(next);
      setSaved(true);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  const connectPhone = async () => {
    setConnecting(true);
    setError(null);
    try {
      const device = await registerThisPhoneForPush();
      const next = demo ? { ...demoSettings, pushDeviceRegistered: true, pushDeviceCount: 1 } : await apiClient.registerPushDevice(device);
      setSettings(next);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setConnecting(false);
    }
  };

  return <View style={uiStyles.screen}>
    <View style={styles.topBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><ArrowLeft size={22} color={theme.colors.text} /></Pressable>
      <Text style={styles.topTitle}>Notifications</Text>
      <View style={styles.backSpacer} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {loading ? <ActivityIndicator color={theme.colors.action} /> : null}
      {error ? <InlineState tone="danger">{error}</InlineState> : null}
      {saved ? <InlineState tone="success">Saved</InlineState> : null}

      {settings ? <>
        <View style={styles.section}>
          <SectionTitle>Phone</SectionTitle>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.icon}><Bell size={20} color={theme.colors.action} /></View>
              <View style={styles.rowText}><Text style={styles.title}>Payments & errors</Text></View>
              <View style={styles.required}><Check size={16} color={theme.colors.success} /><Text style={styles.requiredText}>Always on</Text></View>
            </View>
            <View style={[styles.row, styles.divider]}>
              <View style={styles.rowText}><Text style={styles.title}>All incoming requests</Text></View>
              <Switch value={pushAllRequests} onValueChange={setPushAllRequests} trackColor={{ false: theme.colors.border, true: theme.colors.action }} />
            </View>
            <Pressable disabled={connecting || Platform.OS === "web"} onPress={() => void connectPhone()} style={({ pressed }) => [styles.deviceButton, pressed && styles.pressed, Platform.OS === "web" && styles.disabled]}>
              {connecting ? <ActivityIndicator color={theme.colors.action} /> : settings.pushDeviceRegistered ? <Check size={18} color={theme.colors.success} /> : <Bell size={18} color={theme.colors.action} />}
              <Text style={styles.deviceButtonText}>{settings.pushDeviceRegistered ? "This phone is connected" : Platform.OS === "web" ? "Connect in the mobile app" : "Enable on this phone"}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Email</SectionTitle>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.icon}><Mail size={20} color={theme.colors.action} /></View>
              <View style={styles.rowText}><Text style={styles.title}>Incoming requests</Text></View>
              <Switch value={emailIncomingRequests} onValueChange={setEmailIncomingRequests} trackColor={{ false: theme.colors.border, true: theme.colors.action }} />
            </View>
            {emailIncomingRequests ? <View style={[styles.emailField, styles.divider]}>
              <Text style={styles.label}>Notification email</Text>
              <TextInput value={emailAddress} onChangeText={setEmailAddress} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="manager@hotel.com" style={styles.input} />
            </View> : null}
          </View>
        </View>

        <Pressable disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.save, pressed && styles.pressed, saving && styles.disabled]}>
          {saving ? <ActivityIndicator color={theme.colors.onAction} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </> : null}
    </ScrollView>
  </View>;
}

const demoSettings: NotificationSettings = {
  pushPaymentsAndErrors: true,
  pushAllRequests: false,
  pushDeviceRegistered: false,
  pushDeviceCount: 0,
  emailIncomingRequests: false,
  emailAddress: "manager@hotel.com",
  emailDeliveryAvailable: false,
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Could not update notifications.";
}

const styles = StyleSheet.create({
  topBar: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.controls.contentInset, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  backSpacer: { width: 44 },
  topTitle: { ...theme.typography.h3, color: theme.colors.text },
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[5], paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  section: { gap: theme.spacing[3] },
  card: { overflow: "hidden", borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  row: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[3] },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  icon: { width: 40, height: 40, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  rowText: { flex: 1 },
  title: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  required: { flexDirection: "row", alignItems: "center", gap: 4 },
  requiredText: { ...theme.typography.captionMedium, color: theme.colors.success },
  deviceButton: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing[2], margin: theme.spacing[3], borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint },
  deviceButtonText: { ...theme.typography.button, color: theme.colors.action },
  emailField: { gap: theme.spacing[2], padding: theme.spacing[4] },
  label: { ...theme.typography.captionMedium, color: theme.colors.text },
  input: { minHeight: 52, paddingHorizontal: theme.spacing[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 },
  save: { minHeight: theme.controls.buttonHeight, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.md, backgroundColor: theme.colors.action },
  saveText: { ...theme.typography.button, color: theme.colors.onAction },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.55 },
});
