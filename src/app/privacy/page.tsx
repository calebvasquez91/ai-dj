import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — AI DJ",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-full flex justify-center p-6">
      <div className="card w-full max-w-2xl p-8 flex flex-col gap-6 my-8">
        <div className="flex flex-col gap-2">
          <span className="text-2xl wordmark">AI DJ</span>
          <h1 className="text-2xl heading">Privacy Policy</h1>
          <p className="text-xs text-muted">Last updated September 9, 2026</p>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">What this app is</h2>
          <p className="text-sm">
            AI DJ is a personal music-mixing tool. You upload your own audio files and/or import
            playlists from a connected YouTube account, and the app plays them back as one
            continuous, automatically-mixed set.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Account information</h2>
          <p className="text-sm">
            When you sign up, we store your name (if provided), email address, and a securely
            hashed password. We never store your password in plain text. This information is
            used only to authenticate you and is never sold or shared with third parties.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Your uploaded music</h2>
          <p className="text-sm">
            Audio files you upload are stored securely under your account and are only ever
            served back to you when you&apos;re signed in. We don&apos;t analyze, share, or use
            your files for any purpose other than playing them back to you.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Connecting your YouTube account</h2>
          <p className="text-sm">
            If you choose to connect a YouTube account, AI DJ requests a single, read-only Google
            OAuth scope — <code className="text-xs bg-surface-hover px-1 py-0.5 rounded">
            https://www.googleapis.com/auth/youtube.readonly</code> — solely to list the names of
            your own playlists and read the title, channel name, duration, and thumbnail of the
            videos in a playlist you choose to import.
          </p>
          <p className="text-sm">
            This scope cannot modify, delete, or post anything to your YouTube account, and
            cannot access private data beyond your own playlists and their videos&apos; public
            metadata. AI DJ never requests access to your Google password, and never sees or
            stores it.
          </p>
          <p className="text-sm">
            Your Google access token is used only in your own browser to call YouTube&apos;s Data
            API directly — it is never sent to or stored on AI DJ&apos;s servers. When you import a
            playlist, only the resulting track metadata (title, channel/artist name, duration, and
            thumbnail URL) is saved to your AI DJ account, exactly like a locally-uploaded file&apos;s
            metadata, so the tracks can appear in your library. No video or audio content itself
            is copied, downloaded, or stored — playback of imported tracks streams directly from
            YouTube&apos;s own player.
          </p>
          <p className="text-sm">
            You can disconnect your YouTube account at any time from within the app; doing so
            immediately discards the access token from your browser. This does not delete
            playlist tracks you&apos;ve already imported — remove those from your library the same
            way you&apos;d remove any other track.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Data sharing</h2>
          <p className="text-sm">
            We do not sell, rent, or share your personal information, uploaded music, or YouTube
            data with any third party, and we do not use it for advertising.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Data deletion</h2>
          <p className="text-sm">
            To request deletion of your account and all associated data (uploaded files, imported
            track metadata, and playlists), contact us at the email below.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Contact</h2>
          <p className="text-sm">
            Questions about this policy or your data? Reach us at{" "}
            <a href="mailto:cvasquez@fortecc.com" className="text-accent-purple hover:text-accent-pink font-medium">
              cvasquez@fortecc.com
            </a>
            .
          </p>
        </section>

        <Link href="/login" className="text-sm text-accent-purple hover:text-accent-pink font-medium">
          ← Back to login
        </Link>
      </div>
    </div>
  );
}
