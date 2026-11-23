-- Payments: the student REPORTS a transfer, the admin VERIFIES it (the admin is the only one who can
-- see the bank statement, so only the admin can say money arrived). With a real payment gateway, its
-- webhook would call the same verification logic instead of an admin button.
--
-- Every state change leaves a row in invoice_events (who, when, what).

create function log_invoice_event(p_invoice_id uuid, p_action text, p_note text default null) returns void
language sql security definer set search_path = public as $$
  insert into invoice_events (invoice_id, action, actor_id, note) values (p_invoice_id, p_action, auth.uid(), p_note)
$$;

-- Internal: the invoice is now paid. Opens access (enrollment -> active) the first time.
create function mark_invoice_paid(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_invoice invoices;
begin
  update invoices set status = 'paid', paid_at = now() where id = p_invoice_id returning * into v_invoice;
  update enrollments
  set status = 'active', activated_at = coalesce(activated_at, now())
  where id = v_invoice.enrollment_id and status in ('pending_payment', 'awaiting_verification');
end $$;

create function report_payment(
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
  v_payment uuid;
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
  if v_invoice.status <> 'unpaid' then
    perform fail('INVALID_STATE', 'a payment can only be reported for an unpaid invoice');
  end if;

  insert into payments (invoice_id, kind, sender_name, bank, transfer_date, amount, proof_path, status, reported_by)
  values (p_invoice_id, 'transfer_report', btrim(p_sender_name), btrim(p_bank), p_transfer_date, p_amount,
          nullif(btrim(coalesce(p_proof_path, '')), ''), 'pending', auth.uid())
  returning id into v_payment;

  update invoices set status = 'awaiting_verification' where id = p_invoice_id;
  update enrollments set status = 'awaiting_verification'
  where id = v_invoice.enrollment_id and status = 'pending_payment';

  perform log_invoice_event(p_invoice_id, 'reported', 'transfer reported by the student');
  return v_payment;
end $$;

create function verify_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
begin
  perform require_admin();
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then perform fail('NOT_FOUND', 'payment not found'); end if;
  if v_payment.status <> 'pending' then
    perform fail('INVALID_STATE', 'this payment has already been reviewed');
  end if;

  update payments set status = 'verified', reviewed_by = auth.uid(), reviewed_at = now() where id = p_payment_id;
  perform mark_invoice_paid(v_payment.invoice_id);
  perform log_invoice_event(v_payment.invoice_id, 'verified', 'transfer matched on the bank statement');
end $$;

create function reject_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_invoice invoices;
begin
  perform require_admin();
  if btrim(coalesce(p_reason, '')) = '' then perform fail('VALIDATION', 'a reason is required'); end if;
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then perform fail('NOT_FOUND', 'payment not found'); end if;
  if v_payment.status <> 'pending' then
    perform fail('INVALID_STATE', 'this payment has already been reviewed');
  end if;

  update payments
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = btrim(p_reason)
  where id = p_payment_id;

  select * into v_invoice from invoices where id = v_payment.invoice_id for update;
  if v_invoice.kind = 'initial' then
    -- The student never got access: the invoice and the enrollment end here and the seat is released.
    update invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'payment rejected: ' || btrim(p_reason)
    where id = v_invoice.id;
    update enrollments
    set status = 'cancelled', end_cause = 'rejected', ended_at = now(), end_reason = btrim(p_reason)
    where id = v_invoice.enrollment_id and status = 'awaiting_verification';
  else
    -- A renewal: the student stays enrolled and can report again.
    update invoices set status = 'unpaid' where id = v_invoice.id;
  end if;
  perform log_invoice_event(v_invoice.id, 'rejected', btrim(p_reason));
end $$;

-- Cash or a transfer the admin checked directly: recorded as an offline payment, verified at once.
create function mark_paid_offline(p_invoice_id uuid, p_reference text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invoice invoices;
  v_payment uuid;
begin
  perform require_admin();
  if btrim(coalesce(p_reference, '')) = '' then perform fail('VALIDATION', 'a reference or note is required'); end if;
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then perform fail('NOT_FOUND', 'invoice not found'); end if;
  if v_invoice.status <> 'unpaid' then
    perform fail('INVALID_STATE', 'only an unpaid invoice can be marked as paid');
  end if;

  insert into payments (invoice_id, kind, amount, reference, status, reported_by, reviewed_by, reviewed_at)
  values (p_invoice_id, 'offline', v_invoice.amount, btrim(p_reference), 'verified', auth.uid(), auth.uid(), now())
  returning id into v_payment;

  perform mark_invoice_paid(p_invoice_id);
  perform log_invoice_event(p_invoice_id, 'paid_offline', btrim(p_reference));
  return v_payment;
end $$;

revoke all on function log_invoice_event(uuid, text, text), mark_invoice_paid(uuid),
  report_payment(uuid, text, text, date, bigint, text), verify_payment(uuid), reject_payment(uuid, text),
  mark_paid_offline(uuid, text) from public, anon, authenticated;
grant execute on function report_payment(uuid, text, text, date, bigint, text), verify_payment(uuid),
  reject_payment(uuid, text), mark_paid_offline(uuid, text) to authenticated;
