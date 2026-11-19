import Link from "next/link";
import { genreCredits } from "@/lib/genreArt";

export const metadata = { title: "About" };

/** About the app, and the Credits for the photos on the genre cards (every photo is free to use; the licence is on the page each one links to). */
export default function AboutPage() {
  const credits = genreCredits();
  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-2xl">
      <h1 className="text-2xl heading">About</h1>
      <p className="text-sm text-muted">A DJ that mixes your own music library for you.</p>

      <section className="flex flex-col gap-2" aria-labelledby="credits-heading">
        <h2 id="credits-heading" className="text-sm font-semibold text-muted">Credits</h2>
        {credits.length === 0 ? (
          <p className="text-sm text-muted">
            The genre cards use generated colours for now. Any photo added to them is free to use, and is credited here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {credits.map((c) => (
              <li key={c.slug}>
                <span className="capitalize">{c.slug.replace(/-/g, " ")}</span>: photo by {c.credit} on{" "}
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  {c.source}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-muted">
        <Link href="/privacy" className="text-accent underline">Privacy Policy</Link>
      </p>
    </div>
  );
}
