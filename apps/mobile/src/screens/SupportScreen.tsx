import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowUpRight, Clock3, Mail, MessageCircle, Phone, Send, type LucideIcon } from "lucide-react-native";
import { theme } from "@hotel/design";

import { uiStyles } from "@/components/ui";

const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || "support@chatsocials.app";
const supportPhone = process.env.EXPO_PUBLIC_SUPPORT_PHONE?.trim() || "";
const supportWhatsApp = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP?.trim() || "";
const supportTelegram = process.env.EXPO_PUBLIC_SUPPORT_TELEGRAM?.trim() || "";

type ContactMethod = {
  id: "phone" | "email" | "whatsapp" | "telegram";
  title: string;
  icon: LucideIcon;
  color: string;
  background: string;
  url: string | null;
};

const methods: ContactMethod[] = [
  { id: "whatsapp", title: "WhatsApp", icon: MessageCircle, color: "#168A52", background: "#E8F8EF", url: whatsappUrl(supportWhatsApp) },
  { id: "phone", title: "Call", icon: Phone, color: theme.colors.action, background: theme.colors.actionTint, url: supportPhone ? `tel:${supportPhone.replace(/[^+\d]/g, "")}` : null },
  { id: "telegram", title: "Telegram", icon: Send, color: "#168AC0", background: "#E8F5FB", url: telegramUrl(supportTelegram) },
  { id: "email", title: "Email", icon: Mail, color: "#7C3AED", background: "#F3E8FF", url: `mailto:${supportEmail}?subject=${encodeURIComponent("Hotel Automation support")}` },
];

export function SupportScreen() {
  const open = async (method: ContactMethod) => {
    if (!method.url) {
      Alert.alert(`${method.title} is not connected yet`, `Contact us at ${supportEmail}.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Open email", onPress: () => void Linking.openURL(`mailto:${supportEmail}`) },
      ]);
      return;
    }
    try {
      await Linking.openURL(method.url);
    } catch {
      Alert.alert("Could not open this channel", `Contact us at ${supportEmail}.`);
    }
  };

  return <View style={uiStyles.screen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={uiStyles.h1}>Support</Text>
        <View style={styles.replyPill}><Clock3 size={15} color={theme.colors.success} /><Text style={styles.replyText}>~5 min</Text></View>
      </View>
      <View style={styles.grid}>
        {methods.map((method) => {
          const Icon = method.icon;
          return <Pressable key={method.id} accessibilityRole="button" accessibilityLabel={method.title} onPress={() => void open(method)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
            <View style={[styles.icon, { backgroundColor: method.background }]}><Icon size={24} color={method.color} /></View>
            <Text style={styles.title}>{method.title}</Text>
            <ArrowUpRight size={19} color={theme.colors.textMuted} />
          </Pressable>;
        })}
      </View>
    </ScrollView>
  </View>;
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
  content: { width: "100%", maxWidth: 920, alignSelf: "center", paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[6], paddingBottom: theme.spacing[10], gap: theme.spacing[6] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[4] },
  replyPill: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2], borderRadius: theme.radii.pill, backgroundColor: theme.colors.successTint },
  replyText: { ...theme.typography.captionMedium, color: theme.colors.success },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  card: { minWidth: 280, flexGrow: 1, flexBasis: 400, minHeight: 92, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  cardPressed: { opacity: 0.7, transform: [{ scale: 0.995 }] },
  icon: { width: 48, height: 48, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center" },
  title: { ...theme.typography.bodyMedium, color: theme.colors.text, flex: 1 },
});
