import { forwardRef, useRef, type ComponentRef } from "react";
import { RefreshControl as NativeRefreshControl, Switch as NativeSwitch, TextInput as NativeTextInput, type RefreshControlProps, type SwitchProps, type TextInputProps } from "react-native";
import { actions } from "./actions";

type Placement = { signalPlacement?: string };
export function Switch({ onValueChange, signalPlacement = "ui.Switch", ...props }: SwitchProps & Placement) {
  return <NativeSwitch {...props} onValueChange={onValueChange ? (value) => actions.run("ui.switch.change", signalPlacement, () => onValueChange(value), "manual") : undefined} />;
}
export function RefreshControl({ onRefresh, signalPlacement = "ui.RefreshControl", ...props }: RefreshControlProps & Placement) {
  return <NativeRefreshControl {...props} onRefresh={onRefresh ? () => actions.run("ui.list.refresh", signalPlacement, () => onRefresh(), "manual") : undefined} />;
}
// Record a committed edit, never keystrokes, text, lengths, or native event data.
export const TextInput = forwardRef<ComponentRef<typeof NativeTextInput>, TextInputProps & Placement>(function MonitoredTextInput({ onChangeText, onEndEditing, onSubmitEditing, signalPlacement = "ui.TextInput", ...props }, ref) {
  const edited = useRef(false);
  return <NativeTextInput {...props} ref={ref}
    onChangeText={(value) => { edited.current = true; onChangeText?.(value); }}
    onEndEditing={(event) => {
      if (edited.current) { edited.current = false; return actions.run("ui.field.commit", signalPlacement, () => onEndEditing?.(event), "manual"); }
      return onEndEditing?.(event);
    }}
    onSubmitEditing={(event) => { edited.current = false; return actions.run("ui.field.submit", signalPlacement, () => onSubmitEditing?.(event), "manual"); }} />;
});
