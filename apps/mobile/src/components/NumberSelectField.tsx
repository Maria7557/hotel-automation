import { SelectField, type SelectFieldProps } from "./SelectField";

export function NumberSelectField({ min = 1, max = 50, emptyLabel, ...props }: Omit<SelectFieldProps, "options"> & { min?: number; max?: number; emptyLabel?: string }) {
  const values = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
  if (props.value && !values.includes(props.value)) values.push(props.value);
  return <SelectField {...props} options={[...(emptyLabel ? [{ value: "", label: emptyLabel }] : []), ...values.map((value) => ({ value, label: value }))]} />;
}
