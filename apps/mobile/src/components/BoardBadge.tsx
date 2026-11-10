import { Pressable, StyleSheet, Text, View } from "react-native";
import { boardAppearance, theme } from "@hotel/design";
import type { MealPlan } from "@/api/types";

const names = { BB: "Bed and breakfast", HB: "Half board", FB: "Full board" };

export function BoardBadge({ mealPlan, selected = false, selectable = false }: { mealPlan: MealPlan | null; selected?: boolean; selectable?: boolean }) {
  if (!mealPlan) return <View style={styles.missing}><Text selectable={selectable} style={styles.missingText}>Board needed</Text></View>;
  const appearance = boardAppearance[mealPlan];
  return <View accessible accessibilityLabel={`${mealPlan} · ${names[mealPlan]}`} style={[styles.badge, { backgroundColor: appearance.background, borderColor: selected ? theme.colors.textSecondary : appearance.border }]}>
    <Text selectable={selectable} style={[styles.code, { color: appearance.text }]}>{mealPlan}</Text>
    <View aria-hidden style={[styles.line, { backgroundColor: appearance.track }]}>
      <View style={{ height: "100%", width: `${appearance.segments / 3 * 100}%`, backgroundColor: appearance.fill }} />
    </View>
  </View>;
}

export function BoardSelector({ value, onChange, disabled = false }: { value: MealPlan; onChange: (value: MealPlan) => void; disabled?: boolean }) {
  return <View accessibilityRole="radiogroup" accessibilityLabel="Board basis" style={styles.selector}>
    {(["BB", "HB", "FB"] as const).map((board) => <Pressable key={board} accessibilityRole="radio" accessibilityState={{ checked: value === board, disabled }} accessibilityLabel={`${board} · ${names[board]}`} disabled={disabled} onPress={() => onChange(board)} style={({ pressed }) => [styles.choice, (pressed || disabled) && { opacity: 0.7 }]}>
      <BoardBadge mealPlan={board} selected={value === board} />
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "center", width: 29, height: 26, alignItems: "center", justifyContent: "center", borderWidth: 0, borderRadius: 0, overflow: "hidden", paddingBottom: 2 },
  code: { ...theme.typography.bodySmallMedium, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  line: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3 },
  missing: { alignSelf: "flex-start", borderRadius: theme.radii.md, padding: 8, backgroundColor: theme.colors.dangerTint },
  missingText: { ...theme.typography.captionMedium, color: theme.colors.danger },
  selector: { flexDirection: "row", gap: 8, marginVertical: theme.spacing[2] },
  choice: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
});
