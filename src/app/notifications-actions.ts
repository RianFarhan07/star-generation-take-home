"use server";

import { callRpc, type ActionState } from "@/lib/actions";
import { getSessionProfile } from "@/lib/session";

/** Marks all of the signed-in user's notifications as read (the database only touches their own rows). */
export async function markAllRead(): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { ok: false, error: "Please sign in again." };
  return callRpc("mark_notifications_read", {}, [`/${session.role}/notifications`, `/${session.role}`]);
}
