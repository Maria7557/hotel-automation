import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme, type StatusColors } from "@hotel/design";

type Tone = "action" | "success" | "warning" | "danger" | "neutral";
const appearances = {
  action: { color: theme.colors.action, backgroundColor: theme.colors.actionTint },
  success: { color: theme.colors.success, backgroundColor: theme.colors.successTint },
  warning: { color: theme.colors.warning, backgroundColor: theme.colors.warningTint },
  danger: { color: theme.colors.danger, backgroundColor: theme.colors.dangerTint },
  neutral: { color: theme.colors.textMuted, backgroundColor: theme.colors.surfaceMuted },
} as const;

export function StatusPill({ label, icon, tone = "neutral", appearance = appearances[tone], selectable = false }: { label: string; icon?: ReactNode; tone?: Tone; appearance?: StatusColors; selectable?: boolean }) {
  return <View pointerEvents={selectable ? "auto" : "none"} style={[styles.pill, { borderColor: appearance.color, backgroundColor: appearance.backgroundColor }]}>
    {icon}
    <Text selectable={selectable} style={[styles.label, { color: appearance.textColor ?? appearance.color }]}>{label.charAt(0).toUpperCase() + label.slice(1)}</Text>
  </View>;
}

const styles = StyleSheet.create({
  pill: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: theme.controls.helperGap, flexShrink: 1, borderWidth: 1, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[1] },
  label: { ...theme.typography.captionMedium },
});
