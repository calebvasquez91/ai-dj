import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — AI DJ",
};

export default function PrivacyPage() {
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      {/* The body never scrolls (the app shell is a fixed-height frame), so this page scrolls itself: before, only the first screen of the policy could be read. */}
      <div className="min-h-full flex justify-center pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]">
      <div className="card w-full max-w-2xl p-8 max-sm:p-5 flex flex-col gap-6 my-8">
        <div className="flex flex-col gap-2">
          <span className="text-2xl wordmark">AI DJ</span>
          <h1 className="text-2xl heading">Privacy Policy</h1>
          <p className="text-xs text-muted">Last updated November 17, 2026</p>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">What this app is</h2>
          <p className="text-sm">
            AI DJ is a music-mixing tool. Songs and sound effects that people upload make up one
            shared music library, and the app plays them back as one continuous,
            automatically-mixed set.
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
          <h2 className="text-lg font-semibold text-accent-purple">Feedback you send</h2>
          <p className="text-sm">
            If you rate the app or send a comment from the feedback pop-up, we store the star
            rating, your comment, the page you were on, the app version, your browser&apos;s
            description of itself (its user agent), and your account, so we can read it and reply.
            We email it to the developer. It is only used to improve AI DJ and is never sold or
            shared with anyone else. Deleting your account deletes the feedback saved with it.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">The shared music library</h2>
          <p className="text-sm">
            Every song and sound effect that is added to AI DJ becomes part of one music library
            that every signed-in account can see and play. Whoever added a file is not shown to
            other people, and the files are only ever served to people who are signed in.
            Only the administrator can edit a song or sound or remove it from the library;
            everyone else can add files and play them.
          </p>
          <p className="text-sm">
            What stays private to you: your playlists (other people cannot see them), the songs
            you mark Must-Play or Do-Not-Play, your hot cues, and your account details. Taking a
            song out of one of your playlists never removes it from the library.
          </p>
          <p className="text-sm">
            Only upload music you have the right to share with the other people who use AI DJ.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Data sharing</h2>
          <p className="text-sm">
            We do not sell, rent, or share your personal information with any third party, and we do
            not use it for advertising. Music in the shared library is available only to people
            signed in to AI DJ.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-accent-purple">Data deletion</h2>
          <p className="text-sm">
            To request deletion of your account and its data (your details, playlists, marks and
            feedback), or the removal of a file you added to the shared library, contact us at the
            email below.
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
    </div>
  );
}
