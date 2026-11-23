import { Card, CardHeader, StatGrid, StatTile } from "@/components/ui/Card";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

type Profit = {
  earned_revenue: number;
  tutor_cost_approved: number;
  tutor_cost_estimated: number;
  margin: number;
  margin_pct: number | null;
  cash_in: number;
  refunds_paid: number;
  refunds_pending: number;
  unearned_value: number;
  active_students: number;
  student_rate: number;
  tutor_rate: number;
  margin_per_hour_now: number;
  break_even_students: number | null;
  rate_warning: boolean;
};

/**
 * Class profitability. Revenue is counted from hours actually used (what students consumed), not from
 * what they paid up front, so a prepaid package does not make a class look profitable in its first
 * month and loss-making later.
 */
export async function Profitability({ classId }: { classId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("class_profitability", { p_class_id: classId });
  if (error) throw new Error(error.message);
  const p = data as Profit;
  const cost = p.tutor_cost_approved + p.tutor_cost_estimated;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">Profitability</h2>

      {p.rate_warning ? (
        <div role="alert" className="mb-3 rounded-card border border-destructive bg-destructive/5 p-3 text-sm">
          <strong className="text-destructive">Check the rates.</strong> The student rate ({formatRupiah(p.student_rate)}/h) is lower than the tutor rate ({formatRupiah(p.tutor_rate)}/h): a
          single paying student does not cover the tutor. This class needs {p.break_even_students} students per lesson to break even.
        </div>
      ) : null}

      <StatGrid>
        <StatTile label="Earned revenue" value={formatRupiah(p.earned_revenue)} hint="Hours used by students × their invoice rate" />
        <StatTile
          label="Tutor cost"
          value={formatRupiah(cost)}
          hint={p.tutor_cost_estimated > 0 ? `${formatRupiah(p.tutor_cost_approved)} approved + ${formatRupiah(p.tutor_cost_estimated)} estimated` : "All approved"}
        />
        <StatTile
          label="Margin"
          value={<span className={p.margin < 0 ? "text-destructive" : ""}>{formatRupiah(p.margin)}</span>}
          hint={p.margin_pct === null ? "No revenue yet" : `${p.margin_pct}% of earned revenue`}
        />
        <StatTile label="Paid but not delivered yet" value={formatRupiah(p.unearned_value)} hint="Hours students bought and have not used" />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Money in and out" />
          <dl className="divide-y divide-cloud text-sm">
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">Cash received (verified payments)</dt>
              <dd className="font-medium">{formatRupiah(p.cash_in)}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">Refunds repaid</dt>
              <dd className="font-medium">{formatRupiah(p.refunds_paid)}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">Refunds still to repay</dt>
              <dd className="font-medium">{formatRupiah(p.refunds_pending)}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="At today's rates" />
          <dl className="divide-y divide-cloud text-sm">
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">Active students</dt>
              <dd className="font-medium">{p.active_students}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">Margin per lesson hour</dt>
              <dd className={`font-medium ${p.margin_per_hour_now < 0 ? "text-destructive" : ""}`}>{formatRupiah(p.margin_per_hour_now)}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">Break-even head count</dt>
              <dd className="font-medium">{p.break_even_students ?? "—"} student(s)</dd>
            </div>
          </dl>
        </Card>
      </div>
    </section>
  );
}
