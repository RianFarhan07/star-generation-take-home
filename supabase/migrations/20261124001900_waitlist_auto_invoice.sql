-- Waitlist, second version: a freed seat becomes an invoice for the first student in line.
--
-- The first version reserved the seat for 24 hours and made the student press Enroll, so a seat could stay
-- out of reach for up to 48 hours (24 to enroll, 24 to pay) and a student who missed the window lost their place.
-- Now the student accepts the no-refund terms when joining the line. The moment a seat frees up (a payment window
-- expires, a payment is rejected, a student cancels or is withdrawn, or the capacity grows) the first student in
-- line is enrolled automatically with the usual initial invoice and its 24 hour payment window, and is told. If
-- they do not pay, the existing job expires the enrollment and the next student is enrolled the same way.
-- There is no reservation any more: the seat is simply held by that pending enrollment.

-- Entries of the first version carry no consent to the terms, so they cannot become enrollments: students join again.
drop function list_open_classes();
delete from waitlist;
alter table waitlist drop column offered_until;
alter table waitlist add column terms_accepted_at timestamptz not null;

-- Capacity guard back to its plain form: there are no reserved seats to account for.
create or replace function enrollments_capacity_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_capacity int;
  v_held int;
begin
  if new.status not in ('pending_payment', 'awaiting_verification', 'active') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('pending_payment', 'awaiting_verification', 'active') then
    return new; -- already holds a seat; moving between live statuses does not take another one
  end if;

  select capacity into v_capacity from classes where id = new.class_id for update;
  select count(*) into v_held from enrollments
  where class_id = new.class_id
    and status in ('pending_payment', 'awaiting_verification', 'active')
    and id <> new.id;

  if v_held >= v_capacity then
    perform fail('CLASS_FULL', 'this class has no free seats');
  end if;
  return new;
end $$;

