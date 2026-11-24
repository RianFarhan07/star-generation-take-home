"use server";

import { callRpc, type ActionState } from "@/lib/actions";
import { getSessionProfile } from "@/lib/session";

/** Marks one notification as read: the database only touches it when it belongs to the signed-in user. */
export async function markNotificationRead(id: string): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { ok: false, error: "Please sign in again." };
  return callRpc("mark_notification_read", { p_id: id }, [`/${session.role}/notifications`, `/${session.role}`]);
}

/** Marks all of the signed-in user's notifications as read (the database only touches their own rows). */
export async function markAllRead(): Promise<ActionState> {
  const session = await getSessionProfile();
  if (!session) return { ok: false, error: "Please sign in again." };
  return callRpc("mark_notifications_read", {}, [`/${session.role}/notifications`, `/${session.role}`]);
}
