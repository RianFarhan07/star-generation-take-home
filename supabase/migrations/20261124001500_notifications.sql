-- In-app notifications: a bell with an unread count and a list, replacing the WhatsApp messages
-- ("your invoice is ready", "the lesson is cancelled", ...). They are written by AFTER triggers on the
-- tables where the events happen, so none of the existing functions had to change and no code path can
-- forget to notify. Everyone reads only their own rows; nobody writes them directly.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;
create policy notifications_own on notifications for select to authenticated using (user_id = auth.uid());

create function notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, coalesce(p_body, ''), p_link)
$$;

create function mark_notifications_read() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- "Rp1,800,000"
create function rupiah_text(p_amount bigint) returns text
language sql immutable as $$ select 'Rp' || to_char(p_amount, 'FM999,999,999,999') $$;

-- "Mon 19 Oct 2026, 16:00 WIB"
create function wib_text(p_ts timestamptz) returns text
language sql immutable as $$ select to_char(p_ts at time zone 'Asia/Jakarta', 'Dy DD Mon YYYY, HH24:MI') || ' WIB' $$;

-- ------------------------------------------------------------------ invoices

create function notify_invoice_issued() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student uuid;
  v_class text;
begin
  select e.student_id, c.name into v_student, v_class
  from enrollments e join classes c on c.id = e.class_id where e.id = new.enrollment_id;
  perform notify(v_student, 'invoice_issued', 'New invoice: ' || rupiah_text(new.amount),
                 new.hours || ' hours · ' || v_class, '/student/invoices/' || new.id);
  return new;
end $$;

create trigger invoices_notify after insert on invoices
  for each row execute function notify_invoice_issued();

-- ------------------------------------------------------------------ payments

create function notify_payment_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student uuid;
  v_class text;
begin
  if not (
    (tg_op = 'INSERT' and new.status = 'verified')
    or (tg_op = 'UPDATE' and new.status in ('verified', 'rejected') and old.status is distinct from new.status)
  ) then
    return new;
  end if;
  select e.student_id, c.name into v_student, v_class
  from invoices i join enrollments e on e.id = i.enrollment_id join classes c on c.id = e.class_id
  where i.id = new.invoice_id;

  if new.status = 'verified' then
    perform notify(v_student, 'payment_verified',
                   case when new.no_seat then 'Payment received, but the class was full' else 'Payment confirmed' end,
                   case when new.no_seat then v_class || ': a full refund is being processed.' else v_class || ': your class is now open.' end,
                   '/student/invoices/' || new.invoice_id);
  else
    perform notify(v_student, 'payment_rejected', 'Payment rejected',
                   v_class || ': ' || coalesce(new.reject_reason, 'the transfer could not be matched.'),
                   '/student/invoices/' || new.invoice_id);
  end if;
  return new;
end $$;

create trigger payments_notify after insert or update of status on payments
  for each row execute function notify_payment_review();

-- ------------------------------------------------------------------ lessons

create function notify_lesson_cancelled() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_class text;
  v_student record;
begin
  if not (old.status = 'scheduled' and new.status = 'cancelled') then return new; end if;
  select name into v_class from classes where id = new.class_id;
  for v_student in select student_id from enrollments where class_id = new.class_id and status = 'active' loop
    perform notify(v_student.student_id, 'lesson_cancelled', 'Lesson cancelled',
                   v_class || ', ' || wib_text(new.starts_at) || '. Reason: ' || coalesce(new.cancel_reason, '—'),
                   '/student/classes/' || new.class_id);
  end loop;
  return new;
end $$;

create trigger lessons_notify after update of status on lessons
  for each row execute function notify_lesson_cancelled();

-- ------------------------------------------------------------------ logbooks

create function notify_logbook_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_person record;
  v_month text := to_char(new.month, 'Mon YYYY');
  v_tutor_link text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into v_class from classes where id = new.class_id;
  v_tutor_link := '/tutor/logbooks/' || new.class_id || '/' || to_char(new.month, 'YYYY-MM');

  if new.status = 'submitted' then
    for v_person in select id from profiles where role = 'admin' loop
      perform notify(v_person.id, 'logbook_submitted', 'Logbook submitted for review', v_class.name || ' · ' || v_month, '/admin/logbooks/' || new.id);
    end loop;
  elsif new.status = 'approved' then
    perform notify(v_class.tutor_id, 'logbook_approved', 'Logbook approved', v_class.name || ' · ' || v_month || ': your earnings are recorded.', v_tutor_link);
    for v_person in select student_id as id from enrollments where class_id = new.class_id and status = 'active' loop
      perform notify(v_person.id, 'logbook_approved', 'New logbook available', v_class.name || ' · ' || v_month, '/student/classes/' || new.class_id);
    end loop;
  end if;
  return new;
end $$;

create trigger logbooks_notify after update of status on logbooks
  for each row execute function notify_logbook_status();

-- "Changes requested" is announced from the review row (not the status change) because the admin's comment
-- is written there.
create function notify_logbook_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_logbook logbooks;
  v_class classes;
begin
  if new.action <> 'changes_requested' or new.entry_id is not null then return new; end if;
  select * into v_logbook from logbooks where id = new.logbook_id;
  select * into v_class from classes where id = v_logbook.class_id;
  perform notify(v_class.tutor_id, 'logbook_changes_requested', 'The admin asked for changes',
                 v_class.name || ' · ' || to_char(v_logbook.month, 'Mon YYYY') || ': ' || coalesce(new.comment, 'see the logbook'),
                 '/tutor/logbooks/' || v_logbook.class_id || '/' || to_char(v_logbook.month, 'YYYY-MM'));
  return new;
end $$;

create trigger logbook_reviews_notify after insert on logbook_reviews
  for each row execute function notify_logbook_review();

-- ------------------------------------------------------------------ refunds

create function notify_refund() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student uuid;
begin
  select student_id into v_student from enrollments where id = new.enrollment_id;
  if tg_op = 'INSERT' then
    perform notify(v_student, 'refund_recorded', 'A refund of ' || rupiah_text(new.amount) || ' is being processed', new.reason, '/student/invoices');
  elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
    perform notify(v_student, 'refund_repaid', 'Refund of ' || rupiah_text(new.amount) || ' repaid',
                   'Bank reference ' || coalesce(new.bank_reference, '—'), '/student/invoices');
  end if;
  return new;
end $$;

create trigger refunds_notify after insert or update of status on refunds
  for each row execute function notify_refund();

-- ------------------------------------------------------------------ privileges

revoke all on function notify(uuid, text, text, text, text), notify_invoice_issued(), notify_payment_review(),
  notify_lesson_cancelled(), notify_logbook_status(), notify_logbook_review(), notify_refund(), mark_notifications_read()
  from public, anon, authenticated;
grant execute on function mark_notifications_read() to authenticated;
grant execute on function rupiah_text(bigint), wib_text(timestamptz) to authenticated;
