import { t } from "../i18n";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/monitoring/Pressable";
import { boardAppearance, theme } from "@hotel/design";
import type { MealPlan } from "@/api/types";

const names = { BB: "Bed and breakfast", HB: "Half board", FB: "Full board" };

export function BoardBadge({ mealPlan, selected = false, selectable = false }: { mealPlan: MealPlan | null; selected?: boolean; selectable?: boolean }) {
  if (!mealPlan) return <View style={styles.missing}><Text selectable={selectable} style={styles.missingText}>{t("Board needed")}</Text></View>;
  const appearance = boardAppearance[mealPlan];
  return <View accessible accessibilityLabel={`${mealPlan} · ${t(names[mealPlan])}`} style={[styles.badge, { backgroundColor: appearance.background, borderColor: selected ? theme.colors.textSecondary : appearance.border }]}>
    <Text selectable={selectable} style={[styles.code, { color: appearance.text }]}>{mealPlan}</Text>
    <View aria-hidden style={[styles.line, { backgroundColor: appearance.track }]}>
      <View style={{ height: "100%", width: `${appearance.segments / 3 * 100}%`, backgroundColor: appearance.fill }} />
    </View>
  </View>;
}

export function BoardSelector({ value, onChange, disabled = false }: { value: MealPlan | null; onChange: (value: MealPlan) => void; disabled?: boolean }) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={t("Board basis")} style={styles.selector}>
    {(["BB", "HB", "FB"] as const).map((board) => {
      const selected = value === board;
      return <Pressable signalAction="ui.BoardSelector.onChange.press" signalPlacement="BoardSelector.onChange" key={board} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} aria-checked={selected} accessibilityLabel={`${board} · ${t(names[board])}`} disabled={disabled} onPress={() => onChange(board)} style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.choicePressed, disabled && styles.choiceDisabled]}>
        <View aria-hidden style={styles.choiceHeader}>
          <Text style={[styles.choiceCode, selected && styles.choiceSelectedText]}>{board}</Text>
          <View style={[styles.radio, selected && styles.radioSelected]}>
            {selected ? <View style={styles.radioDot} /> : null}
          </View>
        </View>
        <Text style={[styles.choiceName, selected && styles.choiceSelectedText]}>{t(names[board])}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "center", width: 29, height: 26, alignItems: "center", justifyContent: "center", borderWidth: 0, borderRadius: 0, overflow: "hidden", paddingBottom: 2 },
  code: { ...theme.typography.bodySmallMedium, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  line: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3 },
  missing: { alignSelf: "flex-start", borderRadius: theme.radii.md, padding: 8, backgroundColor: theme.colors.dangerTint },
  missingText: { ...theme.typography.captionMedium, color: theme.colors.danger },
  selector: { flexDirection: "row", gap: theme.spacing[2], marginVertical: theme.spacing[2] },
  choice: { flex: 1, minWidth: 0, minHeight: 108, gap: theme.spacing[2], padding: theme.spacing[3], borderWidth: 2, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface },
  choiceSelected: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  choicePressed: { opacity: 0.8 },
  choiceDisabled: { opacity: 0.5 },
  choiceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[1] },
  choiceCode: { ...theme.typography.h3, color: theme.colors.text },
  choiceName: { ...theme.typography.caption, color: theme.colors.textSecondary },
  choiceSelectedText: { color: theme.colors.onAction },
  radio: { width: 18, height: 18, borderRadius: theme.radii.pill, borderWidth: 2, borderColor: theme.colors.borderStrong, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: theme.colors.onAction },
  radioDot: { width: 8, height: 8, borderRadius: theme.radii.pill, backgroundColor: theme.colors.onAction },
});
