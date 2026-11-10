import { t, translateLabel, getLanguage } from "../i18n";
import { LanguageSelector } from "../i18n/LanguageSelector";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  BedDouble,
  Bell,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  FileText,
  FileInput,
  Globe2,
  LogOut,
  Mail,
  MessageCircle,
  Users,
} from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient } from "@/api/client";
import type { ConnectionStatus, HotelProfile } from "@/api/types";
import { InlineState, SectionTitle, uiStyles } from "@/components/ui";

export function SettingsScreen({
  profile,
  demo,
  onLogout,
  logoutLoading,
  logoutError,
  onOpenInventory,
  onOpenProfile,
  onOpenMessages,
  onOpenConnections,
  onOpenSiteIntegration,
  onOpenNotifications,
  onOpenForm,
  onOpenOfferSettings,
  onOpenSupport,
}: {
  profile: HotelProfile;
  demo: boolean;
  onLogout: () => Promise<void>;
  logoutLoading: boolean;
  logoutError: string | null;
  onOpenInventory: () => void;
  onOpenProfile: () => void;
  onOpenMessages: () => void;
  onOpenConnections: () => void;
  onOpenSiteIntegration: () => void;
  onOpenNotifications: () => void;
  onOpenForm: () => void;
  onOpenOfferSettings: () => void;
  onOpenSupport: () => void;
}) {
  const notReady = (title: string) => Alert.alert(title, t("This section will be connected to the API in the next iteration."));
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [roomCount, setRoomCount] = useState(demo ? 2 : 0);
  const [hasRates, setHasRates] = useState(demo);
  const [setupLoading, setSetupLoading] = useState(!demo);
  const [refreshing, setRefreshing] = useState(false);

  const loadSetup = async (refresh = false) => {
    if (demo) return;
    refresh ? setRefreshing(true) : setSetupLoading(true);
    try {
      const [nextConnections, rooms] = await Promise.all([
        apiClient.getConnections().catch(() => []),
        apiClient.listRooms().catch(() => []),
      ]);
      const rates = await Promise.all(rooms.map((room) => apiClient.listRates(room.id).catch(() => [])));
      setConnections(nextConnections);
      setRoomCount(rooms.length);
      setHasRates(rates.some((roomRates) => roomRates.some((rate) => rate.active)));
    } finally {
      refresh ? setRefreshing(false) : setSetupLoading(false);
    }
  };

  useEffect(() => { void loadSetup(); }, [demo]);

  const setupSteps = useMemo(() => {
    const mailConnected = demo || connections.some((connection) => connection.kind === "mail" && connection.state === "connected");
    const whatsappConnected = demo || connections.some((connection) => connection.kind === "waha" && connection.state === "connected");
    return [
      { title: t("Hotel profile"), detail: t("Name, location and photos"), complete: Boolean(profile.name && profile.city && profile.countryCode), icon: Building2, onPress: onOpenProfile },
      { title: t("Rooms & rates"), detail: roomCount > 0 ? t("Add prices for every room") : t("Add your first room and its prices"), complete: roomCount > 0 && hasRates, icon: BedDouble, onPress: onOpenInventory },
      { title: t("Mail"), detail: t("Send offers from your hotel address"), complete: mailConnected, icon: Mail, onPress: onOpenConnections },
      { title: "WhatsApp", detail: t("Send offers from your hotel number"), complete: whatsappConnected, icon: MessageCircle, onPress: onOpenConnections },
      { title: t("Website form"), detail: t("Receive enquiries from your website"), complete: demo || profile.allowedOrigins.length > 0, icon: Code2, onPress: onOpenSiteIntegration },
    ];
  }, [connections, demo, hasRates, onOpenConnections, onOpenInventory, onOpenProfile, onOpenSiteIntegration, profile, roomCount, getLanguage()]);
  const completedSteps = setupSteps.filter((step) => step.complete).length;
  const setupProgress = `${Math.round((completedSteps / setupSteps.length) * 100)}%` as `${number}%`;

  return (
    <ScrollView
      style={uiStyles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadSetup(true)} tintColor={theme.colors.action} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleBlock}>
        <Text style={uiStyles.h1}>{t("Settings")}</Text>
      </View>

      {demo ? <InlineState tone="warning">{t("Demo mode: changes are not saved to the server")}</InlineState> : null}

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <SectionTitle>{t("Automation setup")}</SectionTitle>
          {setupLoading ? <ActivityIndicator color={theme.colors.action} /> : <Text style={styles.progressCount}>{completedSteps}/{setupSteps.length}</Text>}
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: setupLoading ? "0%" : setupProgress }]} /></View>
        <View style={styles.setupCard}>
          {setupSteps.map((step, index) => <SetupRow key={step.title} index={index + 1} {...step} last={index === setupSteps.length - 1} />)}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t("Automation settings")}</SectionTitle>
        <View style={styles.menuCard}>
          <SettingRow icon={FileText} title={t("Offer messages")} subtitle={t("Email, WhatsApp, preview and test")} onPress={onOpenMessages} />
          <SettingRow icon={BedDouble} title={t("Extras & offer defaults")} subtitle={t("Services, prices, deposit and cancellation policy")} onPress={onOpenOfferSettings} />
          <SettingRow icon={Bell} title={t("Notifications")} subtitle={t("Phone and email alerts")} onPress={onOpenNotifications} last />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t("Platform settings")}</SectionTitle>
        <View style={styles.menuCard}>
          <View style={{ padding: 20, gap: 12 }}><Text style={uiStyles.h2}>{t("App language")}</Text><LanguageSelector authenticated={!demo} /></View>
          <SettingRow icon={Users} title={t("Team members")} subtitle={t("Invitations will be added later")} onPress={() => notReady(t("Team members"))} />
          <SettingRow icon={CircleHelp} title={t("Support")} subtitle={t("WhatsApp · Telegram · Email · Phone")} onPress={onOpenSupport} last />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t("Testing")}</SectionTitle>
        <View style={styles.menuCard}>
          <SettingRow icon={FileInput} title={t("Form")} subtitle={t("Send a hotel enquiry")} onPress={onOpenForm} last />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: logoutLoading, busy: logoutLoading }}
        disabled={logoutLoading}
        onPress={() => void onLogout()}
        style={({ pressed }) => [styles.logout, pressed && styles.pressed, logoutLoading && { opacity: 0.55 }]}
      >
        {logoutLoading ? <ActivityIndicator color={theme.colors.danger} /> : <LogOut size={19} color={theme.colors.danger} />}
        <Text style={styles.logoutText}>{demo ? t("Exit demo") : t("Sign out")}</Text>
      </Pressable>
      {logoutError ? <Text style={styles.logoutError} accessibilityRole="alert">{translateLabel(logoutError)}</Text> : null}

      <Text style={styles.version}>{t("Hotel Staff · V0.1")}</Text>
    </ScrollView>
  );
}

