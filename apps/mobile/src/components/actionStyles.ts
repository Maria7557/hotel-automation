import { StyleSheet } from "react-native";
import { theme } from "@hotel/design";

// Separate actions use the larger gap. Icons and helpers attached to a label stay close.
export const actionStyles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.controls.actionGap },
  content: { minHeight: theme.controls.actionSize, flexDirection: "row", alignItems: "center", gap: theme.controls.actionGap },
  control: { minHeight: theme.controls.actionSize, minWidth: theme.controls.actionSize, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.controls.helperGap, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[3], borderRadius: theme.radii.sm },
  iconButton: { width: theme.controls.actionSize, height: theme.controls.actionSize, flexShrink: 0, alignItems: "center", justifyContent: "center", padding: theme.spacing[3], borderRadius: theme.radii.sm },
  icon: { width: theme.controls.actionIconSize, height: theme.controls.actionIconSize, flexShrink: 0 },
  associated: { flexDirection: "row", alignItems: "center", gap: theme.controls.helperGap },
  helperContent: { minHeight: theme.controls.helperSize, flexDirection: "row", alignItems: "center", gap: theme.controls.helperGap },
  helperIconButton: { width: theme.controls.helperSize, height: theme.controls.helperSize, flexShrink: 0, alignItems: "center", justifyContent: "center", padding: theme.spacing[2], borderRadius: theme.radii.sm },
  helperIcon: { width: theme.controls.helperIconSize, height: theme.controls.helperIconSize, flexShrink: 0 },
  label: { ...theme.typography.bodySmallMedium },
});
