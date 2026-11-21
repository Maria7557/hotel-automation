import { monitoredAction } from "../monitoring/actions";
import { scopedApiClient } from "../api/client";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "@hotel/design";
import { forgotPasswordInputSchema, resetPasswordInputSchema } from "@hotel/contracts";

import { ApiError, apiClient, authErrorMessage } from "@/api/client";
import { validPasswordResetToken } from "@/auth/password-reset-link";
import { Button, Field, InlineState, uiStyles } from "@/components/ui";
import { t } from "@/i18n";
import { LanguageSelector } from "@/i18n/LanguageSelector";

type Props = {
  token?: string;
  initialEmail?: string;
  onBack: () => void;
};

export function PasswordRecoveryScreen({ token, initialEmail = "", onBack }: Props) {
  const [requesting, setRequesting] = useState(token === undefined);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidLink, setInvalidLink] = useState(token !== undefined && !validPasswordResetToken(token));
  const emailValid = forgotPasswordInputSchema.safeParse({ email: email.trim() }).success;
  const passwordValid = resetPasswordInputSchema.shape.password.safeParse(password).success;

  const submit = monitoredAction("action.PasswordRecoveryScreen.submit", "PasswordRecoveryScreen.submit", async (signalScope) => {
    const apiClient = scopedApiClient(signalScope);
    setSubmitted(true);
    setError(null);
    if (requesting ? !emailValid : invalidLink || !passwordValid || confirmation !== password) return;
    setLoading(true);
    try {
      if (requesting) await apiClient.forgotPassword(email.trim());
      else await apiClient.resetPassword({ token: token!, password });
      setPassword("");
      setConfirmation("");
      setSuccess(true);
    } catch (nextError) { signalScope.fail(nextError);
      if (nextError instanceof ApiError && nextError.code === "PASSWORD_RESET_INVALID") setInvalidLink(true);
      else setError(authErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  });

  const requestNewLink = () => {
    setRequesting(true);
    setInvalidLink(false);
    setSuccess(false);
    setSubmitted(false);
    setError(null);
    setPassword("");
    setConfirmation("");
  };

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.language}><LanguageSelector /></View>
        <View style={styles.header}>
          <Text style={uiStyles.h1}>{success
            ? requesting ? t("Check your email") : t("Password updated")
            : requesting ? t("Forgot password?") : t("Choose a new password")}</Text>
          <Text style={uiStyles.body}>{success
            ? requesting
              ? t("If an account with a password exists for this email, you will receive a reset link shortly.")
              : t("Your password has been updated. Sign in with your new password.")
            : requesting
              ? t("Enter your account email and we will send you a link to reset your password.")
              : t("Use 10–128 characters. You will be signed out on all devices.")}</Text>
        </View>
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        {success ? (
          <>
            {requesting ? <Text style={uiStyles.body}>{t("Check your spam folder too. You can request another link after one minute. Accounts created with Google or Apple should use that sign-in option.")}</Text> : null}
            {requesting ? <Button signalAction="ui.PasswordRecoveryScreen.requestNewLink.press" signalPlacement="PasswordRecoveryScreen.requestNewLink" variant="secondary" onPress={requestNewLink}>{t("Request another link")}</Button> : null}
          </>
        ) : invalidLink && !requesting ? (
          <>
            <InlineState tone="danger">{t("This reset link is invalid or expired. Request a new one.")}</InlineState>
            <Button signalAction="ui.PasswordRecoveryScreen.requestNewLink.press" signalPlacement="PasswordRecoveryScreen.requestNewLink" onPress={requestNewLink}>{t("Request a new link")}</Button>
          </>
        ) : (
          <>
            {requesting ? (
              <Field label={t("Work email")} placeholder="name@hotel.it" keyboardType="email-address"
                autoCapitalize="none" autoCorrect={false} autoComplete="email" value={email}
                onChangeText={setEmail} editable={!loading} maxLength={320}
                error={submitted && !emailValid ? t("Check the email address") : undefined} />
            ) : (
              <>
                <Field label={t("New password")} placeholder={t("At least 10 characters")} secureTextEntry
                  autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
                  value={password} onChangeText={setPassword} editable={!loading} maxLength={128}
                  error={submitted && !passwordValid ? t("Use 10–128 characters") : undefined} />
                <Field label={t("Confirm new password")} secureTextEntry
                  autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
                  value={confirmation} onChangeText={setConfirmation} editable={!loading} maxLength={128}
                  error={submitted && confirmation !== password ? t("Passwords do not match") : undefined} />
              </>
            )}
            <Button signalAction="ui.PasswordRecoveryScreen.submit.press" signalPlacement="PasswordRecoveryScreen.submit" loading={loading} onPress={() => void submit()}>{requesting ? t("Send reset link") : t("Save new password")}</Button>
          </>
        )}
        <Button signalAction="ui.PasswordRecoveryScreen.onBack.press" signalPlacement="PasswordRecoveryScreen.onBack" variant="tertiary" disabled={loading} onPress={onBack}>{t("Back to sign in")}</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: theme.controls.contentInset, paddingTop: theme.spacing[5], paddingBottom: 48, gap: theme.spacing[5] },
  language: { alignSelf: "flex-end" },
  header: { gap: theme.spacing[3], marginVertical: theme.spacing[4] },
});
