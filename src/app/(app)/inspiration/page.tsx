"use client";

import { useState } from "react";
import { adviseStyle, type StyleAdvice } from "@/lib/dj-inspiration";

const EXAMPLES = ["techno", "hip-hop block party", "chill study session", "deep house", "wedding reception"];

export default function InspirationPage() {
  const [input, setInput] = useState("");
  const [advice, setAdvice] = useState<StyleAdvice | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setAdvice(adviseStyle(input.trim()));
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">DJ Style Advisor</h1>
        <p className="text-sm text-muted mt-1">
          Describe a mood, genre, or occasion and get a recommended genre,
          mixing technique, and a few DJs to draw inspiration from.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. techno, hip-hop block party, chill study session..."
          className="flex-1 rounded-full bg-surface px-4 py-2 text-sm outline-none border border-border focus:border-accent placeholder:text-muted"
        />
        <button
          type="submit"
          className="rounded-full bg-accent text-white text-sm font-semibold px-5 py-2 hover:bg-accent-strong shrink-0"
        >
          Get Inspired
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setInput(example);
              setAdvice(adviseStyle(example));
            }}
            className="text-xs rounded-full border border-border text-muted px-3 py-1.5 hover:text-foreground hover:bg-surface-hover"
          >
            {example}
          </button>
        ))}
      </div>

      {advice && (
        <div className="rounded-lg bg-surface p-5 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Recommended genre
            </p>
            <p className="text-lg font-semibold">{advice.genre.name}</p>
            <p className="text-sm text-muted">{advice.genre.description}</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Mixing technique
            </p>
            <p className="text-lg font-semibold">{advice.technique.name}</p>
            <p className="text-sm text-muted">{advice.technique.description}</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Transition style
            </p>
            <p className="text-lg font-semibold">{advice.transition.name}</p>
            <p className="text-sm text-muted">{advice.transition.description}</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Reference DJs
            </p>
            <div className="flex flex-col gap-2 mt-1">
              {advice.djs.map((dj) => (
                <div key={dj.name} className="text-sm">
                  <span className="font-medium">{dj.name}</span>
                  <span className="text-muted"> — {dj.signatureStyle}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-sm text-accent">{advice.rationale}</p>
          </div>
        </div>
      )}
    </div>
  );
}
