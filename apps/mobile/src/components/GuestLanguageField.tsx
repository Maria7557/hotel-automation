import { t, getLanguage } from "../i18n";
import { SelectField } from "./SelectField";

export function GuestLanguageField({ value, onChange, disabled = false, error }: { value: string; onChange: (value: string) => void; disabled?: boolean; error?: string | undefined }) {
  const base = value.toLowerCase().split("-")[0];
  const options = [
    { value: base === "it" ? value : "it", label: t("Italian") },
    { value: base === "en" ? value : "en", label: t("English") },
  ];
  if (base !== "it" && base !== "en") {
    let label = value;
    try { label = new Intl.DisplayNames([getLanguage()], { type: "language" }).of(value) ?? value; } catch { /* Preserve a saved guest's language. */ }
    options.push({ value, label });
  }
  return <SelectField label={t("Guest language")} value={value} options={options} onChange={onChange} disabled={disabled} error={error} />;
}
