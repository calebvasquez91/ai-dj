// Spotify auth via Authorization Code with PKCE — the only viable
// client-side flow now that Spotify sunset Implicit Grant (Nov 2025).
// Unlike Google's Identity Services popup, this is a full-page redirect:
// connectSpotify() navigates away to accounts.spotify.com and the app's
// /spotify/callback route (see app/spotify/callback/page.tsx) catches the
// user coming back. The PKCE code_verifier has to survive that round trip,
// so it's stashed in sessionStorage (gone if the tab closes, same spirit
// as the in-memory-only YouTube token). The refresh_token Spotify hands
// back, though, IS persisted to localStorage — a deliberate deviation from
// the YouTube "never persisted" pattern, since redoing a full-page redirect
// every single session would be a much bigger UX hit than YouTube's popup.
import { useStore } from "@/lib/store";

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
  // Counterintuitive for a read-only import feature, but Spotify's own
  // developer community confirms GET /playlists/{id}/items 403s on owned
  // playlists post-migration without these — a permission-check quirk in
  // the new endpoint, not an app bug. We never call any write endpoint.
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

const VERIFIER_STORAGE_KEY = "spotify_pkce_verifier";
const REFRESH_TOKEN_STORAGE_KEY = "spotify_refresh_token";

function redirectUri(): string {
  return `${window.location.origin}/spotify/callback`;
}

function generateRandomString(length: number): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => possible[v % possible.length]).join("");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Kicks off the redirect — there's nothing meaningful to return since the page navigates away. */
export async function connectSpotify(): Promise<void> {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not set — see the Spotify Developer Dashboard checklist.");
  }
  const verifier = generateRandomString(64);
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
}

function applyTokenResponse(data: TokenResponse): string {
  const expiresAt = Date.now() + data.expires_in * 1000;
  useStore.getState().setSpotifyToken(data.access_token, expiresAt);
  if (data.refresh_token) localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, data.refresh_token);
  return data.access_token;
}

/** Called from the /spotify/callback page with the `code` query param. */
export async function exchangeCodeForTokens(code: string): Promise<void> {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  if (!clientId || !verifier) throw new Error("Missing PKCE verifier — restart the connect flow.");
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) throw new Error(data.error ?? "Failed to exchange Spotify auth code.");
  applyTokenResponse(data);
}

/** Returns a valid access token, silently refreshing via the persisted refresh token if the cached one is missing/expired. Resolves null (never throws) if that fails — the caller should prompt "Connect Spotify" again. */
export async function getValidSpotifyToken(): Promise<string | null> {
  const { spotifyAccessToken, spotifyTokenExpiresAt } = useStore.getState();
  const stillValid = spotifyAccessToken && spotifyTokenExpiresAt && Date.now() < spotifyTokenExpiresAt - 30_000;
  if (stillValid) return spotifyAccessToken;

  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  if (!clientId || !refreshToken) return null;

  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
    });
    const data = (await res.json()) as TokenResponse;
    if (!res.ok || data.error) {
      // Temporary diagnostic: pin down why the Web Playback SDK gets an
      // empty token from getOAuthToken() — this refresh call failing
      // silently (expired/revoked refresh token) is one candidate cause.
      console.error("[Spotify] refresh_token exchange failed:", res.status, data.error ?? data);
      return null;
    }
    return applyTokenResponse(data);
  } catch (err) {
    console.error("[Spotify] refresh_token exchange threw:", err);
    return null;
  }
}

export function disconnectSpotify(): void {
  useStore.getState().setSpotifyToken(null, null);
  localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
}

/** Whether a reconnect is likely to succeed without the user clicking anything — used to show "Import from Spotify" instead of "Connect Spotify" even right after a page reload. */
export function hasSpotifyRefreshToken(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) != null;
}
