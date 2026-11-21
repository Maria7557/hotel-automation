import { translateLabel } from "../i18n";
import type { ReactNode } from "react";
import { Platform, type PressableProps } from "react-native";
import { Pressable } from "@/monitoring/Pressable";
import { detailHref, shouldOpenInApp } from "../navigation/detail-href";

type Props = {
  kind: "reservation" | "client";
  id: string;
  label: string;
  onOpen: () => void;
  style?: PressableProps["style"];
  children: ReactNode;
};

// Native uses the app's detail stack. Web also gets a real, copyable link.
export function DetailLink({ kind, id, label, onOpen, style, children }: Props) {
  return <Pressable signalAction="ui.DetailLink.shouldOpenInApp.press" signalPlacement="DetailLink.shouldOpenInApp"
    {...(Platform.OS === "web" ? { href: detailHref(kind, id) } : {})}
    accessibilityRole="link"
    accessibilityLabel={translateLabel(label)}
    style={style}
    onPress={(event) => {
      event.stopPropagation();
      if (Platform.OS === "web") {
        if (!shouldOpenInApp(event.nativeEvent as unknown as Parameters<typeof shouldOpenInApp>[0])) return;
        event.preventDefault();
      }
      onOpen();
    }}
  >{children}</Pressable>;
}
