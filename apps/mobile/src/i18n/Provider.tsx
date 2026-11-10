import { useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { I18nextProvider } from "react-i18next";
import { resolveLanguage, supportedLanguage, type Language } from "@hotel/i18n";
import { getLanguage, i18n } from "./index";

const preferenceKey = "hotel.ui.language";
async function readPreference(): Promise<string | null> {
  try { return Platform.OS === "web" ? localStorage.getItem(preferenceKey) : await SecureStore.getItemAsync(preferenceKey); }
  catch { return null; }
}
function persist(language: string) {
  if (Platform.OS === "web") {
    document.documentElement.lang = language;
    document.cookie = `hotel_language=${language}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try { localStorage.setItem(preferenceKey, language); } catch { /* The choice still works when storage is disabled. */ }
  } else { void SecureStore.setItemAsync(preferenceKey, language).catch(() => {}); }
}
export async function setLanguage(language: Language) {
  await i18n.changeLanguage(language);
  persist(language);
}
export function TranslationProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void readPreference().then(async (saved) => {
      const device = Platform.OS === "web" ? navigator.languages?.find((value) => supportedLanguage(value)) ?? navigator.language : getLocales().find(({ languageTag }) => supportedLanguage(languageTag))?.languageTag;
      await i18n.changeLanguage(supportedLanguage(saved) ?? resolveLanguage(device));
      if (active) { persist(getLanguage()); setReady(true); }
    });
    const changed = (language: string) => persist(language);
    i18n.on("languageChanged", changed);
    const storageChanged = (event: StorageEvent) => { if (event.key === preferenceKey && supportedLanguage(event.newValue)) void i18n.changeLanguage(resolveLanguage(event.newValue)); };
    if (Platform.OS === "web") window.addEventListener("storage", storageChanged);
    return () => { active = false; i18n.off("languageChanged", changed); if (Platform.OS === "web") window.removeEventListener("storage", storageChanged); };
  }, []);
  return ready ? <I18nextProvider i18n={i18n}>{children}</I18nextProvider> : null;
}
