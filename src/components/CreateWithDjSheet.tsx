"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { savePlaylistFromTracks } from "@/lib/savePlaylist";
import { EXAMPLE_REQUESTS, requestCuration, useCurateUi, type CurateResult } from "@/lib/curateClient";
import { formatTime, formatTotalDuration } from "@/lib/format";
import { CloseIcon } from "@/components/Icons";
import { Chip, ChipRow, Sheet, Text } from "@/ui";

type Preview = Extract<CurateResult, { kind: "preview" }>;

/** The energy of the playlist, track by track, as a small line. */
function EnergySparkline({ energies }: { energies: number[] }) {
  if (energies.length < 2) return null;
  const points = energies.map((e, i) => `${(i / (energies.length - 1)) * 100},${22 - e * 20}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label="Energy across the playlist" className="h-10 w-full text-accent">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Create with DJ": type what you want ("90s R&B for a workout, clean only"), see a preview built from your own library
 * (title, description, count, runtime, energy line, and any shortfall with Discover suggestions), remove tracks or
 * regenerate, then save it as a normal playlist. If the request names nothing usable the DJ asks one question.
 */
export function CreateWithDjSheet() {
  const { open, initialRequest, close } = useCurateUi();
  return (
    <Sheet open={open} onClose={close} title="Create with DJ" full>
      {/* Mounted only while open, so every opening starts from a clean slate. */}
      {open && <CreateWithDjBody initialRequest={initialRequest} close={close} />}
    </Sheet>
  );
}

function CreateWithDjBody({ initialRequest, close }: { initialRequest: string; close: () => void }) {
  const router = useRouter();
  const [request, setRequest] = useState(initialRequest);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const tracks = useMemo(() => (result ? result.preview.tracks.filter((t) => !removed.has(t.id)) : []), [result, removed]);
  const runtimeSec = tracks.reduce((s, t) => s + (t.durationSec || 0), 0);

  async function run(input: Parameters<typeof requestCuration>[0]) {
    setBusy(true);
    setError(null);
    try {
      const r = await requestCuration(input);
      if (r.kind === "clarification") {
        setQuestion(r.question);
        setResult(null);
      } else {
        setQuestion(null);
        setAnswer("");
        setResult(r);
        setRemoved(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The DJ couldn't build that.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result || tracks.length === 0) return;
    setSaving(true);
    setError(null);
    const id = await savePlaylistFromTracks(result.preview.title, tracks.map((t) => t.id));
    if (!id) {
      setError("Couldn't create the playlist.");
      setSaving(false);
      return;
    }
    setSaving(false);
    close();
    router.push(`/playlist?id=${id}`);
  }

  return (
      <div className="flex flex-col gap-4 p-4">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (request.trim()) void run({ request: request.trim(), ...(question ? { answer: answer.trim() } : {}) });
          }}
        >
          <label className="text-sm font-semibold" htmlFor="dj-request">
            What do you want to hear?
          </label>
          <textarea
            id="dj-request"
            ref={inputRef}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. 90s R&B for a workout, clean only"
            className="w-full resize-none rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground"
          />
          <ChipRow label="Example requests">
            {EXAMPLE_REQUESTS.map((ex) => (
              <Chip key={ex} onClick={() => setRequest(ex)}>
                {ex}
              </Chip>
            ))}
          </ChipRow>
          {question && (
            <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-3" role="status">
              <Text variant="body">{question}</Text>
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Your answer" placeholder="Your answer" className="rounded-lg bg-surface px-3 py-2 text-sm" />
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn" disabled={busy || !request.trim() || (question != null && !answer.trim())}>
              {busy ? "Thinking…" : question ? "Answer" : result ? "Start over" : "Create"}
            </button>
          </div>
        </form>

        {error && (
          <p role="alert" className="text-sm text-accent-pink">
            {error}
          </p>
        )}

        {result && (
          <section aria-label="Playlist preview" className="flex flex-col gap-3">
            <div>
              <Text variant="title" as="h2">{result.preview.title}</Text>
              <Text variant="secondary">{result.preview.description}</Text>
              <Text variant="caption" className="mt-1">
                {tracks.length} track{tracks.length === 1 ? "" : "s"} · {formatTotalDuration(runtimeSec)}
              </Text>
            </div>
            <EnergySparkline energies={tracks.map((t) => t.energy)} />

            {result.preview.shortfall && (
              <div role="status" className="rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 p-3 text-sm">
                {result.preview.shortfall.message}
              </div>
            )}
            {result.preview.unknownYear > 0 && (
              <Text variant="caption">{result.preview.unknownYear} track{result.preview.unknownYear === 1 ? " has" : "s have"} no release year, so the era could not be checked.</Text>
            )}
            {result.preview.unknownRating > 0 && (
              <Text variant="caption">{result.preview.unknownRating} track{result.preview.unknownRating === 1 ? " has" : "s have"} no clean/explicit marking, so clean-only could not check {result.preview.unknownRating === 1 ? "it" : "them"}.</Text>
            )}
            {result.preview.notes.length > 0 && <Text variant="caption">{result.preview.notes.join(" ")}</Text>}

            {result.discover.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Text variant="heading" as="h3">Discover</Text>
                <Text variant="caption">Artists like these are not in your library. Add their music to your library first; suggestions come from Last.fm.</Text>
                <ul className="flex flex-wrap gap-1.5">
                  {result.discover.map((d) => (
                    <li key={d.artist} className="rounded-full bg-surface-raised px-3 py-1 text-xs" title={d.because}>
                      <span className="font-semibold">{d.artist}</span> <span className="text-muted">{d.because}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ol className="flex flex-col gap-1">
              {tracks.map((t, i) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-hover">
                  <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="truncate text-xs text-muted">{t.artist}{t.genre ? ` · ${t.genre}` : ""}</p>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted">{formatTime(t.durationSec)}</span>
                  <button type="button" className="btn-icon text-muted hover:text-accent-pink" aria-label={`Remove ${t.title}`} title="Remove from this playlist" onClick={() => setRemoved((prev) => new Set(prev).add(t.id))}>
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => void save()} disabled={saving || tracks.length === 0}>
                {saving ? "Saving…" : "Save as playlist"}
              </button>
              <button type="button" className="btn-outline" disabled={busy} onClick={() => void run({ spec: result.preview.spec, seed: Math.floor(Math.random() * 1_000_000) + 1, request: request.trim() })}>
                Regenerate
              </button>
            </div>
          </section>
        )}
      </div>
  );
}
