import { t, translateLabel } from "../i18n";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@hotel/design";
import { SelectField } from "../components/SelectField";
import { ChildAgeField } from "../components/ChildAgeField";

const counts = Array.from({ length: 21 }, (_, count) => ({ value: String(count), label: String(count) }));

type ChildrenProps = { value: string[]; onChange: (value: string[]) => void; disabled?: boolean; error?: string | undefined };

export function ChildrenCountField({ value, onChange, disabled = false }: ChildrenProps) {
  return <SelectField label={t("Children")} value={String(value.length)} options={counts} onChange={(count) => onChange(Array.from({ length: Number(count) }, (_, index) => value[index] ?? ""))} disabled={disabled} />;
}

export function ChildAgeFields({ value, onChange, disabled = false, error }: ChildrenProps) {
  return <View style={styles.fields}>
    {value.length ? <>
      <Text style={styles.hint}>{t("Select each child’s age at check-in to calculate the child rate.")}</Text>
      <View style={styles.ages}>{value.map((age, index) => <View key={index} style={styles.age}>
        <ChildAgeField label={t("Child {{v0}} age", { v0: index + 1 })} value={age} onChange={(next) => onChange(value.map((current, i) => i === index ? next : current))} disabled={disabled} error={error && !age ? t("Select the child’s age.") : undefined} />
      </View>)}</View>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{translateLabel(error)}</Text> : null}
  </View>;
}

export function ChildrenFields(props: ChildrenProps) {
  return <View style={styles.fields}><ChildrenCountField {...props} /><ChildAgeFields {...props} /></View>;
}

const styles = StyleSheet.create({
  fields: { gap: theme.spacing[3] }, ages: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  age: { flexGrow: 1, flexBasis: 120, minWidth: 120 }, hint: { ...theme.typography.caption, color: theme.colors.textMuted }, error: { ...theme.typography.caption, color: theme.colors.danger },
});