-- The one place that turns a student into an enrollment with its first invoice: the seat is locked, the invoice
-- is issued at the CURRENT student rate (price snapshot) with 24 hours to report the transfer. Used by a student
-- enrolling (enroll_in_class) and by the waitlist.
create function _enroll_student(
  p_class_id uuid,
  p_student_id uuid,
  p_terms_at timestamptz,
  p_actor uuid,
  p_note text,
  p_now timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rate class_rates;
  v_class classes;
  v_enrollment uuid;
  v_invoice uuid;
begin
  select * into v_class from classes where id = p_class_id for update; -- serialises concurrent enrollments
  if not found then perform fail('NOT_FOUND', 'class not found'); end if;

  if exists (
    select 1 from enrollments
    where class_id = p_class_id and student_id = p_student_id
      and status in ('pending_payment', 'awaiting_verification', 'active')
  ) then
    perform fail('ALREADY_ENROLLED', 'you already have an enrollment in this class');
  end if;

  v_rate := current_class_rate(p_class_id, p_now);

  begin
    insert into enrollments (class_id, student_id, status, terms_accepted_at)
    values (p_class_id, p_student_id, 'pending_payment', p_terms_at)
    returning id into v_enrollment; -- the trigger raises CLASS_FULL when no seat is free
  exception when unique_violation then
    perform fail('ALREADY_ENROLLED', 'you already have an enrollment in this class');
  end;

  insert into invoices (enrollment_id, kind, hours, rate_per_hour, amount, status, payment_due_at)
  values (v_enrollment, 'initial', v_class.package_hours, v_rate.student_rate_per_hour,
          v_class.package_hours * v_rate.student_rate_per_hour, 'unpaid', p_now + interval '24 hours')
  returning id into v_invoice;

  insert into invoice_events (invoice_id, action, actor_id, note) values (v_invoice, 'issued', p_actor, p_note);
  return v_enrollment;
end $$;

create or replace function enroll_in_class(p_class_id uuid, p_accept_terms boolean) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth_role() is distinct from 'student' then
    perform fail('NOT_ALLOWED', 'only a student can enroll');
  end if;
  if p_accept_terms is not true then
    perform fail('TERMS_REQUIRED', 'you must accept that there is no refund if you withdraw');
  end if;
  return _enroll_student(p_class_id, auth.uid(), now(), auth.uid(), 'initial invoice issued on enrollment', now());
end $$;

-- Enrols students from the front of the line into the free seats of a class, one per free seat, and tells them.
-- Returns how many were enrolled.
create function _enroll_from_waitlist(p_class_id uuid, p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_held int;
  v_next waitlist;
  v_enrollment uuid;
  v_invoice uuid;
  v_enrolled int := 0;
begin
  select * into v_class from classes where id = p_class_id for update;
  if not found then return 0; end if;
  loop
    select count(*) into v_held from enrollments
    where class_id = p_class_id and status in ('pending_payment', 'awaiting_verification', 'active');
    exit when v_class.capacity - v_held <= 0;

    select * into v_next from waitlist where class_id = p_class_id order by created_at, id limit 1;
    exit when not found;

    begin
      v_enrollment := _enroll_student(p_class_id, v_next.student_id, v_next.terms_accepted_at, null,
                                      'initial invoice issued automatically from the waitlist', p_now);
      select id into v_invoice from invoices where enrollment_id = v_enrollment and kind = 'initial';
      perform notify(v_next.student_id, 'seat_offered', 'A seat opened up in ' || v_class.name,
                     'We created your invoice. Pay within 24 hours to keep the seat.', '/student/invoices/' || v_invoice);
      v_enrolled := v_enrolled + 1;
    exception when others then
      -- An entry that cannot be turned into an enrollment must not block the line or the action that freed the seat.
      delete from waitlist where id = v_next.id;
    end;
  end loop;
  return v_enrolled;
end $$;

-- A seat appears when an enrollment stops holding it. (A student who is enrolled leaves the waitlist.)
create or replace function enrollments_waitlist_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    delete from waitlist where class_id = new.class_id and student_id = new.student_id;
    return new;
  end if;
  if old.status in ('pending_payment', 'awaiting_verification', 'active')
     and new.status not in ('pending_payment', 'awaiting_verification', 'active') then
    perform _enroll_from_waitlist(new.class_id);
  end if;
  return new;
end $$;

create or replace function classes_waitlist_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.capacity > old.capacity then
    perform _enroll_from_waitlist(new.id);
  end if;
  return new;
end $$;

drop function _offer_free_seats(uuid, timestamptz);

drop function join_waitlist(uuid);
create function join_waitlist(p_class_id uuid, p_accept_terms boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_held int;
begin
  if auth_role() is distinct from 'student' then
    perform fail('NOT_ALLOWED', 'only a student can join a waitlist');
  end if;
  if p_accept_terms is not true then
    perform fail('TERMS_REQUIRED', 'you must accept that there is no refund if you withdraw');
  end if;
  select * into v_class from classes where id = p_class_id for update;
  if not found then perform fail('NOT_FOUND', 'class not found'); end if;

  if exists (
    select 1 from enrollments
    where class_id = p_class_id and student_id = auth.uid() and status in ('pending_payment', 'awaiting_verification', 'active')
  ) then
    perform fail('ALREADY_ENROLLED', 'you already have an enrollment in this class');
  end if;
  if exists (select 1 from waitlist where class_id = p_class_id and student_id = auth.uid()) then
    perform fail('INVALID_STATE', 'you are already on the waitlist');
  end if;

  select count(*) into v_held from enrollments
  where class_id = p_class_id and status in ('pending_payment', 'awaiting_verification', 'active');
  if v_class.capacity - v_held > 0 then
    perform fail('VALIDATION', 'this class has a free seat, so you can enroll right away');
  end if;

  insert into waitlist (class_id, student_id, terms_accepted_at) values (p_class_id, auth.uid(), now());
end $$;

create or replace function leave_waitlist(p_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from waitlist where class_id = p_class_id and student_id = auth.uid();
end $$;

-- Catalog with the student's waitlist state.
create function list_open_classes()
returns table (
  class_id uuid,
  name text,
  description text,
  tutor_name text,
  package_hours int,
  package_price bigint,
  seats_left int,
  my_enrollment_id uuid,
  my_enrollment_status enrollment_status,
  on_waitlist boolean,
  waitlist_position int
)
language sql stable security definer set search_path = public as $$
  select
    c.id, c.name, c.description, p.full_name, c.package_hours,
    c.package_hours * r.student_rate_per_hour,
    greatest(c.capacity - coalesce(seats.n, 0), 0)::int,
    mine.id, mine.status,
    wl.id is not null,
    case when wl.id is null then null
         else (select count(*)::int from waitlist w2 where w2.class_id = c.id and (w2.created_at, w2.id) <= (wl.created_at, wl.id)) end
  from classes c
  join profiles p on p.id = c.tutor_id
  join lateral (
    select cr.student_rate_per_hour from class_rates cr
    where cr.class_id = c.id and cr.effective_from <= now()
    order by cr.effective_from desc limit 1
  ) r on true
  left join lateral (
    select count(*) as n from enrollments e
    where e.class_id = c.id and e.status in ('pending_payment', 'awaiting_verification', 'active')
  ) seats on true
  left join lateral (
    select e.id, e.status from enrollments e
    where e.class_id = c.id and e.student_id = auth.uid()
    order by (e.status in ('pending_payment', 'awaiting_verification', 'active')) desc, e.created_at desc
    limit 1
  ) mine on true
  left join lateral (
    select w.id, w.created_at from waitlist w where w.class_id = c.id and w.student_id = auth.uid()
  ) wl on true
  where auth.uid() is not null
  order by c.name
$$;

-- Scheduled jobs. Step 0 is only a safety net now: triggers hand a freed seat to the first in line at once.
-- p_classes limits that step to some classes (tests use it, like p_only for enrollments).
drop function run_scheduled_jobs(timestamptz, uuid[], uuid[]);
create function run_scheduled_jobs(p_now timestamptz default now(), p_only uuid[] default null, p_classes uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired int := 0;
  v_released int := 0;
  v_renewals int := 0;
  v_waitlist int := 0;
  v_row record;
  v_enrollment enrollments;
  v_first_missed timestamptz;
begin
  -- 0. Waitlist: a free seat with somebody waiting becomes an invoice for the first in line.
  if p_only is null or p_classes is not null then
    for v_row in
      select distinct w.class_id from waitlist w where (p_classes is null or w.class_id = any (p_classes))
    loop
      v_waitlist := v_waitlist + _enroll_from_waitlist(v_row.class_id, p_now);
    end loop;
  end if;

  -- 1. The 24 hour payment window passed without a transfer report: enrollment and invoice end, seat freed.
  for v_row in
    select e.id as enrollment_id, i.id as invoice_id
    from enrollments e join invoices i on i.enrollment_id = e.id and i.kind = 'initial'
    where e.status = 'pending_payment' and i.status = 'unpaid' and i.payment_due_at < p_now
      and (p_only is null or e.id = any (p_only))
  loop
    select * into v_enrollment from enrollments where id = v_row.enrollment_id for update;
    continue when v_enrollment.status <> 'pending_payment';
    update enrollments
    set status = 'cancelled', end_cause = 'expired', ended_at = p_now, end_reason = 'payment window expired'
    where id = v_row.enrollment_id;
    update invoices set status = 'cancelled', cancelled_at = p_now, cancel_reason = 'expired'
    where id = v_row.invoice_id and status = 'unpaid';
    insert into invoice_events (invoice_id, action, actor_id, note) values (v_row.invoice_id, 'expired', null, 'payment window expired');
    v_expired := v_expired + 1;
  end loop;

  -- 2. A student who ran out of hours and has not renewed for 7 days leaves the class (seat released),
  --    unless a renewal transfer is waiting for the admin (that delay is not the student's fault).
  for v_row in
    select e.id as enrollment_id from enrollments e
    where e.status = 'active' and (p_only is null or e.id = any (p_only))
      and not exists (select 1 from invoices i where i.enrollment_id = e.id and i.status = 'awaiting_verification')
  loop
    select min(l.starts_at) into v_first_missed
    from _ledger(v_row.enrollment_id, p_now) l
    where l.status = 'out_of_hours'
      and l.starts_at > (select max(paid_at) from invoices where enrollment_id = v_row.enrollment_id and status = 'paid');
    continue when v_first_missed is null or v_first_missed > p_now - interval '7 days';

    update enrollments
    set status = 'withdrawn', end_cause = 'not_renewed', ended_at = p_now, end_reason = 'not renewed within 7 days'
    where id = v_row.enrollment_id and status = 'active';
    update invoices set status = 'cancelled', cancelled_at = p_now, cancel_reason = 'enrollment ended (not renewed)'
    where enrollment_id = v_row.enrollment_id and status = 'unpaid';
    v_released := v_released + 1;
  end loop;

  -- 3. 3 hours or less left and nothing open: issue the renewal invoice (issued by the system).
  for v_row in
    select e.id as enrollment_id from enrollments e
    where e.status = 'active' and (p_only is null or e.id = any (p_only))
      and not exists (select 1 from invoices i where i.enrollment_id = e.id and i.status in ('unpaid', 'awaiting_verification'))
  loop
    if _remaining_minutes(v_row.enrollment_id, p_now) <= 180 then
      perform create_renewal_invoice(v_row.enrollment_id, null);
      v_renewals := v_renewals + 1;
    end if;
  end loop;

  return jsonb_build_object('expired', v_expired, 'renewals', v_renewals, 'released', v_released, 'waitlist_enrolled', v_waitlist);
end $$;

revoke all on function _enroll_student(uuid, uuid, timestamptz, uuid, text, timestamptz), _enroll_from_waitlist(uuid, timestamptz),
  join_waitlist(uuid, boolean), leave_waitlist(uuid), list_open_classes(), run_scheduled_jobs(timestamptz, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function join_waitlist(uuid, boolean), leave_waitlist(uuid), list_open_classes() to authenticated;
