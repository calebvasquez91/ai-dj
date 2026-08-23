"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (!result || result.error) {
        setError("Account created — log in to continue.");
        router.push("/login");
        return;
      }
      router.push("/");
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
        <h1 className="text-lg font-semibold">Create your account</h1>

        {error && <p className="text-sm text-accent-pink font-medium">{error}</p>}

        <label className="flex flex-col gap-1 text-sm">
          Name <span className="text-muted">(optional)</span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-full bg-background px-4 py-2 outline-none border-2 border-border focus:border-accent-purple"
          />
        </label>
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
          Password <span className="text-muted">(8+ characters)</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-full bg-background px-4 py-2 outline-none border-2 border-border focus:border-accent-purple"
          />
        </label>

        <button type="submit" disabled={loading} className="btn-retro justify-center">
          {loading ? "Creating account…" : "Sign up"}
        </button>

        <p className="text-sm text-muted text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-accent-purple hover:text-accent-pink font-medium">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
