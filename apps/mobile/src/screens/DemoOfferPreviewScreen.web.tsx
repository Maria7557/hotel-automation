import { t, getLanguage } from "../i18n";
import { useMemo, useState, type SyntheticEvent } from "react";
import { resolveLanguage } from "@hotel/i18n";
import { DEMO_OFFER_PATH, renderDemoOfferPage } from "@hotel/templates";

export function isDemoOfferPreview(): boolean {
  return window.location.pathname.replace(/\/$/, "") === DEMO_OFFER_PATH;
}

export function DemoOfferPreviewScreen() {
  const [language, setLanguage] = useState(() => resolveLanguage(new URLSearchParams(window.location.search).get("lang") ?? getLanguage()));
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  // Fragment links in srcdoc otherwise resolve to the host app's URL.
  const html = useMemo(() => renderDemoOfferPage(selectedOption !== null, selectedOption ?? 0, language)
    .replaceAll('href="#', 'href="about:srcdoc#'), [selectedOption, language]);
  const onLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const document = event.currentTarget.contentDocument;
    document?.querySelectorAll<HTMLAnchorElement>('nav a[href*="lang="]').forEach((link) => link.addEventListener("click", (click) => {
      click.preventDefault();
      const value = new URL(link.href).searchParams.get("lang");
      if (value === "en" || value === "it") setLanguage(value);
    }));
    const form = document?.querySelector("form");
    form?.addEventListener("submit", (submit) => {
      submit.preventDefault();
      const option = Number(new FormData(form).get("option"));
      setSelectedOption(option);
    });
  };
  return <iframe title={t("Demo offer preview")} srcDoc={html} onLoad={onLoad} sandbox="allow-same-origin allow-forms"
    style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, background: "#f1f1f1" }} />;
}
