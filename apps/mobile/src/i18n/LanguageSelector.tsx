import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { theme } from "@hotel/design";
import type { Language } from "@hotel/i18n";
import { getLanguage, t } from "./index";
import { setLanguage } from "./Provider";
import { apiClient } from "../api/client";

export function LanguageSelector({ authenticated = false }: { authenticated?: boolean }) {
  useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const select = async (language: Language) => {
    setError(false);
    await setLanguage(language);
    if (authenticated) {
      setSaving(true);
      try { await apiClient.updateLanguage(language); } catch { setError(true); } finally { setSaving(false); }
    }
  };
  return <View style={styles.wrap}>
    <View accessibilityRole="radiogroup" accessibilityLabel={t("App language")} style={styles.row}>
      {([ ["en", "English"], ["it", "Italiano"] ] as const).map(([language, label]) => <Pressable key={language} accessibilityRole="radio" aria-checked={getLanguage() === language} accessibilityState={{ checked: getLanguage() === language, disabled: saving }} disabled={saving} onPress={() => void select(language)} style={[styles.option, getLanguage() === language && styles.selected]}>
        <Text style={styles.label}>{label}</Text>
      </Pressable>)}
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{t("Language saved on this device. Could not sync to your account. Try again.")}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ wrap: { gap: 8 }, row: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, option: { minHeight: 44, minWidth: 100, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border }, selected: { backgroundColor: theme.colors.actionTint, borderColor: theme.colors.action }, label: { ...theme.typography.body, color: theme.colors.text }, error: { ...theme.typography.caption, color: theme.colors.danger } });
