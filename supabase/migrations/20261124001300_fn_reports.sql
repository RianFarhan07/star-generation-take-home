-- Reports for the three improvements and the tutor's roster. Every number is computed from the source
-- tables (invoices, payments, lessons, earnings, refunds) at the moment of the call, with the same
-- helper functions the rest of the system uses, so a figure here can never disagree with another page.

-- Internal: the balance row of one enrollment without an access check (callers check access themselves).
create function _balance(p_enrollment_id uuid, p_now timestamptz default now())
returns table (
  purchased_minutes int,
  used_minutes int,
  remaining_minutes int,
  remaining_value bigint,
  next_lesson_id uuid,
  next_lesson_covered boolean,
  low_hours boolean,
  out_of_hours boolean
)
language sql stable security definer set search_path = public as $$
  with e as (select * from enrollments where id = p_enrollment_id),
  p as (select coalesce(sum(hours * 60), 0)::int as purchased from invoices where enrollment_id = p_enrollment_id and status = 'paid'),
  u as (select coalesce(sum(split_minutes), 0)::int as used from _ledger(p_enrollment_id, p_now)),
  n as (
    select l.id, l.duration_minutes from lessons l, e
    where l.class_id = e.class_id and l.status = 'scheduled' and l.starts_at > p_now
      and (e.ended_at is null or l.starts_at < e.ended_at)
    order by l.starts_at limit 1
  )
  select p.purchased, u.used, p.purchased - u.used, _remaining_value(p_enrollment_id, p_now), n.id,
         case when n.id is null then null else (p.purchased - u.used) >= n.duration_minutes end,
         (p.purchased - u.used) <= 180,
         (p.purchased - u.used) < coalesce(n.duration_minutes, 1)
  from p cross join u left join n on true
$$;

-- ---------------------------------------------------------------- I1: money and hours overview (admin)

create function admin_overview(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_balances jsonb;
  v_attention jsonb;
  v_classes jsonb;
  v_stats jsonb;
begin
  perform require_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
           'enrollment_id', e.id, 'student_name', p.full_name, 'class_name', c.name,
           'purchased_minutes', b.purchased_minutes, 'used_minutes', b.used_minutes,
           'remaining_minutes', b.remaining_minutes, 'low_hours', b.low_hours, 'out_of_hours', b.out_of_hours
         ) order by b.remaining_minutes, p.full_name), '[]'::jsonb)
    into v_balances
  from enrollments e
  join profiles p on p.id = e.student_id
  join classes c on c.id = e.class_id
  cross join lateral _balance(e.id, p_now) b
  where e.status = 'active';

  -- Things the admin has to act on, oldest first (overdue ones on top).
  select coalesce(jsonb_agg(to_jsonb(a) order by a.overdue desc, a.since), '[]'::jsonb) into v_attention
  from (
    select 'verify_payment' as kind, pay.id as id, p.full_name as who,
           'Rp' || to_char(pay.amount, 'FM999,999,999,999') || ' · ' || coalesce(pay.bank, 'transfer') as detail,
           case when pay.no_seat then 'no_seat' else 'awaiting_verification' end as status,
           pay.reported_at as since, pay.reported_at < p_now - interval '24 hours' as overdue,
           pay.invoice_id as link_id
    from payments pay
    join invoices i on i.id = pay.invoice_id
    join enrollments e on e.id = i.enrollment_id
    join profiles p on p.id = e.student_id
    where pay.status = 'pending'
    union all
    select 'review_logbook', lb.id, c.name,
           (select count(*) from logbook_entries le where le.logbook_id = lb.id) || ' entries · ' || to_char(lb.month, 'Mon YYYY'),
           'submitted', lb.submitted_at, false, lb.id
    from logbooks lb join classes c on c.id = lb.class_id
    where lb.status = 'submitted'
    union all
    select 'renewal_unpaid', i.id, p.full_name,
           'Rp' || to_char(i.amount, 'FM999,999,999,999') || ' · ' || round(_remaining_minutes(e.id, p_now) / 60.0, 1) || ' h left',
           'unpaid', i.issued_at, false, i.id
    from invoices i
    join enrollments e on e.id = i.enrollment_id
    join profiles p on p.id = e.student_id
    where i.kind = 'renewal' and i.status = 'unpaid' and e.status = 'active'
    union all
    select 'refund_pending', r.id, p.full_name,
           'Rp' || to_char(r.amount, 'FM999,999,999,999') || ' · ' || replace(r.cause::text, '_', ' '),
           'pending', r.created_at, false, r.id
    from refunds r
    join enrollments e on e.id = r.enrollment_id
    join profiles p on p.id = e.student_id
    where r.status = 'pending'
  ) a;

  select coalesce(jsonb_agg(jsonb_build_object(
           'class_id', c.id, 'name', c.name, 'capacity', c.capacity,
           'seats_taken', (select count(*) from enrollments e
                           where e.class_id = c.id and e.status in ('pending_payment', 'awaiting_verification', 'active'))
         ) order by c.name), '[]'::jsonb)
    into v_classes
  from classes c;

  select jsonb_build_object(
    'outstanding', coalesce((select sum(i.amount) from invoices i join enrollments e on e.id = i.enrollment_id
                             where i.status in ('unpaid', 'awaiting_verification')
                               and e.status in ('pending_payment', 'awaiting_verification', 'active')), 0),
    'to_verify', (select count(*) from payments where status = 'pending'),
    'to_verify_overdue', (select count(*) from payments where status = 'pending' and reported_at < p_now - interval '24 hours'),
    'low_hours', (select count(*) from jsonb_array_elements(v_balances) x where (x ->> 'low_hours')::boolean),
    'out_of_hours', (select count(*) from jsonb_array_elements(v_balances) x where (x ->> 'out_of_hours')::boolean),
    'pending_refunds', (select count(*) from refunds where status = 'pending'),
    'pending_refunds_total', coalesce((select sum(amount) from refunds where status = 'pending'), 0)
  ) into v_stats;

  return jsonb_build_object('stats', v_stats, 'attention', v_attention, 'balances', v_balances, 'classes', v_classes);
