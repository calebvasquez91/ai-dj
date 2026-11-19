"use client";

import type { ConfirmCopy } from "@/lib/confirmCopy";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

/**
 * The one confirmation every rename, delete and removal asks (the words come from lib/confirmCopy.ts, so each names what is being
 * changed). A sheet with a plain Cancel and the action button; Escape or a tap outside cancels. `busy` greys both while the change
 * is being made.
 */
export function ConfirmSheet({
  copy,
  onConfirm,
  onCancel,
  busy = false,
}: {
  /** The words to show; null keeps the sheet closed. */
  copy: ConfirmCopy | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Sheet open={copy != null} onClose={busy ? () => {} : onCancel} title={copy?.title ?? ""}>
      {copy && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted break-words">{copy.message}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onConfirm}
              disabled={busy}
              className={copy.destructive ? "!bg-accent-pink hover:!bg-accent-pink/90" : undefined}
            >
              {copy.confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
