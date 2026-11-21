import { t } from "../i18n";
import { SelectField, type SelectFieldProps } from "./SelectField";

export function ChildAgeField(props: Omit<SelectFieldProps, "options">) {
  const options = [
    { value: "", label: t("Select age") },
    ...Array.from({ length: 18 }, (_, age) => ({
      value: String(age),
      label: age === 0 ? t("Under 1 year") : age === 1 ? t("1 year old") : t("{{v0}} years old", { v0: age }),
    })),
  ];
  return <SelectField {...props} options={options} />;
}
