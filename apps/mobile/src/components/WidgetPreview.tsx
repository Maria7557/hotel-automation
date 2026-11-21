import { Linking, StyleSheet, Text, View } from "react-native";
import { theme } from "@hotel/design";
import { t } from "../i18n";
import { Button } from "./ui";
import type { WidgetPreviewProps } from "./widget-preview-document";

export function WidgetPreview({ apiOrigin, publicKey, language, demo }: WidgetPreviewProps) {
  return (
    <View style={styles.preview}>
      <Text style={styles.help}>{t("Save your CSS, then open the form preview in your browser. Live previews of unsaved CSS are available in the web app.")}</Text>
      <Button signalAction="ui.WidgetPreview.encodeURIComponent.press" signalPlacement="WidgetPreview.encodeURIComponent" variant="secondary" disabled={!apiOrigin || demo} onPress={() => {
        if (apiOrigin) void Linking.openURL(`${apiOrigin}/v1/public/hotels/${encodeURIComponent(publicKey)}/widget-preview?lang=${language}`);
      }}>{t("Open saved form preview")}</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { gap: theme.spacing[3], padding: theme.spacing[4], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceMuted },
  help: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
