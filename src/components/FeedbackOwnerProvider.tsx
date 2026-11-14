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

export function useIsFeedbackOwner(): boolean {
  return useContext(FeedbackOwnerContext);
}
