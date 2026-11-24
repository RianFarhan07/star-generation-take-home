-- A transfer that is less than the invoice cannot be verified, and rejecting it cancels a first invoice and releases
-- the seat, although the student did pay something. The admin can now RETURN it to the student instead: the report is
-- marked rejected with the reason (the student is told how much is missing), the invoice goes back to unpaid and the
-- seat stays held for 24 more hours, so the student can transfer the rest and report the total they transferred.
-- A renewal invoice just goes back to unpaid, as with a rejection. Rejecting stays the way to say "this transfer is
-- not on the bank statement" (the seat is released).

create function return_underpaid_payment(p_payment_id uuid, p_reason text) returns void
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

  select * into v_invoice from invoices where id = v_payment.invoice_id for update;
  if v_invoice.status <> 'awaiting_verification' then
    perform fail('INVALID_STATE', 'the invoice is no longer waiting for verification');
  end if;
  if v_payment.no_seat then
    perform fail('VALIDATION', 'a late transfer on a full class cannot be returned to the student; reject it instead');
  end if;
  if v_payment.amount >= v_invoice.amount then
    perform fail('VALIDATION', 'only a transfer that is less than the invoice amount can be returned to the student');
  end if;

  update payments
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = btrim(p_reason)
  where id = p_payment_id;

  update invoices
  set status = 'unpaid',
      payment_due_at = case when kind = 'initial' then now() + interval '24 hours' else payment_due_at end
  where id = v_invoice.id;
  update enrollments set status = 'pending_payment'
  where id = v_invoice.enrollment_id and status = 'awaiting_verification';

  perform log_invoice_event(v_invoice.id, 'returned', btrim(p_reason));
end $$;

revoke all on function return_underpaid_payment(uuid, text) from public, anon;
grant execute on function return_underpaid_payment(uuid, text) to authenticated;
