import type { ReactNode } from "react";
import { Platform, Pressable, type PressableProps } from "react-native";
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
  return <Pressable
    {...(Platform.OS === "web" ? { href: detailHref(kind, id) } : {})}
    accessibilityRole="link"
    accessibilityLabel={label}
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
