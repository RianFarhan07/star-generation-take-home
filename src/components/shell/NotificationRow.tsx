"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { markNotificationRead } from "@/app/notifications-actions";

/**
 * One notification. Clicking it (anywhere on the row) marks it as read and, when it has a link, opens the link.
 * A click with a modifier key (open in a new tab) still marks it as read but leaves the browser to open the tab.
 */
export function NotificationRow({
  id,
  title,
  body,
  link,
  unread,
  when,
}: {
  id: string;
  title: string;
  body: string;
  link: string | null;
  unread: boolean;
  when: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function open() {
    startTransition(async () => {
      if (unread) await markNotificationRead(id);
      if (link) router.push(link);
    });
  }

  return (
    <li onClick={open} className={`cursor-pointer px-4 py-3 text-sm ${unread ? "bg-gold/10" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={unread ? "font-bold" : "font-semibold"}>
          {link ? (
            <Link
              href={link}
              className="underline-offset-2 hover:underline"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                  event.stopPropagation();
                  if (unread) void markNotificationRead(id);
                  return;
                }
                event.preventDefault(); // the row handler marks it as read and then opens the link
              }}
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </span>
        <span className="text-xs text-muted">{when}</span>
      </div>
      {body ? <p className="mt-0.5 text-muted">{body}</p> : null}
    </li>
  );
}
