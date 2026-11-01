import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BedDouble, BellRing, Building2, Check, LogIn, Sparkles, Upload } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { theme } from "@hotel/design";
import { ApiError, apiClient, authErrorMessage } from "@/api/client";
import { mockProfile } from "@/api/mock";
import type { HotelProfile, SessionUser } from "@/api/types";
import { Button, Field, InlineState, uiStyles } from "@/components/ui";

type AuthStep = "welcome" | "account" | "hotel";
type AuthMode = "register" | "login";

export type SocialAuthProvider = "google" | "apple";
export type SocialAuthResult = { user: SessionUser; profile?: HotelProfile | null };

type AuthFlowProps = {
  initialUser?: SessionUser | undefined;
  onAuthenticated: (user: SessionUser, profile: HotelProfile) => void;
  onDemo: (profile: HotelProfile) => void;
  onSocialAuth?: (provider: SocialAuthProvider) => Promise<SocialAuthResult>;
};

export function AuthFlow({ initialUser, onAuthenticated, onDemo, onSocialAuth }: AuthFlowProps) {
  const [step, setStep] = useState<AuthStep>(initialUser ? "hotel" : "welcome");
  const [mode, setMode] = useState<AuthMode>("register");
  const [user, setUser] = useState<SessionUser | null>(initialUser ?? null);
  const [name, setName] = useState(initialUser?.displayName ?? "");
  const [email, setEmail] = useState(initialUser?.email ?? "");
  const [password, setPassword] = useState("");
  const [hotelName, setHotelName] = useState("");
  const [city, setCity] = useState("");
  const [countryCode, setCountryCode] = useState("IT");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialAuthProvider | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const accountValid =
    email.includes("@") && password.length >= (mode === "register" ? 10 : 1) &&
    (mode === "login" || name.trim().length >= 2);
  const hotelValid =
    hotelName.trim().length >= 2 && city.trim().length >= 2 && /^[A-Za-z]{2}$/.test(countryCode.trim());

  const openAccount = (nextMode: AuthMode) => {
    setMode(nextMode);
    setSubmitted(false);
    setRequestError(null);
    setStep("account");
  };

  const submitSocial = async (provider: SocialAuthProvider) => {
    setRequestError(null);
    if (!onSocialAuth) {
      setRequestError(`${provider === "google" ? "Google" : "Apple"} sign-in is not connected to the backend yet. Continue with email and password.`);
      return;
    }

    setSocialLoading(provider);
    try {
      const result = await onSocialAuth(provider);
      setUser(result.user);
      setName(result.user.displayName ?? "");
      setEmail(result.user.email);
      if (result.profile) {
        onAuthenticated(result.user, result.profile);
        return;
      }
      setSubmitted(false);
      setStep("hotel");
    } catch (error) {
      setRequestError(authErrorMessage(error));
    } finally {
      setSocialLoading(null);
    }
  };

  const submitAccount = async () => {
    setSubmitted(true);
    setRequestError(null);
    if (!accountValid) return;
    setLoading(true);
    try {
      const session =
        mode === "register"
          ? await apiClient.register({ displayName: name.trim(), email: email.trim(), password })
          : await apiClient.login({ email: email.trim(), password });
      setUser(session.user);

      if (mode === "register") {
        setStep("hotel");
        setSubmitted(false);
        return;
      }

      try {
        const profile = await apiClient.getHotel();
        onAuthenticated(session.user, profile);
      } catch (error) {
        if (error instanceof ApiError && error.code === "HOTEL_NOT_FOUND") {
          setStep("hotel");
          setSubmitted(false);
          return;
        }
        throw error;
      }
    } catch (error) {
      setRequestError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const submitHotel = async () => {
    setSubmitted(true);
    setRequestError(null);
    if (!hotelValid || !user) return;
    setLoading(true);
    try {
      const profile = await apiClient.createHotel({
        name: hotelName.trim(),
        city: city.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        locale: "en-GB",
        email: email.trim() || user.email,
      });
      onAuthenticated(user, {
        ...profile,
        city: profile.city || city.trim(),
        countryCode: profile.countryCode || countryCode.trim().toUpperCase(),
        locale: profile.locale || "en-GB",
      });
    } catch (error) {
      setRequestError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  if (step === "welcome") {
    return (
      <ScrollView
        style={styles.welcomeCanvas}
        contentContainerStyle={styles.welcome}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.glow} />
        <View style={styles.brandMark} accessibilityLabel="Hotel">
          <BedDouble size={30} color={theme.colors.onAction} strokeWidth={2.2} />
        </View>
        <View style={styles.welcomeCopy}>
          <Text style={styles.eyebrow}>HOTEL · STAFF</Text>
          <Text style={styles.welcomeTitle}>Every request —{`\n`}under control</Text>
          <Text style={styles.welcomeText}>
            Receive enquiries, send offers and confirm availability from your phone.
          </Text>
        </View>

        <View style={styles.featureList}>
          <Feature icon={Sparkles} title="Automatic offers" />
          <Feature icon={BellRing} title="Only important notifications" />
          <Feature icon={Building2} title="Your hotel settings" />
        </View>

        <View style={styles.welcomeActions}>
          {requestError ? <InlineState tone="warning">{requestError}</InlineState> : null}
          <SocialButton
            provider="google"
            loading={socialLoading === "google"}
            disabled={socialLoading !== null}
            onPress={() => void submitSocial("google")}
          />
          {Platform.OS === "ios" ? (
            <SocialButton
              provider="apple"
              loading={socialLoading === "apple"}
              disabled={socialLoading !== null}
              onPress={() => void submitSocial("apple")}
            />
          ) : null}
          <View style={styles.authDivider} accessibilityLabel="Or continue with email and password">
            <View style={styles.authDividerLine} />
            <Text style={styles.authDividerText}>OR USE EMAIL</Text>
            <View style={styles.authDividerLine} />
          </View>
          <Button disabled={socialLoading !== null} onPress={() => openAccount("register")}>Create account with email</Button>
          <Button disabled={socialLoading !== null} variant="secondary" icon={LogIn} onPress={() => openAccount("login")}>Sign in with password</Button>
          <Button disabled={socialLoading !== null} variant="tertiary" onPress={() => onDemo(mockProfile)}>Open demo without an account</Button>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={styles.progressRow}
          accessibilityLabel={step === "hotel" ? "Hotel profile" : mode === "login" ? "Sign in" : "Step 1 of 2"}
        >
          <View style={styles.progressActive} />
          {mode === "register" || step === "hotel" ? (
            <View style={step === "hotel" ? styles.progressActive : styles.progressIdle} />
          ) : null}
        </View>

        {!initialUser ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            disabled={loading}
            onPress={() => {
              setRequestError(null);
              setStep(step === "account" ? "welcome" : "account");
            }}
            style={styles.backButton}
          >
            <Text style={styles.backLabel}>← Back</Text>
          </Pressable>
        ) : null}

        {step === "account" ? (
          <>
            <View style={styles.formHeader}>
              <Text style={uiStyles.h1}>{mode === "login" ? "Welcome back" : "Your account"}</Text>
              <Text style={uiStyles.body}>
                {mode === "login"
                  ? "Sign in to continue managing requests."
                  : "Create a secure login to manage your hotel requests."}
              </Text>
            </View>
            {requestError ? <InlineState tone="danger">{requestError}</InlineState> : null}
            <View style={styles.fields}>
              {mode === "register" ? (
                <Field
                  label="Name"
                  placeholder="For example, Maria"
                  autoCapitalize="words"
                  value={name}
                  onChangeText={setName}
                  editable={!loading}
                  error={submitted && name.trim().length < 2 ? "Enter your name" : undefined}
                />
              ) : null}
              <Field
                label="Work email"
                placeholder="name@hotel.it"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                editable={!loading}
                error={submitted && !email.includes("@") ? "Check the email address" : undefined}
              />
              <Field
                label="Password"
                placeholder={mode === "register" ? "At least 10 characters" : "Your password"}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                editable={!loading}
                error={
                  submitted && password.length < (mode === "register" ? 10 : 1)
                    ? mode === "register" ? "Use at least 10 characters" : "Enter your password"
                    : undefined
                }
                helper={mode === "register" ? "Do not reuse your hotel email password" : undefined}
              />
            </View>
            <Button onPress={() => void submitAccount()} loading={loading}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
            <Button
              variant="tertiary"
              disabled={loading}
              onPress={() => {
                setMode(mode === "login" ? "register" : "login");
                setSubmitted(false);
                setRequestError(null);
              }}
            >
              {mode === "login" ? "No account? Create one" : "Already have an account? Sign in"}
            </Button>
          </>
        ) : (
          <>
            <View style={styles.formHeader}>
              <Text style={uiStyles.h1}>Tell us about your hotel</Text>
              <Text style={uiStyles.body}>These details will be used in offers sent to guests.</Text>
            </View>
            {requestError ? <InlineState tone="danger">{requestError}</InlineState> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add hotel logo"
              disabled={loading}
              onPress={() => Alert.alert("Logo", "Image upload will be connected to storage.")}
              style={({ pressed }) => [styles.logoUpload, pressed && { opacity: 0.72 }]}
            >
              <View style={styles.logoUploadIcon}><Upload size={22} color={theme.colors.action} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.logoUploadTitle}>Add logo</Text>
                <Text style={styles.logoUploadText}>PNG or JPG · up to 5 MB</Text>
              </View>
            </Pressable>

            <View style={styles.fields}>
              <Field
                label="Hotel name"
                placeholder="Casa Aurelia"
                value={hotelName}
                onChangeText={setHotelName}
                editable={!loading}
                error={submitted && hotelName.trim().length < 2 ? "Enter the hotel name" : undefined}
              />
              <Field
                label="City"
                placeholder="Florence"
                value={city}
                onChangeText={setCity}
                editable={!loading}
                error={submitted && city.trim().length < 2 ? "Enter the city" : undefined}
              />
              <Field
                label="Country code"
                placeholder="IT"
                autoCapitalize="characters"
                maxLength={2}
                value={countryCode}
                onChangeText={setCountryCode}
                editable={!loading}
                error={submitted && !/^[A-Za-z]{2}$/.test(countryCode.trim()) ? "Enter a two-letter code, for example IT" : undefined}
                helper="ISO country code"
              />
            </View>

            <InlineState tone="success">EUR, Europe/Rome and English are selected for the first setup</InlineState>
            <Button onPress={() => void submitHotel()} icon={Check} loading={loading}>
              Create hotel profile
            </Button>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Feature({ icon: Icon, title }: { icon: typeof Sparkles; title: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}><Icon size={20} color={theme.colors.action} /></View>
      <Text style={styles.featureLabel}>{title}</Text>
      <Check size={18} color={theme.colors.success} />
    </View>
  );
}

function SocialButton({
  provider,
  loading,
  disabled,
  onPress,
}: {
  provider: SocialAuthProvider;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const apple = provider === "apple";
  const label = apple ? "Continue with Apple" : "Continue with Google";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.socialButton,
        apple ? styles.appleButton : styles.googleButton,
        pressed && !disabled && styles.socialPressed,
        disabled && !loading && styles.socialDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={apple ? theme.colors.onAction : theme.colors.action} />
      ) : (
        <View style={styles.socialContent}>
          {apple ? <AppleLogo /> : <GoogleLogo />}
          <Text style={[styles.socialLabel, apple ? styles.appleLabel : styles.googleLabel]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function GoogleLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityLabel="Google">
      <Path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z" />
      <Path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.42l-3.24-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z" />
      <Path fill="#FBBC05" d="M6.39 13.9A6.02 6.02 0 0 1 6.07 12c0-.66.11-1.3.32-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.49l3.35-2.59Z" />
      <Path fill="#EA4335" d="M12 5.97c1.47 0 2.79.5 3.83 1.5L18.7 4.6A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z" />
    </Svg>
  );
}

function AppleLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityLabel="Apple">
      <Path
        fill="#FFFFFF"
        d="M17.05 12.54c.02-2.04 1.67-3.02 1.75-3.07a3.76 3.76 0 0 0-2.96-1.6c-1.25-.13-2.46.75-3.1.75-.65 0-1.63-.74-2.7-.72a3.95 3.95 0 0 0-3.33 2.03c-1.44 2.49-.37 6.14 1.01 8.15.69.97 1.49 2.06 2.55 2.02 1.03-.04 1.42-.65 2.66-.65 1.23 0 1.6.65 2.68.63 1.11-.02 1.81-.98 2.47-1.96a8.1 8.1 0 0 0 1.13-2.3 3.53 3.53 0 0 1-2.16-3.28Zm-2.03-5.99a3.6 3.6 0 0 0 .83-2.58 3.68 3.68 0 0 0-2.38 1.23 3.42 3.42 0 0 0-.85 2.48 3.04 3.04 0 0 0 2.4-1.13Z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  welcomeCanvas: { flex: 1, backgroundColor: theme.colors.surface },
  welcome: { flexGrow: 1, backgroundColor: theme.colors.surface, paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[10], paddingBottom: theme.spacing[5], overflow: "hidden" },
  glow: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: theme.colors.actionTint, right: -120, top: -100 },
  brandMark: { width: 58, height: 58, borderRadius: theme.radii.lg, backgroundColor: theme.colors.action, alignItems: "center", justifyContent: "center" },
  welcomeCopy: { marginTop: theme.spacing[10], gap: theme.spacing[3] },
  eyebrow: { ...theme.typography.captionMedium, color: theme.colors.action, letterSpacing: 1.5 },
  welcomeTitle: { ...theme.typography.h1, fontSize: 36, lineHeight: 43, color: theme.colors.text },
  welcomeText: { ...theme.typography.body, color: theme.colors.textSecondary, maxWidth: 330 },
  featureList: { gap: theme.spacing[3], marginTop: theme.spacing[8] },
  feature: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], borderRadius: theme.radii.md, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing[3] },
  featureIcon: { width: 36, height: 36, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  featureLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text, flex: 1 },
  welcomeActions: { marginTop: theme.spacing[8], gap: theme.spacing[2] },
  socialButton: { minHeight: theme.controls.buttonHeight, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing[5] },
  googleButton: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.borderStrong },
  appleButton: { backgroundColor: theme.colors.text, borderWidth: 1, borderColor: theme.colors.text },
  socialPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  socialDisabled: { opacity: 0.48 },
  socialContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  socialLabel: theme.typography.button,
  googleLabel: { color: theme.colors.text },
  appleLabel: { color: theme.colors.onAction },
  authDivider: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  authDividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  authDividerText: { ...theme.typography.captionMedium, color: theme.colors.textMuted, letterSpacing: 0.8 },
  formContent: { paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[5], paddingBottom: 48, gap: theme.spacing[4] },
  progressRow: { flexDirection: "row", gap: theme.spacing[2], marginBottom: theme.spacing[1] },
  progressActive: { height: 4, flex: 1, borderRadius: theme.radii.pill, backgroundColor: theme.colors.action },
  progressIdle: { height: 4, flex: 1, borderRadius: theme.radii.pill, backgroundColor: theme.colors.border },
  backButton: { minHeight: theme.controls.minTarget, justifyContent: "center", alignSelf: "flex-start" },
  backLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.action },
  formHeader: { gap: theme.spacing[2], marginTop: theme.spacing[3], marginBottom: theme.spacing[4] },
  fields: { gap: theme.spacing[5], marginVertical: theme.spacing[2] },
  logoUpload: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3], minHeight: 78, borderWidth: 1.5, borderStyle: "dashed", borderColor: theme.colors.borderStrong, borderRadius: theme.radii.lg, padding: theme.spacing[3] },
  logoUploadIcon: { width: 48, height: 48, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.actionTint },
  logoUploadTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  logoUploadText: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
});
