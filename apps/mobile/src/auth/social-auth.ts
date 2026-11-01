import { ApiError } from "@/api/client";

// TypeScript fallback. Metro selects social-auth.native.ts or social-auth.web.ts at runtime.
export type SocialAuthProvider = "google" | "apple";

export async function getSocialIdentityToken(_provider: SocialAuthProvider): Promise<string> {
  throw new ApiError("SOCIAL_AUTH_UNAVAILABLE", "Social sign-in is unavailable on this platform.");
}
