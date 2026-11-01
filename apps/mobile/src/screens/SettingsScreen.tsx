import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  BedDouble,
  ChevronRight,
  CircleHelp,
  Code2,
  FileText,
  Globe2,
  LogOut,
  Mail,
  MessageCircle,
  Palette,
  Users,
} from "lucide-react-native";
import { theme } from "@hotel/design";
import type { HotelProfile } from "@/api/types";
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
}) {
  const notReady = (title: string) => Alert.alert(title, "This section will be connected to the API in the next iteration.");

  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.titleBlock}>
        <Text style={uiStyles.h1}>Settings</Text>
        <Text style={uiStyles.body}>Profile, rooms and delivery channels</Text>
      </View>

      {demo ? <InlineState tone="warning">Demo mode: changes are not saved to the server</InlineState> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${profile.name} hotel profile`}
        onPress={onOpenProfile}
        style={({ pressed }) => [uiStyles.card, styles.profileCard, pressed && styles.pressed]}
      >
        <View style={styles.profileLogo}>
          <Text style={styles.profileLogoText}>{profile.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{profile.name}</Text>
          <Text style={styles.profileMeta}>{profile.city}</Text>
          <Text style={styles.profileMeta}>{profile.email}</Text>
        </View>
        <ChevronRight size={20} color={theme.colors.textMuted} />
      </Pressable>

      <View style={styles.section}>
        <SectionTitle>Hotel setup</SectionTitle>
        <View style={styles.menuCard}>
          <SettingRow icon={BedDouble} title="Rooms and rates" subtitle="Categories · capacity · prices" onPress={onOpenInventory} />
          <SettingRow icon={Code2} title="Website form" subtitle="Allowed origins and embed code" onPress={onOpenSiteIntegration} />
          <SettingRow icon={Palette} title="Offer design" subtitle="Logo, colour and photos" onPress={() => notReady("Offer design")} />
          <SettingRow icon={FileText} title="Message templates" subtitle="Email, WhatsApp, preview and test" onPress={onOpenMessages} last />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>Connections</SectionTitle>
        <View style={styles.menuCard}>
          <SettingRow icon={Mail} title="Mail" subtitle="Connect your hotel email" badge="Open" onPress={onOpenConnections} />
          <SettingRow icon={MessageCircle} title="WhatsApp" subtitle="Connect your hotel number" badge="Open" onPress={onOpenConnections} last />
        </View>
        <InlineState tone="warning">Send a test to your own email and WhatsApp before enabling automation</InlineState>
      </View>

      <View style={styles.section}>
        <SectionTitle>Workspace</SectionTitle>
        <View style={styles.menuCard}>
          <SettingRow icon={Globe2} title="Language and currency" subtitle={`${profile.locale} · ${profile.currency}`} onPress={() => notReady("Language and currency")} />
          <SettingRow icon={Users} title="Team members" subtitle="Invitations will be added later" onPress={() => notReady("Team members")} />
          <SettingRow icon={CircleHelp} title="Help" subtitle="How to process your first request" onPress={() => notReady("Help")} last />
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
        <Text style={styles.logoutText}>{demo ? "Exit demo" : "Sign out"}</Text>
      </Pressable>
      {logoutError ? <Text style={styles.logoutError} accessibilityRole="alert">{logoutError}</Text> : null}

      <Text style={styles.version}>Hotel Staff · V0.1</Text>
    </ScrollView>
  );
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
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <ChevronRight size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[5], paddingBottom: theme.spacing[10] },
  titleBlock: { gap: theme.spacing[1], marginBottom: theme.spacing[6] },
  profileCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  profileLogo: { width: 58, height: 58, borderRadius: theme.radii.lg, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.action },
  profileLogoText: { ...theme.typography.h2, color: theme.colors.onAction },
  profileName: { ...theme.typography.h4, color: theme.colors.text },
  profileMeta: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  section: { gap: theme.spacing[3], marginTop: theme.spacing[6] },
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
