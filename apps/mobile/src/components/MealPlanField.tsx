import { t } from "../i18n";
import type { MealPlan } from "@hotel/contracts";
import { SelectField } from "./SelectField";

const options = [
  { value: "", label: "Select board basis" },
  { value: "BB", label: "BB · Bed and breakfast" },
  { value: "HB", label: "HB · Half board" },
  { value: "FB", label: "FB · Full board" },
];

export function MealPlanField({ value, onChange, disabled = false, error, label = t("Treatment") }: { value: MealPlan | null; onChange: (value: MealPlan | null) => void; disabled?: boolean; error?: string | undefined; label?: string }) {
  return <SelectField label={label} value={value ?? ""} options={options.map((option) => ({ ...option, label: t(option.label) }))} onChange={(next) => onChange(next === "BB" || next === "HB" || next === "FB" ? next : null)} disabled={disabled} error={error} />;
}
