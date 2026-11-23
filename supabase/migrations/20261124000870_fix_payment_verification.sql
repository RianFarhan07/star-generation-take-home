-- Hardening of verify_payment after review:
--   * the student types the amount they transferred; the admin verifies against the bank statement, but
--     the system also refuses to mark an invoice paid when the reported amount is below the invoice amount
--   * the invoice row is locked and must still be awaiting verification (not cancelled, reversed or paid)
-- (Overpayment is accepted; the surplus is handled with an exception refund by the admin.)

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
  perform mark_invoice_paid(v_payment.invoice_id);
  perform log_invoice_event(v_payment.invoice_id, 'verified', 'transfer matched on the bank statement');
end $$;

revoke all on function verify_payment(uuid) from public, anon;
grant execute on function verify_payment(uuid) to authenticated;