function SetupRow({
  index,
  icon: Icon,
  title,
  detail,
  complete,
  onPress,
  last,
}: {
  index: number;
  icon: typeof Building2;
  title: string;
  detail: string;
  complete: boolean;
  onPress: () => void;
  last: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${complete ? t("Completed") : t(detail)}`} onPress={onPress} style={({ pressed }) => [styles.setupRow, !last && styles.settingDivider, pressed && styles.rowPressed]}>
    <View style={[styles.setupNumber, complete && styles.setupNumberComplete]}>{complete ? <Check size={18} color={theme.colors.onAction} strokeWidth={3} /> : <Text style={styles.setupNumberText}>{index}</Text>}</View>
    <View style={styles.settingIcon}><Icon size={20} color={complete ? theme.colors.success : theme.colors.action} /></View>
    <View style={{ flex: 1 }}><Text style={styles.settingTitle}>{translateLabel(title)}</Text><Text style={styles.settingSubtitle}>{complete ? t("Completed") : t(detail)}</Text></View>
    <ChevronRight size={18} color={theme.colors.textMuted} />
  </Pressable>;
}

function SettingRow({
  icon: Icon,
  title,
  subtitle,
  badge,
  onPress,
  last = false,
}: {
  icon: typeof BedDouble;
  title: string;
  subtitle: string;
  badge?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, !last && styles.settingDivider, pressed && styles.rowPressed]}
    >
      <View style={styles.settingIcon}>
        <Icon size={20} color={theme.colors.action} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingTitle}>{translateLabel(title)}</Text>
        <Text style={styles.settingSubtitle}>{translateLabel(subtitle)}</Text>
      </View>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <ChevronRight size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[5], paddingBottom: theme.spacing[10] },
  titleBlock: { gap: theme.spacing[1], marginBottom: theme.spacing[6] },
  section: { gap: theme.spacing[3], marginTop: theme.spacing[6] },
  sectionHeading: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[3] },
  progressCount: { ...theme.typography.bodySmallMedium, color: theme.colors.action },
  progressTrack: { height: 7, overflow: "hidden", borderRadius: theme.radii.pill, backgroundColor: theme.colors.border },
  progressFill: { height: "100%", borderRadius: theme.radii.pill, backgroundColor: theme.colors.action },
  setupCard: { overflow: "hidden", borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  setupRow: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[3] },
  setupNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  setupNumberComplete: { backgroundColor: theme.colors.success },
  setupNumberText: { ...theme.typography.captionMedium, color: theme.colors.action },
  menuCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  settingRow: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[3] },
  settingDivider: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rowPressed: { backgroundColor: theme.colors.actionTint },
  settingIcon: { width: 40, height: 40, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  settingTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  settingSubtitle: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  badge: { ...theme.typography.captionMedium, color: theme.colors.action },
  logout: { minHeight: theme.controls.buttonHeight, marginTop: theme.spacing[8], borderRadius: theme.radii.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing[2], backgroundColor: theme.colors.dangerTint },
  logoutText: { ...theme.typography.button, color: theme.colors.danger },
  logoutError: { ...theme.typography.captionMedium, color: theme.colors.danger, textAlign: "center", marginTop: theme.spacing[2] },
  pressed: { opacity: 0.7 },
  version: { ...theme.typography.caption, color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[5] },
});
