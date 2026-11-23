import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatWib } from "@/lib/time";
import { markAllRead } from "@/app/notifications-actions";

type NotificationRow = { id: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string };

/** The signed-in user's notifications, newest first. Shared by the three role areas. */
export async function NotificationsView() {
  const supabase = await createClient();
  const list = rows<NotificationRow>(
    await supabase.from("notifications").select("id, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(50),
  );
  const unread = list.filter((n) => n.read_at === null).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "You are up to date."}
        actions={
          unread > 0 ? (
            <ActionForm action={markAllRead}>
              <SubmitButton variant="secondary">Mark all as read</SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState title="No notifications yet" hint="Invoices, payment decisions, cancelled lessons and logbook updates show up here." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-cloud">
            {list.map((n) => (
              <li key={n.id} className={`px-4 py-3 text-sm ${n.read_at === null ? "bg-gold/10" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className={n.read_at === null ? "font-bold" : "font-semibold"}>
                    {n.link ? (
                      <Link href={n.link} className="underline-offset-2 hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </span>
                  <span className="text-xs text-muted">{formatWib(n.created_at)}</span>
                </div>
                {n.body ? <p className="mt-0.5 text-muted">{n.body}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
