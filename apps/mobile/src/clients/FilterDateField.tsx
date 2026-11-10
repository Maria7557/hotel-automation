import { t, translateLabel } from "../i18n";
import { Field } from "../components/ui";

export type FilterDateFieldProps = { label: string; value: string; onChange: (value: string) => void; error?: string | undefined };

export function FilterDateField({ label, value, onChange, error }: FilterDateFieldProps) {
  return <Field label={translateLabel(label)} value={value} onChangeText={onChange} error={error} placeholder={t("YYYY-MM-DD")} helper={t("YYYY-MM-DD")} maxLength={10} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" />;
}
