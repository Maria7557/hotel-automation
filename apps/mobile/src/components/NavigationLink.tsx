import type { ComponentProps } from "react";
import { Platform, Pressable } from "react-native";
import { shouldOpenInApp } from "../navigation/detail-href";

type Props = Omit<ComponentProps<typeof Pressable>, "onPress"> & { href: string; onPress: () => void };

// Keep normal browser links (including opening a new tab) and native navigation.
export function NavigationLink({ href, onPress, ...props }: Props) {
  return <Pressable {...props} accessibilityRole="link" {...(Platform.OS === "web" ? { href } : {})} onPress={(event) => {
    event.stopPropagation();
    if (Platform.OS === "web") {
      if (!shouldOpenInApp(event.nativeEvent as unknown as Parameters<typeof shouldOpenInApp>[0])) return;
      event.preventDefault();
    }
    onPress();
  }} />;
}
