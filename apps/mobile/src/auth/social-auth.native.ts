import { t } from "../i18n";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
} from "react-native-nitro-google-signin";

import { ApiError } from "@/api/client";

export type SocialAuthProvider = "google" | "apple";

export async function getSocialIdentityToken(provider: SocialAuthProvider): Promise<string> {
  if (provider === "apple") return signInWithApple();
  return signInWithGoogle();
}

async function signInWithGoogle(): Promise<string> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (!webClientId) {
    throw new ApiError(
      "SOCIAL_AUTH_NOT_CONFIGURED",
      t("Google sign-in needs the Google Web client ID in the app configuration."),
    );
  }

  GoogleOneTapSignIn.configure({
    webClientId,
    ...(iosClientId ? { iosClientId } : {}),
    offlineAccess: false,
    autoSelectOnSignIn: false,
  });
  await GoogleOneTapSignIn.checkPlayServices(true);

  let response = await GoogleOneTapSignIn.signIn();
  if (isNoSavedCredentialFoundResponse(response)) {
    response = await GoogleOneTapSignIn.presentExplicitSignIn();
  }
  if (isCancelledResponse(response)) {
    throw new ApiError("SOCIAL_AUTH_CANCELLED", t("Google sign-in was cancelled."));
  }
  if (!isSuccessResponse(response) || !response.data.idToken) {
    throw new ApiError("SOCIAL_AUTH_FAILED", t("Google did not return a valid identity token."));
  }
  return response.data.idToken;
}

async function signInWithApple(): Promise<string> {
  if (!(await AppleAuthentication.isAvailableAsync())) {
    throw new ApiError("SOCIAL_AUTH_UNAVAILABLE", t("Apple sign-in is not available on this device."));
  }

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new ApiError("SOCIAL_AUTH_FAILED", t("Apple did not return a valid identity token."));
    }
    return credential.identityToken;
  } catch (error) {
    if (isErrorCode(error, "ERR_REQUEST_CANCELED")) {
      throw new ApiError("SOCIAL_AUTH_CANCELLED", t("Apple sign-in was cancelled."));
    }
    throw error;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
