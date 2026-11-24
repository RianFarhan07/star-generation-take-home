-- Two hardenings of the waitlist hand-over (_enroll_from_waitlist).
--
-- 1. A waitlist entry is only dropped for a permanent reason: one of our own rule errors (P0001, for example the
--    student already holds a seat) or a unique violation. Anything else (a deadlock, a cancelled query) is not
--    caught, so the whole action is retried and nobody silently loses their place. A student whose entry is dropped
--    is told.
-- 2. The notification states the invoice amount, so the student sees the price before deciding to pay. The invoice
--    itself is not a debt: payments are simulated, nothing is charged, and the student can cancel it at no cost.

create or replace function _enroll_from_waitlist(p_class_id uuid, p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_held int;
  v_next waitlist;
  v_enrollment uuid;
  v_invoice invoices;
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
      select * into v_invoice from invoices where enrollment_id = v_enrollment and kind = 'initial';
      perform notify(v_next.student_id, 'seat_offered', 'A seat opened up in ' || v_class.name,
                     'Your invoice of ' || rupiah_text(v_invoice.amount) || ' for ' || v_invoice.hours
                       || ' hours is ready. Pay within 24 hours to keep the seat, or cancel it if you no longer want it.',
                     '/student/invoices/' || v_invoice.id);
      v_enrolled := v_enrolled + 1;
    exception when sqlstate 'P0001' or unique_violation then
      -- A permanent reason: this entry can never become an enrollment, so it must not block the line.
      delete from waitlist where id = v_next.id;
      perform notify(v_next.student_id, 'waitlist_dropped', 'We could not enroll you from the waitlist of ' || v_class.name,
                     'Your place in line was removed because a seat could not be assigned to you. You can join the waitlist again.',
                     '/student/classes');
    end;
  end loop;
  return v_enrolled;
end $$;
