import { t, getLanguage } from "../i18n";
import { SelectField } from "./SelectField";
import { templateLanguageOptions } from "../i18n/template-languages";

export function GuestLanguageField({ value, onChange, disabled = false, error }: { value: string; onChange: (value: string) => void; disabled?: boolean; error?: string | undefined }) {
  const base = value.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  const options: Array<{ value: string; label: string }> = templateLanguageOptions().map((option) => ({
    ...option, value: option.value === base ? value : option.value,
  }));
  if (!options.some((option) => option.value === value)) {
    let label = value;
    try { label = new Intl.DisplayNames([getLanguage()], { type: "language" }).of(value) ?? value; } catch { /* Preserve a saved guest's language. */ }
    options.push({ value, label });
  }
  return <SelectField label={t("Guest language")} value={value} options={options} onChange={onChange} disabled={disabled} error={error} />;
}
