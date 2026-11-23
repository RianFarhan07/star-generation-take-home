-- The automatic refund for a late transfer on a full class uses the INVOICE amount (a figure the system
-- trusts), not the amount the student typed in the report. If the student really transferred more, the
-- admin refunds the surplus deliberately with an exception refund.

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
    values (v_invoice.enrollment_id, v_invoice.id, v_invoice.amount, 'late_no_seat',
            'transfer received after the payment window, when the class was already full', auth.uid());
  end if;
  perform mark_invoice_paid(v_payment.invoice_id); -- the enrollment of a no_seat payment stays cancelled
  perform log_invoice_event(v_payment.invoice_id, 'verified',
    case when v_payment.no_seat then 'late transfer verified; a full refund of the invoice amount was created'
         else 'transfer matched on the bank statement' end);
end $$;

revoke all on function verify_payment(uuid) from public, anon;
grant execute on function verify_payment(uuid) to authenticated;
