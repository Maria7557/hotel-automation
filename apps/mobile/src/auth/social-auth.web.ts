import { ApiError } from "@/api/client";

export type SocialAuthProvider = "google" | "apple";

type GoogleCredentialResponse = { credential?: string };
type GooglePromptMoment = {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  getNotDisplayedReason: () => string;
  getSkippedReason: () => string;
};
type GoogleIdentityServices = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select: boolean;
        cancel_on_tap_outside: boolean;
        context: "signin";
        use_fedcm_for_prompt: boolean;
      }) => void;
      prompt: (callback?: (notification: GooglePromptMoment) => void) => void;
      cancel: () => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let googleScriptPromise: Promise<GoogleIdentityServices> | null = null;

export async function getSocialIdentityToken(provider: SocialAuthProvider): Promise<string> {
  if (provider === "apple") {
    throw new ApiError(
      "SOCIAL_AUTH_UNAVAILABLE",
      "Apple sign-in is available in the iPhone app. Use Google or email on the web for now.",
    );
  }
  return signInWithGoogle();
}

async function signInWithGoogle(): Promise<string> {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  if (!clientId) {
    throw new ApiError(
      "SOCIAL_AUTH_NOT_CONFIGURED",
      "Google sign-in needs a Google Web client ID. Add it to the app configuration and redeploy.",
    );
  }

  const google = await loadGoogleIdentityServices();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => finish(() => response.credential
        ? resolve(response.credential)
        : reject(new ApiError("SOCIAL_AUTH_FAILED", "Google did not return a valid identity token."))),
      auto_select: false,
      cancel_on_tap_outside: true,
      context: "signin",
      use_fedcm_for_prompt: true,
    });
    google.accounts.id.prompt((notification) => {
      if (!notification.isNotDisplayed() && !notification.isSkippedMoment()) return;
      const reason = notification.isNotDisplayed()
        ? notification.getNotDisplayedReason()
        : notification.getSkippedReason();
      finish(() => reject(new ApiError(
        "SOCIAL_AUTH_UNAVAILABLE",
        `Google sign-in could not open (${reason}). Allow third-party sign-in or use email instead.`,
      )));
    });
  });
}

function loadGoogleIdentityServices(): Promise<GoogleIdentityServices> {
  if (window.google) return Promise.resolve(window.google);
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<GoogleIdentityServices>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-hotel-google-identity]");
    const script = existing ?? document.createElement("script");
    const handleLoad = () => window.google
      ? resolve(window.google)
      : reject(new ApiError("SOCIAL_AUTH_UNAVAILABLE", "Google sign-in did not load correctly."));
    const handleError = () => reject(new ApiError(
      "SOCIAL_AUTH_UNAVAILABLE",
      "Google sign-in could not be loaded. Check the network and try again.",
    ));

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.hotelGoogleIdentity = "true";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    googleScriptPromise = null;
    throw error;
  });

  return googleScriptPromise;
}
