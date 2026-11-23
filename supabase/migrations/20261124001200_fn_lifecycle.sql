-- Lifecycle of an enrollment after enrolling: payment-window expiry, renewals, seat release, late
-- transfers, withdrawing and refunds.
--
-- Money never moves in this system (payments are simulated): a refund is a RECORD of an obligation
-- that waits as 'pending' on the admin's list until the admin repays it in the bank and closes it
-- with the bank reference.

-- ------------------------------------------------------------------ internal helpers

create function _remaining_minutes(p_enrollment_id uuid, p_now timestamptz default now()) returns int
language sql stable security definer set search_path = public as $$
  select (
    coalesce((select sum(hours) from invoices where enrollment_id = p_enrollment_id and status = 'paid'), 0) * 60
    - coalesce((select sum(l.split_minutes) from _ledger(p_enrollment_id, p_now) l), 0)
  )::int
$$;

-- Unused minutes valued at the rate of the invoice they belong to (hours are used oldest-invoice first).
create function _remaining_value(p_enrollment_id uuid, p_now timestamptz default now()) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(((i.hours * 60 - coalesce(u.used, 0)) * i.rate_per_hour + 30) / 60), 0)::bigint
  from invoices i
  left join (select l.invoice_id, sum(l.split_minutes) as used from _ledger(p_enrollment_id, p_now) l group by l.invoice_id) u
    on u.invoice_id = i.id
  where i.enrollment_id = p_enrollment_id and i.status = 'paid'
$$;

-- ------------------------------------------------------------------ late transfers (Decision 5d)

