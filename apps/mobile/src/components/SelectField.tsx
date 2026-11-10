import { translateLabel } from "../i18n";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { theme } from "@hotel/design";

export type SelectFieldProps = {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string | undefined;
};

export function SelectField({ label, value, options, onChange, disabled = false, error }: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  return <View style={styles.wrap}>
    <Text style={styles.label}>{translateLabel(label)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${(options.find((option) => option.value === value)?.label ?? value)}`} accessibilityState={{ disabled, expanded: open }} disabled={disabled} onPress={() => setOpen((current) => !current)} style={[styles.select, error && styles.invalid]}>
      <Text style={styles.value}>{(options.find((option) => option.value === value)?.label ?? value)}</Text><ChevronDown size={20} color={theme.colors.textMuted} />
    </Pressable>
    {open && !disabled ? <ScrollView nestedScrollEnabled style={styles.options} keyboardShouldPersistTaps="handled">{options.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`${label}: ${option.label}`} accessibilityState={{ checked: value === option.value }} onPress={() => { onChange(option.value); setOpen(false); }} style={[styles.option, value === option.value && styles.selected]}>
      <Text style={styles.value}>{option.label}</Text>{value === option.value ? <Check size={20} color={theme.colors.action} /> : null}
    </Pressable>)}</ScrollView> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{translateLabel(error)}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[2] }, label: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  select: { minHeight: theme.controls.inputHeight, flexDirection: "row", alignItems: "center", gap: theme.spacing[2], paddingHorizontal: theme.spacing[4], borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface },
  value: { ...theme.typography.body, color: theme.colors.text, flex: 1 }, invalid: { borderColor: theme.colors.danger, borderWidth: 2 },
  options: { maxHeight: 240, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md },
  option: { minHeight: theme.controls.minTarget, flexDirection: "row", alignItems: "center", padding: theme.spacing[3], gap: theme.spacing[2] }, selected: { backgroundColor: theme.colors.actionTint },
  error: { ...theme.typography.caption, color: theme.colors.danger },
});
