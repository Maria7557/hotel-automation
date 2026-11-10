import { translateLabel } from "../i18n";
import { useId } from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@hotel/design";
import type { SelectFieldProps } from "./SelectField";

export function SelectField({ label, value, options, onChange, disabled = false, error }: SelectFieldProps) {
  const errorId = useId();
  return <View style={styles.wrap}>
    <Text style={styles.label}>{translateLabel(label)}</Text>
    <select aria-label={translateLabel(label)} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} onKeyUp={(event) => { if (event.key === "Escape") event.stopPropagation(); }} style={{
      minHeight: theme.controls.inputHeight, width: "100%", minWidth: 0, padding: "0 16px", boxSizing: "border-box",
      border: `${error ? 2 : 1}px solid ${error ? theme.colors.danger : theme.colors.borderStrong}`, borderRadius: theme.radii.md,
      backgroundColor: theme.colors.surface, color: theme.colors.text, fontFamily: "Inter_400Regular, sans-serif", fontSize: 16,
    }}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    {error ? <Text nativeID={errorId} accessibilityRole="alert" style={styles.error}>{translateLabel(error)}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ wrap: { gap: theme.spacing[2] }, label: { ...theme.typography.bodySmallMedium, color: theme.colors.text }, error: { ...theme.typography.caption, color: theme.colors.danger } });
