"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeCodeForTokens } from "@/lib/spotifyAuth";

// Spotify's PKCE flow is a full-page redirect (unlike YouTube's popup), so
// it needs a real route to land back on. Outside the (app) route group
// deliberately — this is a transient hop, not a page that needs the full
// app chrome (sidebar/player bar/etc).
function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // One-shot: these two are synchronous validation of the query params
    // this page landed with, not state synced from an external system —
    // there's nothing to defer to a callback.
    const errorParam = searchParams.get("error");
    if (errorParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(`Spotify: ${errorParam}`);
      return;
    }
    const code = searchParams.get("code");
    if (!code) {
      setError("Missing authorization code.");
      return;
    }
    exchangeCodeForTokens(code)
      .then(() => router.replace("/library?spotify=connected"))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to connect to Spotify."));
    // Runs once — searchParams/router are stable for the life of this one-shot exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      {error ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-accent-pink">{error}</p>
          <a href="/library" className="text-sm text-accent-purple underline">
            Back to Music Library
          </a>
        </div>
      ) : (
        <p className="text-sm text-muted">Connecting to Spotify…</p>
      )}
    </div>
  );
}

export default function SpotifyCallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  );
}
