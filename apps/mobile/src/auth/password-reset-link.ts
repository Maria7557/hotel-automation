// The token stays in the fragment so it is not sent to the web server or referrers.
export function passwordResetTokenFromHash(hash: string): string | null {
  if (!hash.startsWith("#reset-password=")) return null;
  // Keep an invalid token on the reset screen so it can offer a fresh link.
  return hash.slice("#reset-password=".length);
}

export function validPasswordResetToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
