import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { theme } from "@hotel/design";
import { t } from "../i18n";
import { InlineState } from "./ui";
import { widgetPreviewDocument, type WidgetPreviewProps } from "./widget-preview-document";

export function WidgetPreview({ device, apiOrigin, publicKey, css, language }: WidgetPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latestCss = useRef(css);
  latestCss.current = css;
  const [height, setHeight] = useState(760);
  const [failed, setFailed] = useState(false);
  const document = useMemo(() => apiOrigin ? widgetPreviewDocument(apiOrigin, publicKey, language) : "", [apiOrigin, publicKey, language]);

  const updateCss = () => frame.current?.contentWindow?.postMessage({ type: "ospio:preview-css", css: latestCss.current }, "*");
  useEffect(() => { updateCss(); }, [css]);
  useEffect(() => {
    setFailed(false);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data) return;
      if (event.data.type === "ospio:preview-ready") updateCss();
      if (event.data.type === "ospio:preview-error") setFailed(true);
      if (event.data.type === "ospio:preview-height" && Number.isFinite(event.data.height)) {
        setHeight(Math.min(10_000, Math.max(200, event.data.height)));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [document]);

  if (!apiOrigin || failed) return <InlineState tone="warning">{t("The form preview could not load. Check the API connection and reopen this screen.")}</InlineState>;
  return (
    <View style={styles.stage}>
      <iframe
        ref={frame}
        title={t("Live form preview")}
        srcDoc={document}
        sandbox="allow-scripts"
        onLoad={updateCss}
        style={{ display: "block", width: "100%", maxWidth: device === "mobile" ? 375 : undefined, height, border: 0, background: "transparent" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: "center", padding: theme.spacing[3], borderRadius: theme.radii.lg, backgroundColor: theme.colors.surfaceMuted, overflow: "hidden" },
});
