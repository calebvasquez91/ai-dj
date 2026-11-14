/**
 * The one server-side check that the signed-in person is the feedback owner, used by the inbox page and by the delete
 * route so they can't drift apart. Returns the session for the owner and null for everyone else (signed out included).
 */
import { auth } from "@/auth";
import { isFeedbackAdmin } from "@/lib/feedbackAdmin";

export async function feedbackOwnerSession() {
  const session = await auth();
  return session && isFeedbackAdmin(session.user?.id) ? session : null;
}
