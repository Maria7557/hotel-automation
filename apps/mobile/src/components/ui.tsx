import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { AlertCircle, CheckCircle2, Clock3, type LucideIcon } from "lucide-react-native";
import { theme } from "@hotel/design";

type ButtonProps = {
  children: ReactNode;
  onPress: () => void;
  variant?: "primary" | "secondary" | "tertiary";
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  accessibilityHint?: string;
};

export function Button({
  children,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  icon: Icon,
  accessibilityHint,
}: ButtonProps) {
  const blocked = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "tertiary" && styles.buttonTertiary,
        pressed && !blocked && styles.buttonPressed,
        blocked && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? theme.colors.onAction : theme.colors.action} />
      ) : (
        <View style={styles.buttonContent}>
          {Icon ? (
            <Icon
              size={19}
              strokeWidth={2.2}
              color={variant === "primary" ? theme.colors.onAction : theme.colors.action}
            />
          ) : null}
          <Text
            style={[
              styles.buttonLabel,
              variant === "primary" ? styles.buttonLabelPrimary : styles.buttonLabelSecondary,
            ]}
          >
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  error?: string | undefined;
  helper?: string | undefined;
};

export function Field({ label, error, helper, style, ...inputProps }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        accessibilityHint={error ?? helper}
        style={[styles.field, error ? styles.fieldError : undefined, style]}
        placeholderTextColor={theme.colors.textMuted}
        selectionColor={theme.colors.action}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!error && helper ? <Text style={styles.helperText}>{helper}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={styles.emptyState} accessibilityRole="summary">
      <View style={styles.emptyIcon}>
        <Clock3 size={24} color={theme.colors.action} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

export function InlineState({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger";
  children: ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? AlertCircle : Clock3;
  const color =
    tone === "success"
      ? theme.colors.success
      : tone === "danger"
        ? theme.colors.danger
        : theme.colors.warning;
  const backgroundColor =
    tone === "success"
      ? theme.colors.successTint
      : tone === "danger"
        ? theme.colors.dangerTint
        : theme.colors.warningTint;

  return (
    <View style={[styles.inlineState, { backgroundColor }]}>
      <Icon size={18} color={color} />
      <Text style={[styles.inlineStateText, { color }]}>{children}</Text>
    </View>
  );
}

export const uiStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[10] },
  h1: { ...theme.typography.h1, color: theme.colors.text },
  h2: { ...theme.typography.h2, color: theme.colors.text },
  h3: { ...theme.typography.h3, color: theme.colors.text },
  body: { ...theme.typography.body, color: theme.colors.textSecondary },
  caption: { ...theme.typography.caption, color: theme.colors.textMuted },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
  } satisfies ViewStyle,
});

const styles = StyleSheet.create({
  button: {
    minHeight: theme.controls.buttonHeight,
    borderRadius: theme.radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[5],
  },
  buttonPrimary: { backgroundColor: theme.colors.action },
  buttonSecondary: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.action,
  },
  buttonTertiary: { backgroundColor: "transparent", minHeight: theme.controls.minTarget },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.48 },
  buttonContent: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  buttonLabel: theme.typography.button,
  buttonLabelPrimary: { color: theme.colors.onAction },
  buttonLabelSecondary: { color: theme.colors.action },
  fieldWrap: { gap: theme.spacing[2] },
  fieldLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  field: {
    minHeight: theme.controls.inputHeight,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing[4],
    ...theme.typography.body,
    color: theme.colors.text,
  },
  fieldError: { borderWidth: 2, borderColor: theme.colors.danger },
  errorText: { ...theme.typography.captionMedium, color: theme.colors.danger },
  helperText: { ...theme.typography.caption, color: theme.colors.textMuted },
  sectionTitleRow: {
    minHeight: theme.controls.minTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { ...theme.typography.h4, color: theme.colors.text },
  emptyState: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[8],
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.actionTint,
    marginBottom: theme.spacing[3],
  },
  emptyTitle: { ...theme.typography.h4, color: theme.colors.text, textAlign: "center" },
  emptyDescription: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginTop: theme.spacing[2],
  },
  inlineState: {
    minHeight: theme.controls.minTarget,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inlineStateText: { ...theme.typography.bodySmallMedium, flex: 1 },
});
