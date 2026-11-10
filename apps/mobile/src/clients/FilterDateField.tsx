import { Field } from "../components/ui";

export type FilterDateFieldProps = { label: string; value: string; onChange: (value: string) => void; error?: string | undefined };

export function FilterDateField({ label, value, onChange, error }: FilterDateFieldProps) {
  return <Field label={label} value={value} onChangeText={onChange} error={error} placeholder="YYYY-MM-DD" helper="YYYY-MM-DD" maxLength={10} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" />;
}
