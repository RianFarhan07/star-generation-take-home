-- Waitlist with a priority window. When a class is full, students can queue. When a seat frees up
-- (a payment window expires, a payment is rejected, a student cancels or is withdrawn, or the capacity
-- grows) the FIRST student in line is offered it for 24 hours: during that time nobody else can enroll
-- into that seat. An unused offer passes to the next student in line (scheduled job) and a student who
-- enrolls leaves the waitlist. Triggers do the bookkeeping, so no existing function had to change.

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes (id) on delete cascade,
  student_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  offered_until timestamptz, -- set while a seat is reserved for this student
  unique (class_id, student_id)
);

create index waitlist_class_idx on waitlist (class_id, created_at);

alter table waitlist enable row level security;
create policy waitlist_admin on waitlist for select to authenticated using (is_admin());
create policy waitlist_own on waitlist for select to authenticated using (student_id = auth.uid());

-- Reserves free seats for the students at the front of the line, one offer per free seat.
create function _offer_free_seats(p_class_id uuid, p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_held int;
  v_offers int;
  v_next waitlist;
begin
  select * into v_class from classes where id = p_class_id for update;
  if not found then return; end if;
  loop
    select count(*) into v_held from enrollments
    where class_id = p_class_id and status in ('pending_payment', 'awaiting_verification', 'active');
    select count(*) into v_offers from waitlist where class_id = p_class_id and offered_until > p_now;
    exit when v_class.capacity - v_held - v_offers <= 0;

    select * into v_next from waitlist where class_id = p_class_id and offered_until is null order by created_at, id limit 1;
    exit when not found;

    update waitlist set offered_until = p_now + interval '24 hours' where id = v_next.id;
    perform notify(v_next.student_id, 'seat_offered', 'A seat opened up in ' || v_class.name,
                   'It is reserved for you for 24 hours. Enroll before it passes to the next student.', '/student/classes');
  end loop;
end $$;

-- A seat appears when an enrollment stops holding it; a student who enrolls leaves the waitlist.
create function enrollments_waitlist_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    delete from waitlist where class_id = new.class_id and student_id = new.student_id;
    return new;
  end if;
  if old.status in ('pending_payment', 'awaiting_verification', 'active')
     and new.status not in ('pending_payment', 'awaiting_verification', 'active') then
    perform _offer_free_seats(new.class_id);
  end if;
  return new;
end $$;

create trigger enrollments_waitlist_after after insert or update of status on enrollments
  for each row execute function enrollments_waitlist_sync();

create function classes_waitlist_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.capacity > old.capacity then
    perform _offer_free_seats(new.id);
  end if;
  return new;
end $$;

create trigger classes_waitlist_after after update of capacity on classes
  for each row execute function classes_waitlist_sync();

-- Capacity guard, now aware of reserved seats: a seat reserved for ANOTHER student on the waitlist is not
-- available. A student who holds the offer sees their own reserved seat as free.
create or replace function enrollments_capacity_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_capacity int;
  v_held int;
  v_reserved int;
begin
  if new.status not in ('pending_payment', 'awaiting_verification', 'active') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('pending_payment', 'awaiting_verification', 'active') then
    return new; -- already holds a seat
  end if;

  select capacity into v_capacity from classes where id = new.class_id for update;
  select count(*) into v_held from enrollments
  where class_id = new.class_id and status in ('pending_payment', 'awaiting_verification', 'active') and id <> new.id;
  select count(*) into v_reserved from waitlist
  where class_id = new.class_id and offered_until > now() and student_id <> new.student_id;

  if v_held + v_reserved >= v_capacity then
    perform fail('CLASS_FULL', 'this class has no free seats');
  end if;
  return new;
end $$;

create function join_waitlist(p_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_held int;
  v_reserved int;
begin
  if auth_role() is distinct from 'student' then
    perform fail('NOT_ALLOWED', 'only a student can join a waitlist');
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
  select count(*) into v_reserved from waitlist where class_id = p_class_id and offered_until > now();
  if v_class.capacity - v_held - v_reserved > 0 then
    perform fail('VALIDATION', 'this class has a free seat, so you can enroll right away');
  end if;

  insert into waitlist (class_id, student_id) values (p_class_id, auth.uid());
end $$;

create function leave_waitlist(p_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_offer timestamptz;
  v_found boolean;
begin
  select offered_until, true into v_offer, v_found from waitlist
  where class_id = p_class_id and student_id = auth.uid() for update;
  if not coalesce(v_found, false) then return; end if;
  delete from waitlist where class_id = p_class_id and student_id = auth.uid();
  if v_offer is not null and v_offer > now() then
    perform _offer_free_seats(p_class_id); -- the reserved seat goes to the next student in line
  end if;
end $$;

-- Catalog, now with the student's waitlist state. Reserved seats do not count as free for other students.
drop function list_open_classes();
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
  waitlist_position int,
  offer_until timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    c.id, c.name, c.description, p.full_name, c.package_hours,
    c.package_hours * r.student_rate_per_hour,
    greatest(c.capacity - coalesce(seats.n, 0) - coalesce(reserved.n, 0), 0)::int,
    mine.id, mine.status,
    wl.id is not null,
    case when wl.id is null then null
         else (select count(*)::int from waitlist w2 where w2.class_id = c.id and (w2.created_at, w2.id) <= (wl.created_at, wl.id)) end,
    case when wl.offered_until > now() then wl.offered_until end
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
    select count(*) as n from waitlist w
    where w.class_id = c.id and w.offered_until > now() and w.student_id <> auth.uid()
  ) reserved on true
  left join lateral (
    select e.id, e.status from enrollments e
    where e.class_id = c.id and e.student_id = auth.uid()
    order by (e.status in ('pending_payment', 'awaiting_verification', 'active')) desc, e.created_at desc
    limit 1
  ) mine on true
  left join lateral (
    select w.id, w.created_at, w.offered_until from waitlist w where w.class_id = c.id and w.student_id = auth.uid()
  ) wl on true
  where auth.uid() is not null
  order by c.name
$$;

-- Scheduled jobs, now with a first step: offers that were not used within 24 hours pass to the next student.
-- p_classes limits the waitlist step to some classes (tests use it, like p_only for enrollments).
drop function run_scheduled_jobs(timestamptz, uuid[]);
create function run_scheduled_jobs(p_now timestamptz default now(), p_only uuid[] default null, p_classes uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired int := 0;
  v_released int := 0;
  v_renewals int := 0;
  v_offers_expired int := 0;
  v_row record;
  v_enrollment enrollments;
  v_first_missed timestamptz;
  v_classes uuid[];
  v_class uuid;
begin
  -- 0. Waitlist: unused offers expire and the seat goes to the next student in line.
  if p_only is null or p_classes is not null then
    with expired as (
      delete from waitlist
      where offered_until is not null and offered_until < p_now and (p_classes is null or class_id = any (p_classes))
      returning class_id
    )
    select coalesce(array_agg(distinct class_id), '{}'), count(*) into v_classes, v_offers_expired from expired;
    foreach v_class in array v_classes loop
      perform _offer_free_seats(v_class, p_now);
    end loop;
    for v_row in
      select distinct w.class_id from waitlist w
      where w.offered_until is null and (p_classes is null or w.class_id = any (p_classes))
    loop
      perform _offer_free_seats(v_row.class_id, p_now);
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

  return jsonb_build_object('expired', v_expired, 'renewals', v_renewals, 'released', v_released, 'offers_expired', v_offers_expired);
end $$;

revoke all on function _offer_free_seats(uuid, timestamptz), enrollments_waitlist_sync(), classes_waitlist_sync(),
  join_waitlist(uuid), leave_waitlist(uuid), list_open_classes(), run_scheduled_jobs(timestamptz, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function join_waitlist(uuid), leave_waitlist(uuid), list_open_classes() to authenticated;
