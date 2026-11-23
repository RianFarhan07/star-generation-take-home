-- Enrollment and capacity.
--
-- A seat is HELD by an enrollment in status pending_payment, awaiting_verification or active.
-- The seat is locked the moment the student enrolls (before any transfer instructions are shown),
-- so nobody can transfer money for a seat that is already gone.

-- Trigger functions must not depend on the caller's search_path.
alter function classes_tutor_must_be_tutor() set search_path = public;
alter function classes_capacity_guard() set search_path = public;

-- Second line of defence for capacity, valid for every path (functions, SQL console, future code).
-- Locking the class row makes two simultaneous enrollments take turns: the second one then counts the
-- first one's committed seat and is refused.
create function enrollments_capacity_guard() returns trigger
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

create trigger enrollments_capacity_check
  before insert or update of status on enrollments
  for each row execute function enrollments_capacity_guard();

-- Student enrolls: seat locked, initial invoice issued at the CURRENT student rate (price snapshot),
-- 24 hours to report the transfer.
create function enroll_in_class(p_class_id uuid, p_accept_terms boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rate class_rates;
  v_class classes;
  v_enrollment uuid;
  v_invoice uuid;
begin
  if auth_role() is distinct from 'student' then
    perform fail('NOT_ALLOWED', 'only a student can enroll');
  end if;
  if p_accept_terms is not true then
    perform fail('TERMS_REQUIRED', 'you must accept that there is no refund if you withdraw');
  end if;

  select * into v_class from classes where id = p_class_id for update; -- serialises concurrent enrollments
  if not found then perform fail('NOT_FOUND', 'class not found'); end if;

  if exists (
    select 1 from enrollments
    where class_id = p_class_id and student_id = auth.uid()
      and status in ('pending_payment', 'awaiting_verification', 'active')
  ) then
    perform fail('ALREADY_ENROLLED', 'you already have an enrollment in this class');
  end if;

  v_rate := current_class_rate(p_class_id, now());

  begin
    insert into enrollments (class_id, student_id, status, terms_accepted_at)
    values (p_class_id, auth.uid(), 'pending_payment', now())
    returning id into v_enrollment; -- the trigger raises CLASS_FULL when no seat is free
  exception when unique_violation then
    perform fail('ALREADY_ENROLLED', 'you already have an enrollment in this class');
  end;

  insert into invoices (enrollment_id, kind, hours, rate_per_hour, amount, status, payment_due_at)
  values (v_enrollment, 'initial', v_class.package_hours, v_rate.student_rate_per_hour,
          v_class.package_hours * v_rate.student_rate_per_hour, 'unpaid', now() + interval '24 hours')
  returning id into v_invoice;

  insert into invoice_events (invoice_id, action, actor_id, note)
  values (v_invoice, 'issued', auth.uid(), 'initial invoice issued on enrollment');

  return v_enrollment;
end $$;

-- The student changes their mind during the payment window: seat released, invoice cancelled.
create function cancel_pending_enrollment(p_enrollment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_enrollment enrollments;
begin
  select * into v_enrollment from enrollments where id = p_enrollment_id for update;
  if not found then perform fail('NOT_FOUND', 'enrollment not found'); end if;
  if v_enrollment.student_id is distinct from auth.uid() then
    perform fail('NOT_ALLOWED', 'this is not your enrollment');
  end if;
  if v_enrollment.status <> 'pending_payment' then
    perform fail('INVALID_STATE', 'only an enrollment that is still waiting for payment can be cancelled this way');
  end if;

  update enrollments
  set status = 'cancelled', end_cause = 'student', ended_at = now(), end_reason = 'cancelled by student'
  where id = p_enrollment_id;

  update invoices
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'cancelled by student'
  where enrollment_id = p_enrollment_id and status = 'unpaid';

  insert into invoice_events (invoice_id, action, actor_id, note)
  select id, 'cancelled', auth.uid(), 'cancelled by student' from invoices
  where enrollment_id = p_enrollment_id and status = 'cancelled';
end $$;

revoke all on function enrollments_capacity_guard(), enroll_in_class(uuid, boolean), cancel_pending_enrollment(uuid)
  from public, anon;
grant execute on function enroll_in_class(uuid, boolean), cancel_pending_enrollment(uuid) to authenticated;