-- Same as before, plus: a transfer reported after the 24 hour window.
--   * seat still free  -> the enrollment is revived and processed normally at the ORIGINAL invoice price
--   * class filled up  -> the payment is flagged no_seat; verifying it creates a full refund
create or replace function report_payment(
  p_invoice_id uuid,
  p_sender_name text,
  p_bank text,
  p_transfer_date date,
  p_amount bigint,
  p_proof_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invoice invoices;
  v_enrollment enrollments;
  v_class classes;
  v_payment uuid;
  v_held int;
  v_no_seat boolean := false;
  v_note text := 'transfer reported by the student';
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then perform fail('NOT_FOUND', 'invoice not found'); end if;
  if not owns_invoice(p_invoice_id) then
    perform fail('NOT_ALLOWED', 'this is not your invoice');
  end if;
  if btrim(coalesce(p_sender_name, '')) = '' or btrim(coalesce(p_bank, '')) = ''
     or p_transfer_date is null or p_amount is null or p_amount <= 0 then
    perform fail('VALIDATION', 'sender name, bank, transfer date and a positive amount are required');
  end if;
  select * into v_enrollment from enrollments where id = v_invoice.enrollment_id for update;

  if v_invoice.status = 'unpaid' then
    null; -- the normal path
  elsif v_invoice.status = 'cancelled' and v_invoice.kind = 'initial' and v_invoice.cancel_reason = 'expired' then
    if exists (
      select 1 from enrollments
      where class_id = v_enrollment.class_id and student_id = v_enrollment.student_id and id <> v_enrollment.id
        and status in ('pending_payment', 'awaiting_verification', 'active')
    ) then
      perform fail('INVALID_STATE', 'you already have a newer enrollment in this class');
    end if;
    select * into v_class from classes where id = v_enrollment.class_id for update; -- serialises with enrollments
    select count(*) into v_held from enrollments
    where class_id = v_enrollment.class_id and status in ('pending_payment', 'awaiting_verification', 'active');
    if v_held < v_class.capacity then
      update enrollments
      set status = 'awaiting_verification', ended_at = null, end_cause = null, end_reason = null
      where id = v_enrollment.id;
      v_note := 'late transfer reported; the seat was still free';
    else
      v_no_seat := true;
      v_note := 'late transfer reported; the class was already full';
    end if;
    update invoices set cancelled_at = null, cancel_reason = null where id = p_invoice_id;
  else
    perform fail('INVALID_STATE', 'a payment can only be reported for an unpaid invoice');
  end if;

  insert into payments (invoice_id, kind, sender_name, bank, transfer_date, amount, proof_path, status, reported_by, no_seat)
  values (p_invoice_id, 'transfer_report', btrim(p_sender_name), btrim(p_bank), p_transfer_date, p_amount,
          nullif(btrim(coalesce(p_proof_path, '')), ''), 'pending', auth.uid(), v_no_seat)
  returning id into v_payment;

  update invoices set status = 'awaiting_verification' where id = p_invoice_id;
  update enrollments set status = 'awaiting_verification'
  where id = v_enrollment.id and status = 'pending_payment';

  perform log_invoice_event(p_invoice_id, 'reported', v_note);
  return v_payment;
end $$;

-- Same guards as before; a no_seat payment additionally creates the full refund.
create or replace function verify_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_invoice invoices;
begin
  perform require_admin();
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then perform fail('NOT_FOUND', 'payment not found'); end if;
  if v_payment.status <> 'pending' then
    perform fail('INVALID_STATE', 'this payment has already been reviewed');
  end if;

  select * into v_invoice from invoices where id = v_payment.invoice_id for update;
  if v_invoice.status <> 'awaiting_verification' then
    perform fail('INVALID_STATE', 'the invoice is no longer waiting for verification');
  end if;
  if v_payment.amount < v_invoice.amount then
    perform fail('VALIDATION', 'the reported amount is less than the invoice amount; reject this payment or ask for the remainder');
  end if;

  update payments set status = 'verified', reviewed_by = auth.uid(), reviewed_at = now() where id = p_payment_id;
  if v_payment.no_seat then
    insert into refunds (enrollment_id, invoice_id, amount, cause, reason, created_by)
    values (v_invoice.enrollment_id, v_invoice.id, v_payment.amount, 'late_no_seat',
            'transfer received after the payment window, when the class was already full', auth.uid());
  end if;
  perform mark_invoice_paid(v_payment.invoice_id); -- the enrollment of a no_seat payment stays cancelled
  perform log_invoice_event(v_payment.invoice_id, 'verified',
    case when v_payment.no_seat then 'late transfer verified; a full refund was created'
         else 'transfer matched on the bank statement' end);
end $$;

-- ------------------------------------------------------------------ withdrawing and refunds

-- A student leaves their own active enrollment (cause 'student': no refund, they accepted that when
-- enrolling), or the admin ends it (cause 'business': class closed, tutor unavailable...: the unused
-- hours are refunded at the rate of the invoices they belong to).
create function withdraw_enrollment(p_enrollment_id uuid, p_cause end_cause, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_enrollment enrollments;
  v_admin boolean := is_admin();
  v_value bigint := 0;
  v_refund uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_enrollment from enrollments where id = p_enrollment_id for update;
  if not found or not (v_admin or v_enrollment.student_id = auth.uid()) then
    perform fail('NOT_ALLOWED', 'you cannot end this enrollment');
  end if;
  if p_cause not in ('student', 'business') then
    perform fail('VALIDATION', 'the cause must be student or business');
  end if;
  if p_cause = 'business' and not v_admin then
    perform fail('NOT_ALLOWED', 'only an admin can end an enrollment for a business reason');
  end if;
  if p_cause = 'business' and v_reason is null then
    perform fail('VALIDATION', 'a reason is required');
  end if;
  if v_enrollment.status <> 'active' then
    perform fail('INVALID_STATE', 'only an active enrollment can be ended');
  end if;
  if exists (select 1 from invoices where enrollment_id = p_enrollment_id and status = 'awaiting_verification') then
    perform fail('PAYMENT_PENDING', 'a payment is waiting for verification; ask the admin to review it first');
  end if;

  if p_cause = 'business' then
    v_value := _remaining_value(p_enrollment_id, now()); -- before ended_at changes what the ledger replays
  end if;

  update enrollments
  set status = 'withdrawn', end_cause = p_cause, ended_at = now(), end_reason = coalesce(v_reason, 'withdrawn by the student')
  where id = p_enrollment_id;
  update invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'enrollment ended'
  where enrollment_id = p_enrollment_id and status = 'unpaid';

  if p_cause = 'business' and v_value > 0 then
    insert into refunds (enrollment_id, amount, cause, reason, created_by)
    values (p_enrollment_id, v_value, 'business', v_reason, auth.uid())
    returning id into v_refund;
  end if;
  return v_refund;
end $$;

create function create_exception_refund(p_enrollment_id uuid, p_amount bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform require_admin();
  if p_amount is null or p_amount <= 0 then perform fail('VALIDATION', 'the amount must be positive'); end if;
  if btrim(coalesce(p_reason, '')) = '' then perform fail('VALIDATION', 'a reason is required'); end if;
  if not exists (select 1 from enrollments where id = p_enrollment_id) then perform fail('NOT_FOUND', 'enrollment not found'); end if;
  insert into refunds (enrollment_id, amount, cause, reason, created_by)
  values (p_enrollment_id, p_amount, 'exception', btrim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Closing a refund is final: pending -> refunded (with the bank reference) or pending -> cancelled.
create function mark_refunded(p_refund_id uuid, p_bank_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_refund refunds;
begin
  perform require_admin();
  if btrim(coalesce(p_bank_reference, '')) = '' then perform fail('VALIDATION', 'the bank reference is required'); end if;
  select * into v_refund from refunds where id = p_refund_id for update;
  if not found then perform fail('NOT_FOUND', 'refund not found'); end if;
  if v_refund.status <> 'pending' then perform fail('INVALID_STATE', 'only a pending refund can be marked as refunded'); end if;
  update refunds
  set status = 'refunded', refunded_by = auth.uid(), refunded_at = now(), bank_reference = btrim(p_bank_reference)
  where id = p_refund_id;
end $$;

create function cancel_refund(p_refund_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_refund refunds;
begin
  perform require_admin();
  if btrim(coalesce(p_reason, '')) = '' then perform fail('VALIDATION', 'a reason is required'); end if;
  select * into v_refund from refunds where id = p_refund_id for update;
  if not found then perform fail('NOT_FOUND', 'refund not found'); end if;
  if v_refund.status <> 'pending' then perform fail('INVALID_STATE', 'only a pending refund can be cancelled'); end if;
  update refunds set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_refund_id;
end $$;

-- ------------------------------------------------------------------ scheduled jobs

-- Runs every 5 minutes (pg_cron). p_now lets tests simulate the clock, and p_only limits a run to some
-- enrollments (tests use it so a simulated run never touches the demo data).
create function run_scheduled_jobs(p_now timestamptz default now(), p_only uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired int := 0;
  v_released int := 0;
  v_renewals int := 0;
  v_row record;
  v_enrollment enrollments;
  v_first_missed timestamptz;
begin
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

  return jsonb_build_object('expired', v_expired, 'renewals', v_renewals, 'released', v_released);
end $$;

revoke all on function _remaining_minutes(uuid, timestamptz), _remaining_value(uuid, timestamptz),
  report_payment(uuid, text, text, date, bigint, text), verify_payment(uuid),
  withdraw_enrollment(uuid, end_cause, text), create_exception_refund(uuid, bigint, text),
  mark_refunded(uuid, text), cancel_refund(uuid, text), run_scheduled_jobs(timestamptz, uuid[])
  from public, anon, authenticated;
grant execute on function report_payment(uuid, text, text, date, bigint, text), verify_payment(uuid),
  withdraw_enrollment(uuid, end_cause, text), create_exception_refund(uuid, bigint, text),
  mark_refunded(uuid, text), cancel_refund(uuid, text) to authenticated;

select cron.schedule('scheduled-jobs', '*/5 * * * *', 'select public.run_scheduled_jobs()');
