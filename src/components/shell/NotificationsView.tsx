import { ActionForm } from "@/components/ui/ActionForm";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatWib } from "@/lib/time";
import { markAllRead } from "@/app/notifications-actions";
import { NotificationRow } from "./NotificationRow";

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
              <NotificationRow
                key={n.id}
                id={n.id}
                title={n.title}
                body={n.body}
                link={n.link}
                unread={n.read_at === null}
                when={formatWib(n.created_at)}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
