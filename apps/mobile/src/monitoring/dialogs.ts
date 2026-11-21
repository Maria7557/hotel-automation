import { Alert as NativeAlert } from "react-native";
import { actions } from "./actions";

export const Alert: Pick<typeof NativeAlert, "alert" | "prompt"> = {
  ...NativeAlert,
  prompt: NativeAlert.prompt,
  alert(title, message, buttons, options) {
    return NativeAlert.alert(title, message, buttons?.map((button) => ({ ...button,
      onPress: (...args) => actions.run("ui.dialog.choice", "ui.Alert", () => button.onPress?.(...args), "manual"),
    })), { ...options, onDismiss: () => actions.run("ui.dialog.dismiss", "ui.Alert", () => options?.onDismiss?.(), "manual") });
  },
};
export function confirmAction(message: string) {
  return actions.run("ui.dialog.confirm", "ui.confirm", () => window.confirm(message), "manual");
}
