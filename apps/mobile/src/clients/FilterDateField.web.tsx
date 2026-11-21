import { translateLabel } from "../i18n";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@hotel/design";
import type { FilterDateFieldProps } from "./FilterDateField";
import { actions } from "../monitoring/actions";

export function FilterDateField({ label, value, onChange, error, disabled = false }: FilterDateFieldProps) {
  return <View style={styles.wrap}>
    <Text style={styles.label}>{translateLabel(label)}</Text>
    <input type="date" aria-label={translateLabel(label)} aria-invalid={Boolean(error)} value={value} disabled={disabled}
      onInput={(event) => onChange(event.currentTarget.value)} onChange={(event) => actions.run("ui.date.change", "FilterDateField.web", () => onChange(event.currentTarget.value), "manual")} style={{
      minHeight: theme.controls.inputHeight, width: "100%", minWidth: 0, boxSizing: "border-box", padding: "0 12px", borderRadius: theme.radii.md,
      border: `1px solid ${error ? theme.colors.danger : theme.colors.borderStrong}`, background: theme.colors.surface,
      color: theme.colors.text, fontSize: 16, fontFamily: "Inter_400Regular, sans-serif", colorScheme: "light",
    }} />
    {error ? <Text style={styles.error}>{translateLabel(error)}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ wrap: { gap: 8 }, label: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, error: { ...theme.typography.caption, color: theme.colors.danger } });
