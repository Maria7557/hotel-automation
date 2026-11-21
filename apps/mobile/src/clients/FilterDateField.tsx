import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/monitoring/Pressable";
import { CalendarDays } from "lucide-react-native";
import { theme } from "@hotel/design";
import { t, translateLabel, locale } from "../i18n";
import { SelectField } from "../components/SelectField";
import { Button } from "../components/ui";

export type FilterDateFieldProps = { label: string; value: string; onChange: (value: string) => void; error?: string | undefined; disabled?: boolean };

export function FilterDateField({ label, value, onChange, error, disabled = false }: FilterDateFieldProps) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState(["", "", ""]);
  const year = Number(parts[0]), month = Number(parts[1]);
  const days = year && month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
  const selected = parts[0] && parts[1] && parts[2] ? `${parts[0]}-${parts[1]!.padStart(2, "0")}-${Math.min(Number(parts[2]), days).toString().padStart(2, "0")}` : "";
  const currentYear = new Date().getFullYear();
  const today = new Date();
  const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const validValue = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  return <View style={styles.wrap}>
    <Text style={styles.label}>{translateLabel(label)}</Text>
    <Pressable signalAction="ui.FilterDateField.setParts.press" signalPlacement="FilterDateField.setParts" accessibilityRole="button" accessibilityLabel={translateLabel(label)} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { setParts((validValue ? value : todayValue).split("-")); setOpen(true); }} style={[styles.input, error && styles.invalid]}>
      <Text style={styles.value}>{validValue ? new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : t("Select date")}</Text><CalendarDays size={20} color={theme.colors.textMuted} />
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{translateLabel(error)}</Text> : null}
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}><ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent}>
        <Text style={styles.label}>{translateLabel(label)}</Text>
        <SelectField label={t("Year")} value={parts[0] ?? ""} options={Array.from({ length: currentYear + 21 - 1900 }, (_, index) => ({ value: String(1900 + index), label: String(1900 + index) }))} onChange={(next) => setParts((current) => [next, current[1]!, current[2]!])} />
        <SelectField label={t("Month")} value={String(Number(parts[1]))} options={Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: new Intl.DateTimeFormat(locale(), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 1))) }))} onChange={(next) => setParts((current) => [current[0]!, next, current[2]!])} />
        <SelectField label={t("Day")} value={String(Math.min(Number(parts[2]), days))} options={Array.from({ length: days }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onChange={(next) => setParts((current) => [current[0]!, current[1]!, next])} />
        <Button signalAction="ui.FilterDateField.onChange.press" signalPlacement="FilterDateField.onChange" disabled={!selected} onPress={() => { onChange(selected); setOpen(false); }}>{t("Confirm date")}</Button>
        <Button signalAction="ui.FilterDateField.onChange.press" signalPlacement="FilterDateField.onChange" variant="tertiary" onPress={() => { onChange(""); setOpen(false); }}>{t("Clear date")}</Button>
        <Button signalAction="ui.FilterDateField.setOpen.press" signalPlacement="FilterDateField.setOpen" variant="tertiary" onPress={() => setOpen(false)}>{t("Cancel")}</Button>
      </ScrollView></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  wrap: { gap: 8 }, label: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, value: { ...theme.typography.body, color: theme.colors.text, flex: 1 },
  input: { minHeight: theme.controls.inputHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface },
  invalid: { borderColor: theme.colors.danger }, error: { ...theme.typography.caption, color: theme.colors.danger },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(20,30,50,.35)" }, dialog: { width: "100%", maxWidth: 440, maxHeight: "92%", borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, flexGrow: 0 }, dialogContent: { gap: 12, padding: 20 },
});
