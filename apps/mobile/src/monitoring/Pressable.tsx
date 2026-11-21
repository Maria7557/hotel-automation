import { forwardRef, type ComponentRef } from "react";
import { Pressable as NativePressable, type PressableProps } from "react-native";
import { actions } from "./actions";

// Keep press semantics and event arguments intact. Never inspect labels or input.
type Props = PressableProps & { signalPlacement?: string; signalAction?: string };
export const Pressable = forwardRef<ComponentRef<typeof NativePressable>, Props>(function MonitoredPressable({ onPress, onLongPress, onAccessibilityEscape, signalPlacement = "ui.Pressable", signalAction = "ui.control.press", ...props }, ref) {
  return <NativePressable {...props} ref={ref}
    onPress={onPress ? (event) => actions.run(signalAction, signalPlacement, () => onPress(event), "manual") : undefined}
    onLongPress={onLongPress ? (event) => actions.run("ui.control.long_press", signalPlacement, () => onLongPress(event), "manual") : undefined}
    onAccessibilityEscape={onAccessibilityEscape ? () => actions.run("ui.control.dismiss", signalPlacement, () => onAccessibilityEscape(), "manual") : undefined} />;
});
