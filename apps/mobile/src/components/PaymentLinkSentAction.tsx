import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Info } from "lucide-react-native";
import { theme } from "@hotel/design";
import { Tooltip } from "./Tooltip";
import { actionStyles } from "./actionStyles";

const paymentLinkSentHelp = "Mark your manually sent payment link as done. Removes this task without sending a link or confirming payment.";

export function PaymentLinkSentAction({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return <View style={styles.paymentAction}>
    <Pressable accessibilityRole="button" accessibilityLabel="Mark payment link as sent" accessibilityHint={paymentLinkSentHelp} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={(event) => { event.stopPropagation(); onPress(); }} style={({ pressed }) => [StyleSheet.absoluteFill, styles.paymentButtonSurface, pressed && styles.paymentButtonPressed, busy && styles.pressed]} />
    <View pointerEvents="box-none" style={styles.paymentButtonContent}>
      <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" style={styles.paymentButtonLabel}>
        {busy ? <ActivityIndicator color={theme.colors.onAction} /> : <>
          <Text style={[styles.reviewButtonText, styles.paymentButtonText]}>Mark payment link as sent</Text>
        </>}
      </View>
      <Tooltip content={paymentLinkSentHelp}>{({ triggerProps, visible, toggle }) => <Pressable
        {...triggerProps}
        accessibilityRole="button"
        accessibilityLabel="About marking a payment link as sent"
        accessibilityState={{ expanded: visible }}
        hitSlop={theme.controls.helperHitSlop}
        onPress={(event) => { event.stopPropagation(); toggle(); }}
        style={({ pressed }) => [styles.paymentInfoButton, visible && styles.paymentInfoButtonActive, pressed && styles.pressed]}
      >
        <Info size={theme.controls.helperIconSize} color={theme.colors.actionTint} />
      </Pressable>}</Tooltip>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  reviewButtonText: { ...theme.typography.button, color: theme.colors.onAction },
  paymentAction: { marginTop: theme.spacing[2], borderRadius: theme.radii.md },
  paymentButtonSurface: { borderRadius: theme.radii.md, backgroundColor: theme.colors.action }, paymentButtonPressed: { backgroundColor: theme.colors.actionPressed },
  paymentButtonContent: { ...actionStyles.content, gap: theme.controls.helperGap, justifyContent: "center", paddingHorizontal: theme.spacing[3] },
  paymentButtonLabel: { flexShrink: 1 }, paymentButtonText: { flexShrink: 1, textAlign: "center" },
  paymentInfoButton: { ...actionStyles.helperIconButton }, paymentInfoButtonActive: { backgroundColor: "rgba(255, 255, 255, 0.16)" },
  pressed: { opacity: 0.7 },
});
