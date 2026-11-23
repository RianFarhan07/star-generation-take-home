-- Final tightening found while reviewing the whole system.
--   1. Trigger functions and the two text-formatting helpers are internal: nobody needs to call them, so they
--      lose their execute right (triggers do not need it to fire; the database functions call the helpers as
--      their owner).
--   2. A payment proof must live in the reporting student's own storage folder. The admin gets a signed link
--      for whatever path is stored, so the path must not be able to point at another person's file.

revoke all on function
  classes_tutor_must_be_tutor(), classes_capacity_guard(), enrollments_capacity_guard(),
  entries_lock(), entries_validity(), logbooks_approved_lock(),
  rupiah_text(bigint), wib_text(timestamptz)
  from public, anon, authenticated;

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
  v_proof text := nullif(btrim(coalesce(p_proof_path, '')), '');
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
  if v_proof is not null and (split_part(v_proof, '/', 1) <> auth.uid()::text or v_proof like '%..%') then
    perform fail('VALIDATION', 'the proof file must be in your own folder');
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
          v_proof, 'pending', auth.uid(), v_no_seat)
  returning id into v_payment;

  update invoices set status = 'awaiting_verification' where id = p_invoice_id;
  update enrollments set status = 'awaiting_verification'
  where id = v_enrollment.id and status = 'pending_payment';

  perform log_invoice_event(p_invoice_id, 'reported', v_note);
  return v_payment;
end $$;

revoke all on function report_payment(uuid, text, text, date, bigint, text) from public, anon;
grant execute on function report_payment(uuid, text, text, date, bigint, text) to authenticated;
