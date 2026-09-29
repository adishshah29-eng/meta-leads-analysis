/**
 * Shared auth helpers for the password gate (used by src/proxy.ts and the login route).
 *
 * The cookie stores a SHA-256 digest derived from the password instead of the
 * password itself, so a leaked cookie/log line doesn't reveal the password.
 * Changing DASHBOARD_PASSWORD invalidates every existing session.
 */

export const AUTH_COOKIE = "dashboard_auth";

export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`meta-crm-session:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (avoids leaking match length via timing). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
