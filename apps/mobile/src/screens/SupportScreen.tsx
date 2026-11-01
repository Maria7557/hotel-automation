import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ArrowUpRight,
  Clock3,
  Mail,
  MessageCircle,
  Phone,
  Send,
  type LucideIcon,
} from "lucide-react-native";
import { theme } from "@hotel/design";

import { uiStyles } from "@/components/ui";

const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || "support@chatsocials.app";
const supportPhone = process.env.EXPO_PUBLIC_SUPPORT_PHONE?.trim() || "";
const supportWhatsApp = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP?.trim() || "";
const supportTelegram = process.env.EXPO_PUBLIC_SUPPORT_TELEGRAM?.trim() || "";

type ContactMethod = {
  id: "phone" | "email" | "whatsapp" | "telegram";
  title: string;
  description: string;
  value: string;
  action: string;
  icon: LucideIcon;
  color: string;
  background: string;
  url: string | null;
};

const methods: ContactMethod[] = [
  {
    id: "phone",
    title: "Phone",
    description: "Speak directly with our support team",
    value: supportPhone || "Call support",
    action: "Call",
    icon: Phone,
    color: theme.colors.action,
    background: theme.colors.actionTint,
    url: supportPhone ? `tel:${supportPhone.replace(/[^+\d]/g, "")}` : null,
  },
  {
    id: "email",
    title: "Email",
    description: "Best for screenshots and detailed questions",
    value: supportEmail,
    action: "Write",
    icon: Mail,
    color: "#7C3AED",
    background: "#F3E8FF",
    url: `mailto:${supportEmail}?subject=${encodeURIComponent("Hotel Automation support")}`,
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    description: "Start a quick chat with a specialist",
    value: supportWhatsApp || "Message support",
    action: "Open",
    icon: MessageCircle,
    color: "#168A52",
    background: "#E8F8EF",
    url: whatsappUrl(supportWhatsApp),
  },
  {
    id: "telegram",
    title: "Telegram",
    description: "Message our support account",
    value: supportTelegram || "Message support",
    action: "Open",
    icon: Send,
    color: "#168AC0",
    background: "#E8F5FB",
    url: telegramUrl(supportTelegram),
  },
];

export function SupportScreen() {
  const open = async (method: ContactMethod) => {
    if (!method.url) {
      Alert.alert(
        `${method.title} support is being connected`,
        `For now, email us at ${supportEmail}. We usually reply within 5 minutes.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Write email", onPress: () => void Linking.openURL(`mailto:${supportEmail}`) },
        ],
      );
      return;
    }

    try {
      await Linking.openURL(method.url);
    } catch {
      Alert.alert("Could not open this channel", `Please email us at ${supportEmail}.`);
    }
  };

  return (
    <View style={uiStyles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <View style={styles.supportMark}><MessageCircle size={22} color={theme.colors.action} /></View>
          <View style={styles.headingCopy}>
            <Text style={uiStyles.h2}>Support</Text>
            <Text style={uiStyles.caption}>Choose the easiest way to reach us</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}><Clock3 size={24} color={theme.colors.action} /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>We reply in about 5 minutes</Text>
            <Text style={styles.heroText}>Our support team can help with setup, connections, messages and incoming requests.</Text>
          </View>
          <View style={styles.onlinePill}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Support online</Text></View>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Contact support</Text>
          <Text style={styles.sectionCaption}>Phone, email or message us — whichever is more convenient.</Text>
        </View>

        <View style={styles.grid}>
          {methods.map((method) => {
            const Icon = method.icon;
            return (
              <Pressable
                key={method.id}
                accessibilityRole="button"
                accessibilityLabel={`${method.title}: ${method.value}`}
                onPress={() => void open(method)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={[styles.methodIcon, { backgroundColor: method.background }]}>
                  <Icon size={23} color={method.color} />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.methodTitle}>{method.title}</Text>
                  <Text style={styles.methodDescription}>{method.description}</Text>
                  <Text numberOfLines={1} style={styles.methodValue}>{method.value}</Text>
                </View>
                <View style={styles.action}>
                  <Text style={styles.actionText}>{method.action}</Text>
                  <ArrowUpRight size={17} color={theme.colors.action} />
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.tip}>
          <Text style={styles.tipTitle}>To help us solve it faster</Text>
          <Text style={styles.tipText}>Tell us your hotel name, what you were trying to do, and attach a screenshot if there is an error.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function whatsappUrl(value: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const digits = value.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

function telegramUrl(value: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, "").trim();
  return handle ? `https://t.me/${handle}` : null;
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    paddingHorizontal: theme.controls.contentInset,
    paddingTop: theme.spacing[5],
    paddingBottom: theme.spacing[10],
    gap: theme.spacing[5],
  },
  heading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  headingCopy: { flex: 1, gap: 2 },
  supportMark: { width: 48, height: 48, borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint, alignItems: "center", justifyContent: "center" },
  hero: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[4], padding: theme.spacing[5], borderRadius: theme.radii.lg, backgroundColor: theme.colors.actionTint, borderWidth: 1, borderColor: "#CFE0FF" },
  heroIcon: { width: 50, height: 50, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 220, gap: theme.spacing[1] },
  heroTitle: { ...theme.typography.h2, color: theme.colors.text },
  heroText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, maxWidth: 620 },
  onlinePill: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], backgroundColor: theme.colors.surface, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2] },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success },
  onlineText: { ...theme.typography.captionMedium, color: theme.colors.success },
  sectionTitle: { ...theme.typography.h3, color: theme.colors.text },
  sectionCaption: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, marginTop: theme.spacing[1] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  card: { minWidth: 280, flexGrow: 1, flexBasis: 440, minHeight: 142, flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  methodIcon: { width: 46, height: 46, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center" },
  cardCopy: { flex: 1, minWidth: 0, gap: 3 },
  methodTitle: { ...theme.typography.bodyMedium, color: theme.colors.text },
  methodDescription: { ...theme.typography.caption, color: theme.colors.textSecondary },
  methodValue: { ...theme.typography.bodySmallMedium, color: theme.colors.text, marginTop: theme.spacing[2] },
  action: { flexDirection: "row", alignItems: "center", gap: 2, paddingTop: 2 },
  actionText: { ...theme.typography.captionMedium, color: theme.colors.action },
  tip: { padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceMuted, gap: theme.spacing[1] },
  tipTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  tipText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
});
