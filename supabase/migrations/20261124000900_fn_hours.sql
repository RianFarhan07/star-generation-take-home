-- Hours: a student's balance is REPLAYED from payments and lessons every time it is needed. There is
-- no stored "hours left" column, so it can never drift from the real data, and cancelling a lesson
-- hands the hours back automatically.
--
-- Rules replayed here (Decisions 1b and 3a):
--   * every lesson that has ENDED and is not cancelled uses its duration, attended or not
--   * only lessons that start after the student's first payment count
--   * hours are taken from the OLDEST paid invoice first (FIFO), only from invoices paid before the lesson
--   * a lesson is only deducted if the balance covers all of it; otherwise it is "out_of_hours" and
--     deducts nothing, so the balance never goes negative

create type ledger_row as (
  lesson_id uuid,
  starts_at timestamptz,
  minutes int,
  status text,          -- 'deducted' | 'out_of_hours'
  invoice_id uuid,      -- which invoice the minutes came from (one row per invoice a lesson draws on)
  split_minutes int,
  rate_per_hour bigint
);

-- Internal: who is asking about this enrollment? 'admin', 'student' (the owner), 'tutor' (class tutor) or null.
create function enrollment_access(p_enrollment_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_admin() then 'admin'
    when exists (select 1 from enrollments where id = p_enrollment_id and student_id = auth.uid()) then 'student'
    when exists (select 1 from enrollments e where e.id = p_enrollment_id and is_class_tutor(e.class_id)) then 'tutor'
  end
$$;

-- Internal: the replay itself.
create function _ledger(p_enrollment_id uuid, p_now timestamptz default now()) returns setof ledger_row
language plpgsql stable security definer set search_path = public as $$
declare
  v_enr enrollments;
  v_ids uuid[] := '{}';
  v_remaining int[] := '{}';
  v_paid_at timestamptz[] := '{}';
  v_rate bigint[] := '{}';
  v_invoice record;
  v_lesson record;
  v_row ledger_row;
  i int;
  v_available int;
  v_needed int;
  v_take int;
begin
  select * into v_enr from enrollments where id = p_enrollment_id;
  if not found or v_enr.activated_at is null then
    return;
  end if;

  for v_invoice in
    select id, hours, paid_at, rate_per_hour from invoices
    where enrollment_id = p_enrollment_id and status = 'paid'
    order by paid_at, id
  loop
    v_ids := v_ids || v_invoice.id;
    v_remaining := v_remaining || (v_invoice.hours * 60);
    v_paid_at := v_paid_at || v_invoice.paid_at;
    v_rate := v_rate || v_invoice.rate_per_hour;
  end loop;

  for v_lesson in
    select id, starts_at, duration_minutes from lessons
    where class_id = v_enr.class_id
      and status = 'scheduled'
      and starts_at >= v_enr.activated_at
      and ends_at <= p_now
      and (v_enr.ended_at is null or starts_at < v_enr.ended_at)
    order by starts_at, id
  loop
    v_available := 0;
    for i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
      if v_paid_at[i] <= v_lesson.starts_at then
        v_available := v_available + v_remaining[i];
      end if;
    end loop;

    if v_available >= v_lesson.duration_minutes then
      v_needed := v_lesson.duration_minutes;
      for i in 1 .. array_length(v_ids, 1) loop
        exit when v_needed = 0;
        if v_paid_at[i] <= v_lesson.starts_at and v_remaining[i] > 0 then
          v_take := least(v_remaining[i], v_needed);
          v_remaining[i] := v_remaining[i] - v_take;
          v_needed := v_needed - v_take;
          v_row := row(v_lesson.id, v_lesson.starts_at, v_lesson.duration_minutes, 'deducted', v_ids[i], v_take, v_rate[i]);
          return next v_row;
        end if;
      end loop;
    else
      v_row := row(v_lesson.id, v_lesson.starts_at, v_lesson.duration_minutes, 'out_of_hours', null, 0, 0);
      return next v_row;
    end if;
  end loop;
end $$;

-- Per-lesson view of the replay. Tutors get the hours but never the rupiah values.
create function enrollment_ledger(p_enrollment_id uuid, p_now timestamptz default now())
returns table (lesson_id uuid, starts_at timestamptz, minutes int, status text, value bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_access text := enrollment_access(p_enrollment_id);
begin
  if v_access is null then perform fail('NOT_ALLOWED', 'you cannot see this enrollment'); end if;
  if not exists (select 1 from enrollments where id = p_enrollment_id) then perform fail('NOT_FOUND', 'enrollment not found'); end if;
  return query
    select l.lesson_id, l.starts_at, l.minutes, l.status,
           case when v_access = 'tutor' then null else sum((l.split_minutes * l.rate_per_hour + 30) / 60)::bigint end
    from _ledger(p_enrollment_id, p_now) l
    group by l.lesson_id, l.starts_at, l.minutes, l.status
    order by l.starts_at;
end $$;

create function enrollment_balance(p_enrollment_id uuid, p_now timestamptz default now())
returns table (
  purchased_minutes int,
  used_minutes int,
  remaining_minutes int,
  remaining_value bigint,     -- unused minutes valued at the rate of the invoice they belong to (null for tutors)
  next_lesson_id uuid,
  next_lesson_covered boolean,
  low_hours boolean,          -- 3 hours or less left
  out_of_hours boolean        -- the remaining hours do not cover the next lesson
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_access text := enrollment_access(p_enrollment_id);
  v_enr enrollments;
  v_purchased int;
  v_used int;
  v_remaining int;
  v_value bigint;
  v_next lessons;
begin
  if v_access is null then perform fail('NOT_ALLOWED', 'you cannot see this enrollment'); end if;
  select * into v_enr from enrollments where id = p_enrollment_id;
  if not found then perform fail('NOT_FOUND', 'enrollment not found'); end if;

  select coalesce(sum(hours * 60), 0) into v_purchased from invoices
  where enrollment_id = p_enrollment_id and status = 'paid';
  select coalesce(sum(l.split_minutes), 0) into v_used from _ledger(p_enrollment_id, p_now) l;
  v_remaining := v_purchased - v_used;

  select coalesce(sum(((i.hours * 60 - coalesce(u.used, 0)) * i.rate_per_hour + 30) / 60), 0) into v_value
  from invoices i
  left join (select l.invoice_id, sum(l.split_minutes) as used from _ledger(p_enrollment_id, p_now) l group by l.invoice_id) u
    on u.invoice_id = i.id
  where i.enrollment_id = p_enrollment_id and i.status = 'paid';

  select * into v_next from lessons
  where class_id = v_enr.class_id and status = 'scheduled' and starts_at > p_now
    and (v_enr.ended_at is null or starts_at < v_enr.ended_at)
  order by starts_at limit 1;

  return query select
    v_purchased,
    v_used,
    v_remaining,
    case when v_access = 'tutor' then null else v_value end,
    v_next.id,
    case when v_next.id is null then null else v_remaining >= v_next.duration_minutes end,
    v_remaining <= 180,
    v_remaining < coalesce(v_next.duration_minutes, 1);
end $$;

-- Internal: one renewal invoice at the CURRENT student rate. Used by the student/admin button and by the
-- scheduled job (p_actor null = issued by the system).
create function create_renewal_invoice(p_enrollment_id uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_enr enrollments;
  v_class classes;
  v_rate class_rates;
  v_id uuid;
begin
  select * into v_enr from enrollments where id = p_enrollment_id for update;
  if not found then perform fail('NOT_FOUND', 'enrollment not found'); end if;
  if v_enr.status <> 'active' then
    perform fail('INVALID_STATE', 'only an active enrollment can be renewed');
  end if;
  if exists (
    select 1 from invoices where enrollment_id = p_enrollment_id and status in ('unpaid', 'awaiting_verification')
  ) then
    perform fail('RENEWAL_OPEN', 'there is already an open invoice for this enrollment');
  end if;

  select * into v_class from classes where id = v_enr.class_id;
  v_rate := current_class_rate(v_enr.class_id, now());
  insert into invoices (enrollment_id, kind, hours, rate_per_hour, amount, status, issued_by)
  values (p_enrollment_id, 'renewal', v_class.package_hours, v_rate.student_rate_per_hour,
          v_class.package_hours * v_rate.student_rate_per_hour, 'unpaid', p_actor)
  returning id into v_id;
  insert into invoice_events (invoice_id, action, actor_id, note) values (v_id, 'issued', p_actor, 'renewal invoice');
  return v_id;
end $$;

create function issue_renewal_invoice(p_enrollment_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if enrollment_access(p_enrollment_id) not in ('admin', 'student') or enrollment_access(p_enrollment_id) is null then
    perform fail('NOT_ALLOWED', 'only the student or an admin can issue a renewal');
  end if;
  return create_renewal_invoice(p_enrollment_id, auth.uid());
end $$;

-- Undo a payment that was recorded by mistake (not a refund: the money never arrived, or went to the
-- wrong invoice). Only allowed while none of that invoice's hours have been used.
create function reverse_payment(p_invoice_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_invoice invoices;
  v_enr enrollments;
begin
  perform require_admin();
  if btrim(coalesce(p_reason, '')) = '' then perform fail('VALIDATION', 'a reason is required'); end if;
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then perform fail('NOT_FOUND', 'invoice not found'); end if;
  if v_invoice.status <> 'paid' then
    perform fail('INVALID_STATE', 'only a paid invoice can be reversed');
  end if;
  select * into v_enr from enrollments where id = v_invoice.enrollment_id for update;
  if v_enr.status <> 'active' then
    perform fail('INVALID_STATE', 'the enrollment is no longer active');
  end if;
  if exists (
    select 1 from _ledger(v_invoice.enrollment_id, now()) l where l.invoice_id = p_invoice_id and l.split_minutes > 0
  ) then
    perform fail('HOURS_ALREADY_USED', 'lessons have already used hours from this invoice, so it can no longer be reversed');
  end if;

  update payments
  set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
  where invoice_id = p_invoice_id and status = 'verified';

  update invoices
  set status = 'unpaid', paid_at = null,
      payment_due_at = case when kind = 'initial' then now() + interval '24 hours' else null end
  where id = p_invoice_id;

  if not exists (select 1 from invoices where enrollment_id = v_invoice.enrollment_id and status = 'paid') then
    update enrollments set status = 'pending_payment', activated_at = null where id = v_invoice.enrollment_id;
  end if;
  perform log_invoice_event(p_invoice_id, 'payment_reversed', btrim(p_reason));
end $$;

-- Change the hours of an invoice that has not been paid (e.g. a student joining mid-term). The price per
-- hour stays the invoice's own, so the admin can change the quantity but cannot give a hidden discount.
create function adjust_invoice_hours(p_invoice_id uuid, p_hours int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_invoice invoices;
begin
  perform require_admin();
  if p_hours is null or p_hours <= 0 then perform fail('VALIDATION', 'hours must be at least 1'); end if;
  if btrim(coalesce(p_reason, '')) = '' then perform fail('VALIDATION', 'a reason is required'); end if;
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then perform fail('NOT_FOUND', 'invoice not found'); end if;
  if v_invoice.status <> 'unpaid' then
    perform fail('INVALID_STATE', 'only an unpaid invoice can be adjusted');
  end if;
  update invoices set hours = p_hours, amount = p_hours * rate_per_hour where id = p_invoice_id;
  perform log_invoice_event(p_invoice_id, 'hours_adjusted', format('%s h: %s', p_hours, btrim(p_reason)));
end $$;

revoke all on function enrollment_access(uuid), _ledger(uuid, timestamptz), create_renewal_invoice(uuid, uuid),
  enrollment_ledger(uuid, timestamptz), enrollment_balance(uuid, timestamptz), issue_renewal_invoice(uuid),
  reverse_payment(uuid, text), adjust_invoice_hours(uuid, int, text) from public, anon, authenticated;
grant execute on function enrollment_ledger(uuid, timestamptz), enrollment_balance(uuid, timestamptz),
  issue_renewal_invoice(uuid), reverse_payment(uuid, text), adjust_invoice_hours(uuid, int, text) to authenticated;
