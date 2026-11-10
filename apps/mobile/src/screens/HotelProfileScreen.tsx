import { t, translateLabel, getLanguage, locale } from "../i18n";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, Building2, Check, ChevronDown, Globe2, ImageIcon, MapPin, X } from "lucide-react-native";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import type { HotelProfile, HotelProfileInput } from "@/api/types";
import { Button, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";

export function HotelProfileScreen({
  onBack,
  onSaved,
  initialProfile,
  demo,
}: {
  onBack: () => void;
  onSaved: (profile: HotelProfile) => void;
  initialProfile: HotelProfile;
  demo: boolean;
}) {
  const [profile, setProfile] = useState<HotelProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [activeSelector, setActiveSelector] = useState<"country" | "city" | null>(null);

  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [countryCode, setCountryCode] = useState("IT");
  const [locale, setLocale] = useState("en-GB");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [photoUrlsText, setPhotoUrlsText] = useState("");
  const [termsText, setTermsText] = useState("");

  const applyProfile = (next: HotelProfile) => {
    setProfile(next);
    setName(next.name);
    setCity(next.city);
    setCountryCode(next.countryCode || "IT");
    setLocale(next.locale || "it-IT");
    setEmail(next.email);
    setPhone(next.phone);
    setWebsite(next.website);
    setDescription(next.description);
    setLogoUrl(next.logoUrl);
    setPhotoUrlsText(next.photoUrls.join("\n"));
    setTermsText(next.termsText);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try { applyProfile(await apiClient.getHotel()); }
    catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (demo) {
      applyProfile(initialProfile);
      setLoading(false);
      return;
    }
    void load();
  }, [demo, initialProfile]);

  const photoUrls = parseUrlList(photoUrlsText);
  const countryOptions = getCountryOptions(countryCode, locale, city);
  const selectedCountry = countryOptions.find((country) => country.code === countryCode.toUpperCase()) ?? countryOptions[0]!;
  const cityOptions = selectedCountry.cities.includes(city) || !city ? selectedCountry.cities : [city, ...selectedCountry.cities];
  const invalidLogo = Boolean(logoUrl.trim()) && !isHttpUrl(logoUrl.trim());
  const invalidWebsite = Boolean(website.trim()) && !isHttpUrl(website.trim());
  const invalidPhoto = photoUrls.find((url) => !isHttpUrl(url));
  const valid =
    name.trim().length >= 2 && city.trim().length >= 2 && /^[A-Za-z]{2}$/.test(countryCode.trim()) &&
    locale.trim().length >= 2 && (!email.trim() || email.includes("@")) && !invalidLogo && !invalidWebsite &&
    !invalidPhoto && photoUrls.length <= 20;

  const save = async () => {
    setSubmitted(true);
    setError(null);
    if (!valid) return;
    const input: HotelProfileInput = {
      name: name.trim(),
      city: city.trim(),
      countryCode: countryCode.trim().toUpperCase(),
      locale: locale.trim(),
      email: email.trim(),
      phone: phone.trim(),
      website: website.trim(),
      description: description.trim(),
      logoUrl: logoUrl.trim(),
      photoUrls,
      termsText: termsText.trim(),
    };
    setSaving(true);
    try {
      const next = demo ? { ...initialProfile, ...input } : await apiClient.updateHotel(input);
      applyProfile(next);
      onSaved(next);
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <ArrowLeft size={22} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{t("Hotel profile")}</Text>
          <View style={{ width: 44 }} />
        </View>

        {error ? <InlineState tone="danger">{translateLabel(error)}</InlineState> : null}
        {demo ? <InlineState tone="warning">{t("Demo mode: changes are kept only until you exit")}</InlineState> : null}
        {loading || !profile ? (
          <View style={styles.loading} accessibilityLabel={t("Loading hotel profile")}>
            <ActivityIndicator size="large" color={theme.colors.action} />
            <Text style={styles.loadingText}>{t("Loading profile…")}</Text>
            {error ? <Button variant="secondary" onPress={() => void load()}>{t("Try again")}</Button> : null}
          </View>
        ) : (
          <>
            <View style={styles.identityPreview}>
              <RemoteImage uri={logoUrl.trim()} variant="logo" fallback={<Building2 size={30} color={theme.colors.action} />} />
              <View style={{ flex: 1 }}>
                <Text style={styles.previewName}>{name || t("Hotel name")}</Text>
                <Text style={styles.previewMeta}>{[city, countryCode.toUpperCase()].filter(Boolean).join(", ")}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <SectionTitle>{t("Basic information")}</SectionTitle>
              <Field label={t("Name")} value={name} onChangeText={setName} editable={!saving} error={submitted && name.trim().length < 2 ? t("Enter a name") : undefined} />
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <SelectField
                    label={t("Country")}
                    value={`${selectedCountry.name} · ${selectedCountry.code}`}
                    icon={Globe2}
                    disabled={saving}
                    error={submitted && !/^[A-Za-z]{2}$/.test(countryCode.trim()) ? t("Select a country") : undefined}
                    onPress={() => setActiveSelector("country")}
                  />
                </View>
                <View style={styles.fieldHalf}><Field label={t("Locale")} value={locale} onChangeText={setLocale} autoCapitalize="none" editable={!saving} helper={t("For example, en-GB")} /></View>
              </View>
              <SelectField
                label={t("City")}
                value={city || t("Select a city")}
                placeholder={!city}
                icon={MapPin}
                disabled={saving || !selectedCountry}
                error={submitted && city.trim().length < 2 ? t("Select a city") : undefined}
                onPress={() => setActiveSelector("city")}
              />
              <Field label={t("Description")} value={description} onChangeText={setDescription} multiline numberOfLines={5} editable={!saving} style={styles.textArea} />
            </View>

            <View style={styles.section}>
              <SectionTitle>{t("Contact details")}</SectionTitle>
              <Field label={t("Hotel email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!saving} error={submitted && email.trim() && !email.includes("@") ? t("Check the email address") : undefined} />
              <Field label={t("Phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!saving} placeholder="+39 055 000 0000" />
              <Field label={t("Website")} value={website} onChangeText={setWebsite} keyboardType="url" autoCapitalize="none" editable={!saving} placeholder="https://hotel.example" error={submitted && invalidWebsite ? t("Enter a complete URL starting with http:// or https://") : undefined} />
            </View>

            <View style={styles.section}>
              <SectionTitle>{t("Logo and photos")}</SectionTitle>
              <Field label={t("Logo URL")} value={logoUrl} onChangeText={setLogoUrl} keyboardType="url" autoCapitalize="none" editable={!saving} placeholder="https://…/logo.png" error={submitted && invalidLogo ? t("Enter a complete image URL") : undefined} />
              <Field
                label={t("Photo URLs")}
                value={photoUrlsText}
                onChangeText={setPhotoUrlsText}
                autoCapitalize="none"
                editable={!saving}
                multiline
                numberOfLines={6}
                style={styles.urlsArea}
                helper={t("Up to 20 URLs, one per line or separated by commas")}
                error={submitted && invalidPhoto ? t("Check this URL: {{v0}}", { v0: invalidPhoto }) : submitted && photoUrls.length > 20 ? t("You can add up to 20 photos") : undefined}
              />
              {photoUrls.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
                  {photoUrls.filter(isHttpUrl).map((url, index) => <RemoteImage key={`${url}-${index}`} uri={url} variant="photo" fallback={<ImageIcon size={23} color={theme.colors.textMuted} />} />)}
                </ScrollView>
              ) : (
                <View style={styles.noPhotos}><ImageIcon size={23} color={theme.colors.textMuted} /><Text style={styles.noPhotosText}>{t("No photos added yet")}</Text></View>
              )}
            </View>

            <View style={styles.section}>
              <SectionTitle>{t("Offer terms")}</SectionTitle>
              <Field label={t("Guest terms")} value={termsText} onChangeText={setTermsText} multiline numberOfLines={6} editable={!saving} style={styles.textArea} placeholder={t("Availability is confirmed by the hotel…")} />
            </View>

            <Button onPress={() => void save()} loading={saving} icon={Check}>{t("Save profile")}</Button>
          </>
        )}
      </ScrollView>
      <OptionModal
        visible={activeSelector === "country"}
        title={t("Select country")}
        subtitle={t("Italy is prioritised for the initial market.")}
        selected={countryCode.toUpperCase()}
        options={countryOptions.map((country) => ({ value: country.code, label: country.name, meta: country.code }))}
        onClose={() => setActiveSelector(null)}
        onSelect={(code) => {
          const next = countryOptions.find((country) => country.code === code);
          if (!next) return;
          setCountryCode(next.code);
          setLocale(next.locale);
          setCity(next.cities[0] ?? "");
          setActiveSelector(null);
        }}
      />
      <OptionModal
        visible={activeSelector === "city"}
        title={t("Select city")}
        subtitle={t("{{v0}} · offline list", { v0: selectedCountry.name })}
        selected={city}
        options={cityOptions.map((option) => ({ value: option, label: option }))}
        onClose={() => setActiveSelector(null)}
        onSelect={(nextCity) => {
          setCity(nextCity);
          setActiveSelector(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

type SelectOption = { value: string; label: string; meta?: string };

function SelectField({
  label,
  value,
  placeholder = false,
  icon: Icon,
  disabled,
  error,
  onPress,
}: {
  label: string;
  value: string;
  placeholder?: boolean;
  icon: typeof MapPin;
  disabled: boolean;
  error?: string | undefined;
  onPress: () => void;
}) {
  return (
    <View style={styles.selectWrap}>
      <Text style={styles.selectLabel}>{translateLabel(label)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityState={{ disabled, expanded: false }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.select, error && styles.selectError, pressed && styles.pressed, disabled && styles.selectDisabled]}
      >
        <Icon size={18} color={theme.colors.action} />
        <Text numberOfLines={1} style={[styles.selectValue, placeholder && styles.selectPlaceholder]}>{value}</Text>
        <ChevronDown size={18} color={theme.colors.textMuted} />
      </Pressable>
      {error ? <Text style={styles.selectErrorText}>{translateLabel(error)}</Text> : null}
    </View>
  );
}

function OptionModal({
  visible,
  title,
  subtitle,
  selected,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  selected: string;
  options: SelectOption[];
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Close selector")} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{translateLabel(title)}</Text>
              <Text style={styles.sheetSubtitle}>{translateLabel(subtitle)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("Close")} onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <X size={22} color={theme.colors.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.optionList}>
            {options.map((option) => {
              const isSelected = option.value === selected;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelect(option.value)}
                  style={({ pressed }) => [styles.option, isSelected && styles.optionSelected, pressed && styles.optionPressed]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{translateLabel(option.label)}</Text>
                    {option.meta ? <Text style={styles.optionMeta}>{option.meta}</Text> : null}
                  </View>
                  {isSelected ? <Check size={20} color={theme.colors.action} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type CountryOption = {
  code: string;
  name: string;
  locale: string;
  cities: string[];
};

const countries: CountryOption[] = [
  {
    code: "IT",
    name: "Italy",
    locale: "it-IT",
    cities: [
      "Rome", "Milan", "Naples", "Turin", "Palermo", "Genoa", "Bologna", "Florence", "Bari", "Catania",
      "Venice", "Verona", "Messina", "Padua", "Trieste", "Taranto", "Brescia", "Parma", "Modena", "Prato",
      "Perugia", "Ravenna", "Livorno", "Cagliari", "Foggia", "Rimini", "Salerno", "Ferrara", "Sassari", "Latina",
      "Monza", "Syracuse", "Pescara", "Bergamo", "Forlì", "Trento", "Vicenza", "Terni", "Bolzano", "Novara",
      "Piacenza", "Ancona", "Lecce", "Pisa", "Lucca", "Siena", "Como", "Arezzo", "Matera", "Sorrento",
      "Amalfi", "Positano", "Taormina", "Sanremo", "Ravello", "Alberobello", "Cortina d’Ampezzo", "Bellagio",
    ],
  },
  { code: "FR", name: "France", locale: "fr-FR", cities: ["Paris", "Nice", "Lyon", "Marseille", "Bordeaux", "Toulouse", "Strasbourg", "Cannes"] },
  { code: "ES", name: "Spain", locale: "es-ES", cities: ["Madrid", "Barcelona", "Valencia", "Seville", "Málaga", "Palma", "Bilbao", "Granada"] },
  { code: "DE", name: "Germany", locale: "de-DE", cities: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Düsseldorf", "Stuttgart", "Dresden"] },
  { code: "AT", name: "Austria", locale: "de-AT", cities: ["Vienna", "Salzburg", "Innsbruck", "Graz", "Linz", "Kitzbühel"] },
  { code: "CH", name: "Switzerland", locale: "de-CH", cities: ["Zurich", "Geneva", "Basel", "Bern", "Lausanne", "Lucerne", "Lugano", "Interlaken"] },
  { code: "PT", name: "Portugal", locale: "pt-PT", cities: ["Lisbon", "Porto", "Faro", "Funchal", "Braga", "Coimbra"] },
  { code: "GR", name: "Greece", locale: "el-GR", cities: ["Athens", "Thessaloniki", "Heraklion", "Rhodes", "Chania", "Mykonos", "Santorini"] },
  { code: "HR", name: "Croatia", locale: "hr-HR", cities: ["Zagreb", "Dubrovnik", "Split", "Zadar", "Rovinj", "Pula"] },
  { code: "GB", name: "United Kingdom", locale: "en-GB", cities: ["London", "Edinburgh", "Manchester", "Birmingham", "Liverpool", "Bath", "Oxford"] },
  { code: "IE", name: "Ireland", locale: "en-IE", cities: ["Dublin", "Cork", "Galway", "Killarney", "Limerick"] },
  { code: "NL", name: "Netherlands", locale: "nl-NL", cities: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Maastricht"] },
  { code: "BE", name: "Belgium", locale: "nl-BE", cities: ["Brussels", "Bruges", "Antwerp", "Ghent", "Liège"] },
  { code: "US", name: "United States", locale: "en-US", cities: ["New York", "Los Angeles", "Miami", "San Francisco", "Chicago", "Las Vegas", "Boston"] },
];

function getCountryOptions(currentCode: string, currentLocale: string, currentCity: string): CountryOption[] {
  const normalized = currentCode.trim().toUpperCase();
  const displayNames = new Intl.DisplayNames([getLanguage()], { type: "region" });
  const translatedCountries = countries.map((country) => ({ ...country, name: displayNames.of(country.code) ?? country.name }));
  if (!normalized || countries.some((country) => country.code === normalized)) return translatedCountries;
  return [
    ...translatedCountries,
    {
      code: normalized,
      name: t("Current country ({{v0}})", { v0: normalized }),
      locale: currentLocale || "en-GB",
      cities: currentCity ? [currentCity] : [],
    },
  ];
}

function RemoteImage({ uri, variant, fallback }: { uri: string; variant: "logo" | "photo"; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  const frameStyle = variant === "logo" ? styles.logoFrame : styles.photoFrame;
  if (!uri || failed || !isHttpUrl(uri)) return <View style={[frameStyle, styles.imageFallback]}>{fallback}</View>;
  return <Image source={{ uri }} accessibilityLabel={variant === "logo" ? t("Hotel logo") : t("Hotel photo")} resizeMode="cover" onError={() => setFailed(true)} style={frameStyle} />;
}

function parseUrlList(value: string): string[] {
  return [...new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function isHttpUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; }
  catch { return false; }
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  pressed: { opacity: 0.65 },
  headerTitle: { ...theme.typography.h3, color: theme.colors.text },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: theme.spacing[4] },
  loadingText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  identityPreview: { flexDirection: "row", alignItems: "center", gap: theme.spacing[4], backgroundColor: theme.colors.actionTint, borderRadius: theme.radii.lg, padding: theme.spacing[4] },
  logoFrame: { width: 70, height: 70, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface },
  photoFrame: { width: 132, height: 96, borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceMuted },
  imageFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border },
  previewName: { ...theme.typography.h3, color: theme.colors.text },
  previewMeta: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, marginTop: theme.spacing[1] },
  section: { gap: theme.spacing[4], marginTop: theme.spacing[3] },
  fieldRow: { flexDirection: "row", gap: theme.spacing[3] },
  fieldHalf: { flex: 1 },
  selectWrap: { gap: theme.spacing[2] },
  selectLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  select: { minHeight: theme.controls.inputHeight, flexDirection: "row", alignItems: "center", gap: theme.spacing[2], borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing[4] },
  selectError: { borderWidth: 2, borderColor: theme.colors.danger },
  selectDisabled: { opacity: 0.5 },
  selectValue: { flex: 1, ...theme.typography.body, color: theme.colors.text },
  selectPlaceholder: { color: theme.colors.textMuted },
  selectErrorText: { ...theme.typography.captionMedium, color: theme.colors.danger },
  textArea: { minHeight: 116, paddingTop: theme.spacing[3], textAlignVertical: "top" },
  urlsArea: { minHeight: 132, paddingTop: theme.spacing[3], textAlignVertical: "top" },
  gallery: { gap: theme.spacing[3], paddingVertical: theme.spacing[1] },
  noPhotos: { minHeight: 74, borderRadius: theme.radii.md, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.borderStrong, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing[2] },
  noPhotosText: { ...theme.typography.bodySmall, color: theme.colors.textMuted },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(32,32,32,0.45)" },
  sheet: { maxHeight: "78%", backgroundColor: theme.colors.background, borderTopLeftRadius: theme.radii.xl, borderTopRightRadius: theme.radii.xl, paddingTop: theme.spacing[4], paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[8] },
  sheetHeader: { minHeight: 64, flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], paddingBottom: theme.spacing[3], borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  sheetTitle: { ...theme.typography.h3, color: theme.colors.text },
  sheetSubtitle: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: theme.spacing[1] },
  closeButton: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  optionList: { gap: theme.spacing[2], paddingTop: theme.spacing[3] },
  option: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[2], borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  optionSelected: { backgroundColor: theme.colors.actionTint, borderColor: theme.colors.action },
  optionPressed: { opacity: 0.7 },
  optionLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  optionLabelSelected: { color: theme.colors.action },
  optionMeta: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
});
