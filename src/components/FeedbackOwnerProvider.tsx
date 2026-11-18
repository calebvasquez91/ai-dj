"use client";

import { createContext, useContext } from "react";

const FeedbackOwnerContext = createContext(false);

/**
 * Tells the menus whether the signed-in person may read the feedback inbox, so only they are shown the link. Decided on
 * the server (lib/feedbackAdmin.ts) in the app layout. It only decides what to show: the inbox page and its data check
 * for themselves on the server, so a hidden link is not what keeps anyone else out.
 */
export function FeedbackOwnerProvider({ isOwner, children }: { isOwner: boolean; children: React.ReactNode }) {
  return <FeedbackOwnerContext.Provider value={isOwner}>{children}</FeedbackOwnerContext.Provider>;
}

/** Whether the signed-in person is the admin (the account that owns the feedback inbox and alone edits or deletes shared songs and FX sounds): only they are shown those links and buttons. The server checks again on every request. */
export function useIsAdmin(): boolean {
  return useContext(FeedbackOwnerContext);
}
