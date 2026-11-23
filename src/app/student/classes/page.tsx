import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatWib } from "@/lib/time";
import { enrollInClass, joinWaitlist, leaveWaitlist } from "../actions";

type OpenClass = {
  class_id: string;
  name: string;
  description: string;
  tutor_name: string;
  package_hours: number;
  package_price: number;
  seats_left: number;
  my_enrollment_id: string | null;
  my_enrollment_status: string | null;
  on_waitlist: boolean;
  waitlist_position: number | null;
  offer_until: string | null;
};

const LIVE = ["pending_payment", "awaiting_verification", "active"];

export default async function BrowseClassesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_open_classes");
  if (error) throw new Error(error.message);
  const classes = (data ?? []) as OpenClass[];

  return (
    <>
      <PageHeader
        title="Browse classes"
        subtitle="A seat is held for you as soon as you enroll. It is released if you do not pay within 24 hours."
      />
      {classes.length === 0 ? (
        <Card>
          <EmptyState title="No classes are open right now" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {classes.map((c) => {
            const enrolled = c.my_enrollment_status !== null && LIVE.includes(c.my_enrollment_status);
            return (
              <Card key={c.class_id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{c.name}</h2>
                  {c.seats_left === 0 ? <Badge status="out_of_hours" label="Full" /> : <span className="text-xs text-muted">{c.seats_left} seat(s) left</span>}
                </div>
                <p className="mt-1 text-sm text-muted">Tutor {c.tutor_name}</p>
                {c.description ? <p className="mt-2 text-sm">{c.description}</p> : null}
                <p className="mt-3 text-sm">
                  <span className="text-lg font-bold">{formatRupiah(c.package_price)}</span>{" "}
                  <span className="text-muted">for a {c.package_hours} hour package</span>
                </p>
                <div className="mt-4">
                  {enrolled ? (
                    <p className="text-sm">
                      <Badge status={c.my_enrollment_status!} />{" "}
                      <Link href={c.my_enrollment_status === "active" ? `/student/classes/${c.class_id}` : "/student/invoices"} className="font-semibold underline-offset-2 hover:underline">
                        {c.my_enrollment_status === "active" ? "Open class" : "See invoice"}
                      </Link>
                    </p>
                  ) : c.seats_left === 0 ? (
                    c.on_waitlist ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          You are <strong>#{c.waitlist_position}</strong> on the waitlist.
                        </span>
                        <ConfirmDialog
                          triggerLabel="Leave waitlist"
                          triggerVariant="destructive"
                          title="Leave the waitlist"
                          description="You lose your place in line."
                          confirmLabel="Leave waitlist"
                          confirmVariant="destructive"
                          action={leaveWaitlist}
                          values={{ classId: c.class_id }}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-muted">This class is full.</span>
                        <ConfirmDialog
                          triggerLabel="Join waitlist"
                          triggerVariant="primary"
                          title={`Join the waitlist for ${c.name}`}
                          description="When a seat opens up, the first student in line gets it reserved for 24 hours and a notification."
                          confirmLabel="Join waitlist"
                          action={joinWaitlist}
                          values={{ classId: c.class_id }}
                        />
                      </div>
                    )
                  ) : (
                    <>
                    {c.offer_until ? (
                      <p className="mb-2 rounded-card bg-gold/15 p-2 text-sm font-semibold">
                        A seat is reserved for you until {formatWib(c.offer_until)}.
                      </p>
                    ) : null}
                    <ConfirmDialog
                      triggerLabel="Enroll"
                      triggerVariant="primary"
                      title={`Enroll in ${c.name}`}
                      description={`Your seat is held for 24 hours while you pay the ${formatRupiah(c.package_price)} invoice (${c.package_hours} hours). You get access to the schedule and logbooks once the admin has confirmed your payment.`}
                      confirmLabel="Enroll and get invoice"
                      action={enrollInClass}
                      values={{ classId: c.class_id }}
                    >
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="accept" required className="mt-1" />
                        <span>I understand there is no refund if I withdraw from the class.</span>
                      </label>
                    </ConfirmDialog>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
