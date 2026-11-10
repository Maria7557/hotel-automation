import { t, translateLabel } from "../i18n";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@hotel/design";
import { SelectField } from "../components/SelectField";

const counts = Array.from({ length: 21 }, (_, count) => ({ value: String(count), label: String(count) }));

export function ChildrenFields({ value, onChange, disabled = false, error }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean; error?: string | undefined }) {
  const ages = [{ value: "", label: t("Select age") }, ...Array.from({ length: 18 }, (_, age) => ({ value: String(age), label: age === 0 ? t("Under 1 year") : age === 1 ? t("1 year old") : t("{{v0}} years old", { v0: age }) }))];
  return <View style={styles.fields}>
    <SelectField label={t("Children")} value={String(value.length)} options={counts} onChange={(count) => onChange(Array.from({ length: Number(count) }, (_, index) => value[index] ?? ""))} disabled={disabled} />
    {value.length ? <>
      <Text style={styles.hint}>{t("Select each child’s age at check-in to calculate the child rate.")}</Text>
      <View style={styles.ages}>{value.map((age, index) => <View key={index} style={styles.age}>
        <SelectField label={t("Child {{v0}} age", { v0: index + 1 })} value={age} options={ages} onChange={(next) => onChange(value.map((current, i) => i === index ? next : current))} disabled={disabled} error={error && !age ? t("Select the child’s age.") : undefined} />
      </View>)}</View>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{translateLabel(error)}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  fields: { gap: theme.spacing[3] }, ages: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  age: { flexGrow: 1, flexBasis: "45%", minWidth: 140 }, hint: { ...theme.typography.caption, color: theme.colors.textMuted }, error: { ...theme.typography.caption, color: theme.colors.danger },
});