end $$;

-- ---------------------------------------------------------------- I2: class profitability (admin)

-- Revenue is what the students have CONSUMED (hours used x the rate of the invoice they came from), not
-- what they paid up front: a prepaid package would make a class look profitable in its first month and
-- loss-making later. Cash and the not-yet-delivered balance are shown next to it.
create function class_profitability(p_class_id uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rate class_rates;
  v_earned bigint;
  v_approved bigint;
  v_estimated bigint;
  v_margin bigint;
  v_cash bigint;
  v_refunds_paid bigint;
  v_refunds_pending bigint;
  v_unearned bigint;
  v_active int;
begin
  perform require_admin();
  if not exists (select 1 from classes where id = p_class_id) then perform fail('NOT_FOUND', 'class not found'); end if;
  v_rate := current_class_rate(p_class_id, p_now);

  select coalesce(sum((l.split_minutes * l.rate_per_hour + 30) / 60), 0) into v_earned
  from enrollments e cross join lateral _ledger(e.id, p_now) l
  where e.class_id = p_class_id;

  select coalesce(sum(amount), 0) into v_approved from tutor_earnings where class_id = p_class_id;

  select coalesce(sum(x.amount), 0) into v_estimated
  from lessons l cross join lateral lesson_earning(l.id) x
  where l.class_id = p_class_id and l.status = 'scheduled' and l.ends_at <= p_now
    and not exists (select 1 from tutor_earnings t where t.lesson_id = l.id);

  select coalesce(sum(pay.amount), 0) into v_cash
  from payments pay join invoices i on i.id = pay.invoice_id join enrollments e on e.id = i.enrollment_id
  where e.class_id = p_class_id and pay.status = 'verified';

  select coalesce(sum(r.amount) filter (where r.status = 'refunded'), 0),
         coalesce(sum(r.amount) filter (where r.status = 'pending'), 0)
    into v_refunds_paid, v_refunds_pending
  from refunds r join enrollments e on e.id = r.enrollment_id
  where e.class_id = p_class_id;

  select coalesce(sum(_remaining_value(e.id, p_now)), 0), count(*) into v_unearned, v_active
  from enrollments e where e.class_id = p_class_id and e.status = 'active';

  v_margin := v_earned - v_approved - v_estimated;

  return jsonb_build_object(
    'earned_revenue', v_earned,
    'tutor_cost_approved', v_approved,
    'tutor_cost_estimated', v_estimated,
    'margin', v_margin,
    'margin_pct', case when v_earned > 0 then round(v_margin::numeric * 100 / v_earned, 1) end,
    'cash_in', v_cash,
    'refunds_paid', v_refunds_paid,
    'refunds_pending', v_refunds_pending,
    'unearned_value', v_unearned,
    'active_students', v_active,
    'student_rate', v_rate.student_rate_per_hour,
    'tutor_rate', v_rate.tutor_rate_per_hour,
    'margin_per_hour_now', v_active * v_rate.student_rate_per_hour - v_rate.tutor_rate_per_hour,
    'break_even_students', case when v_rate.student_rate_per_hour > 0
                                then ceil(v_rate.tutor_rate_per_hour::numeric / v_rate.student_rate_per_hour)::int end,
    'rate_warning', v_rate.student_rate_per_hour < v_rate.tutor_rate_per_hour
  );
end $$;

-- ---------------------------------------------------------------- I3: tutor earnings statement

-- A tutor's own lessons with what each one earns. Approved lessons use the frozen earning row, the rest
-- use the same lesson_earning() the admin preview and the approval use, so the estimate equals the final
-- amount unless a lesson gets cancelled during review. Student rates never appear here.
create function tutor_earnings_statement(p_month date default null)
returns table (
  lesson_id uuid,
  class_id uuid,
  class_name text,
  starts_at timestamptz,
  minutes int,
  rate_per_hour bigint,
  amount bigint,
  status text,         -- scheduled | taught | submitted | approved
  has_entry boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth_role() is distinct from 'tutor' then
    perform fail('NOT_ALLOWED', 'only a tutor has an earnings statement');
  end if;
  return query
    select l.id, l.class_id, c.name, l.starts_at,
           coalesce(t.minutes, e.minutes), coalesce(t.rate_per_hour, e.rate_per_hour), coalesce(t.amount, e.amount),
           case when t.id is not null or lb.status = 'approved' then 'approved'
                when l.ends_at > now() then 'scheduled'
                when lb.status = 'submitted' then 'submitted'
                else 'taught' end,
           le.id is not null
    from lessons l
    join classes c on c.id = l.class_id
    left join tutor_earnings t on t.lesson_id = l.id
    left join logbooks lb on lb.class_id = l.class_id and lb.month = lesson_month(l.starts_at)
    left join logbook_entries le on le.lesson_id = l.id
    cross join lateral lesson_earning(l.id) e
    where l.tutor_id = auth.uid() and l.status = 'scheduled'
      and (p_month is null or lesson_month(l.starts_at) = p_month)
    order by l.starts_at;
end $$;

-- ---------------------------------------------------------------- roster for the tutor (no money)

create function class_roster(p_class_id uuid)
returns table (
  student_id uuid,
  full_name text,
  enrollment_id uuid,
  enrollment_status enrollment_status,
  next_lesson_covered boolean,
  low_hours boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_class_tutor(p_class_id)) then
    perform fail('NOT_ALLOWED', 'only the class''s tutor or an admin can see the roster');
  end if;
  return query
    select e.student_id, p.full_name, e.id, e.status, b.next_lesson_covered, b.low_hours
    from enrollments e
    join profiles p on p.id = e.student_id
    cross join lateral _balance(e.id, now()) b
    where e.class_id = p_class_id and e.status in ('pending_payment', 'awaiting_verification', 'active')
    order by p.full_name;
end $$;

revoke all on function _balance(uuid, timestamptz), admin_overview(timestamptz), class_profitability(uuid, timestamptz),
  tutor_earnings_statement(date), class_roster(uuid) from public, anon, authenticated;
grant execute on function admin_overview(timestamptz), class_profitability(uuid, timestamptz),
  tutor_earnings_statement(date), class_roster(uuid) to authenticated;
