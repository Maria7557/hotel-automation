import { StyleSheet, Text, View } from "react-native";
import { theme } from "@hotel/design";
import type { FilterDateFieldProps } from "./FilterDateField";

export function FilterDateField({ label, value, onChange, error }: FilterDateFieldProps) {
  return <View style={styles.wrap}>
    <Text style={styles.label}>{label}</Text>
    <input type="date" aria-label={label} aria-invalid={Boolean(error)} value={value}
      onInput={(event) => onChange(event.currentTarget.value)} onChange={(event) => onChange(event.currentTarget.value)} style={{
      minHeight: theme.controls.inputHeight, width: "100%", minWidth: 0, boxSizing: "border-box", padding: "0 12px", borderRadius: theme.radii.md,
      border: `1px solid ${error ? theme.colors.danger : theme.colors.borderStrong}`, background: theme.colors.surface,
      color: theme.colors.text, fontSize: 14, fontFamily: "Inter_400Regular, sans-serif", colorScheme: "light",
    }} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ wrap: { gap: 8 }, label: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, error: { ...theme.typography.caption, color: theme.colors.danger } });
