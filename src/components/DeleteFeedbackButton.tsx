"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type State = "idle" | "confirm" | "deleting" | "error";

/** Deletes one submission from the inbox, after asking once. The server only allows the owner; the list refreshes when it is gone. */
export function DeleteFeedbackButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");

  async function remove() {
    setState("deleting");
    try {
      const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`); // 404: already gone, which is what was wanted
      router.refresh();
    } catch {
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <button type="button" onClick={() => setState("confirm")} className="text-xs text-muted hover:text-accent-pink">
        Delete
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs" role="group" aria-label="Confirm delete">
      <span className="text-muted">{state === "error" ? "Couldn't delete. Try again?" : "Delete this feedback?"}</span>
      <button type="button" onClick={remove} disabled={state === "deleting"} className="font-semibold text-accent-pink hover:underline">
        {state === "deleting" ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" onClick={() => setState("idle")} disabled={state === "deleting"} className="text-muted hover:text-foreground">
        Cancel
      </button>
    </span>
  );
}
