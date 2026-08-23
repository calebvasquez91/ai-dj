"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";

function LoginForm() {
  const router = useRouter();
  const callbackUrl = useSearchParams().get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn("credentials", { email, password, redirect: false });
      if (!result || result.error) {
        setError("Incorrect email or password.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="card-retro w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-2xl retro-heading">AI DJ</span>
          <div className="retro-stripe w-24" />
        </div>
        <h1 className="text-lg font-semibold">Log in</h1>

        {error && <p className="text-sm text-accent-pink font-medium">{error}</p>}

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-full bg-background px-4 py-2 outline-none border-2 border-border focus:border-accent-purple"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-full bg-background px-4 py-2 outline-none border-2 border-border focus:border-accent-purple"
          />
        </label>

        <button type="submit" disabled={loading} className="btn-retro justify-center">
          {loading ? "Logging in…" : "Log in"}
        </button>

        <p className="text-sm text-muted text-center">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent-purple hover:text-accent-pink font-medium">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
