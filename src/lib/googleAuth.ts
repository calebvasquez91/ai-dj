// Google Identity Services (GIS) token client — gets a short-lived,
// read-only YouTube Data API access token straight in the browser, with no
// backend involved and no client secret. The token lives only in the
// zustand store (in-memory, never persisted to localStorage) and is never
// sent to our own server; only the client calls the Data API directly with
// it (see lib/youtubeApi.ts). See the plan's Google Cloud Console checklist
// for the one-time setup this depends on (NEXT_PUBLIC_GOOGLE_CLIENT_ID).
import { useStore } from "@/lib/store";

const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

interface TokenResponse {
  access_token?: string;
  expires_in?: number; // seconds
  error?: string;
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string }) => void;
  }) => TokenClient;
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleAccountsOAuth2 } };
  }
}

let scriptLoadPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not in a browser."));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

async function getTokenClient(): Promise<TokenClient> {
  await loadGisScript();
  if (tokenClient) return tokenClient;
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set — see the Google Cloud Console checklist to create one."
    );
  }
  if (!window.google) throw new Error("Google Identity Services failed to load.");
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: YOUTUBE_READONLY_SCOPE,
    callback: () => {}, // overridden per-call below
  });
  return tokenClient;
}

function requestToken(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    getTokenClient()
      .then((client) => {
        // GIS's callback/error_callback aren't per-request options on the
        // client returned by initTokenClient — re-init isn't needed, but we
        // do need a fresh promise per call, so we swap the client's
        // callback by re-requesting through a wrapper closure instead.
        (client as unknown as { callback: (r: TokenResponse) => void }).callback = (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error ?? "No access token returned."));
            return;
          }
          const expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
          useStore.getState().setYoutubeToken(response.access_token, expiresAt);
          resolve(response.access_token);
        };
        client.requestAccessToken({ prompt });
      })
      .catch(reject);
  });
}

/** Interactive connect (or reconnect once the token has expired and silent refresh fails) — shows Google's consent popup on first use. */
export function connectYouTube(): Promise<string> {
  return requestToken("consent");
}

/** Returns a valid access token, silently refreshing if the cached one is missing/expired and the user's Google session is still alive. Resolves null (never throws) if that fails — the caller should fall back to prompting "Connect YouTube" again. */
export async function getValidAccessToken(): Promise<string | null> {
  const { youtubeAccessToken, youtubeTokenExpiresAt } = useStore.getState();
  const stillValid = youtubeAccessToken && youtubeTokenExpiresAt && Date.now() < youtubeTokenExpiresAt - 30_000;
  if (stillValid) return youtubeAccessToken;
  try {
    return await requestToken("");
  } catch {
    return null;
  }
}

export function disconnectYouTube(): void {
  useStore.getState().setYoutubeToken(null, null);
}
