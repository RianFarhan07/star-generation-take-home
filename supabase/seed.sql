-- Seed data. Runs after the migrations on `supabase db reset`.
-- Demo logins (all with password "Password123!"):
--   admin@example.com, tutor.andi@example.com, tutor.dewi@example.com,
--   student.budi@example.com, student.sari@example.com, student.citra@example.com
-- Fixed ids make the data easy to refer to from tests and docs.

-- 1. Auth users. GoTrue fails to read rows with NULL token columns, so those are set to ''.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, email_change_token_current,
  recovery_token, reauthentication_token, phone_change, phone_change_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'tutor.andi@example.com'),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'tutor.dewi@example.com'),
  ('00000000-0000-0000-0000-000000000011'::uuid, 'student.budi@example.com'),
  ('00000000-0000-0000-0000-000000000012'::uuid, 'student.sari@example.com'),
  ('00000000-0000-0000-0000-000000000013'::uuid, 'student.citra@example.com')
) as u (id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@example.com';

-- 2. Profiles (role + display name).
insert into profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-000000000001', 'Admin', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'Andi Pratama', 'tutor'),
  ('00000000-0000-0000-0000-000000000003', 'Dewi Lestari', 'tutor'),
  ('00000000-0000-0000-0000-000000000011', 'Budi Santoso', 'student'),
  ('00000000-0000-0000-0000-000000000012', 'Sari Wulandari', 'student'),
  ('00000000-0000-0000-0000-000000000013', 'Citra Maharani', 'student');

-- 3. The class: capacity 2, 12-hour package, tutor Andi.
insert into classes (id, name, description, tutor_id, capacity, package_hours, created_by) values
  ('00000000-0000-0000-0000-000000000101', 'Math Grade 8 — Group A',
   'Weekly group class covering the Grade 8 maths curriculum.',
   '00000000-0000-0000-0000-000000000002', 2, 12, '00000000-0000-0000-0000-000000000001');

-- Rp150,000 per hour for students, Rp100,000 per hour for the tutor, valid from long before any demo lesson.
insert into class_rates (class_id, effective_from, student_rate_per_hour, tutor_rate_per_hour, created_by) values
  ('00000000-0000-0000-0000-000000000101', '2025-01-01 00:00:00+07', 150000, 100000,
   '00000000-0000-0000-0000-000000000001');

-- 4. Demo history, relative to the moment of the reset (WIB), so it stays coherent whenever a reviewer
--    runs `db reset`. Budi bought the 12 hour package two months ago. Since then Andi taught 7 lessons of
--    90 minutes (10.5 hours used), so Budi has 1.5 hours left (Low) and a renewal invoice is waiting.
--      * two months ago: 4 lessons, logbook SUBMITTED  -> demo: the admin previews Rp600,000 and approves
--      * last month:     3 lessons, 2 entries, DRAFT   -> demo: the tutor finds the missing entry and submits
--      * upcoming:       2 lessons                     -> demo: Budi's schedule
--    Sari and Citra have not enrolled (enroll Sari to fill the class, then watch Citra be refused).
do $$
declare
  v_admin constant uuid := '00000000-0000-0000-0000-000000000001';
  v_andi constant uuid := '00000000-0000-0000-0000-000000000002';
  v_budi constant uuid := '00000000-0000-0000-0000-000000000011';
  v_class constant uuid := '00000000-0000-0000-0000-000000000101';
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  m1 date := (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month')::date;
  m2 date := (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '2 months')::date;
  v_activated timestamptz := (((m2 - 3) + time '10:00') at time zone 'Asia/Jakarta');
  v_enrollment uuid;
  v_invoice uuid;
  v_logbook uuid;
  v_lesson uuid;
  v_month date;
  v_days int[];
  v_topics text[];
  v_with_entry int;
  i int;
begin
  insert into enrollments (class_id, student_id, status, terms_accepted_at, activated_at)
  values (v_class, v_budi, 'active', v_activated - interval '2 days', v_activated)
  returning id into v_enrollment;

  insert into invoices (enrollment_id, kind, hours, rate_per_hour, amount, status, issued_at, payment_due_at, paid_at)
  values (v_enrollment, 'initial', 12, 150000, 1800000, 'paid',
          v_activated - interval '2 days', v_activated - interval '1 day', v_activated)
  returning id into v_invoice;

  insert into payments (invoice_id, kind, sender_name, bank, transfer_date, amount, status, reported_by, reported_at, reviewed_by, reviewed_at)
  values (v_invoice, 'transfer_report', 'Budi Santoso', 'BCA', m2 - 4, 1800000, 'verified',
          v_budi, v_activated - interval '3 hours', v_admin, v_activated);

  insert into invoice_events (invoice_id, action, actor_id, note, created_at) values
    (v_invoice, 'issued', v_budi, 'initial invoice issued on enrollment', v_activated - interval '2 days'),
    (v_invoice, 'reported', v_budi, 'transfer reported by the student', v_activated - interval '3 hours'),
    (v_invoice, 'verified', v_admin, 'transfer matched on the bank statement', v_activated);

  -- Lessons and entries for two past months. Entries are written before the logbook is submitted.
  for v_month, v_days, v_topics, v_with_entry in
    select * from (values
      (m2, array[5, 12, 19, 26], array['Linear equations', 'Ratios and proportions', 'Fractions and decimals', 'Simple word problems'], 4),
      (m1, array[5, 12, 19], array['Graphing straight lines', 'Percentages', 'Angles and triangles'], 2)
    ) as t (month, days, topics, with_entry)
  loop
    insert into logbooks (class_id, month, status) values (v_class, v_month, 'draft') returning id into v_logbook;
    for i in 1 .. array_length(v_days, 1) loop
      insert into lessons (class_id, tutor_id, starts_at, ends_at, created_by)
      values (v_class, v_andi,
              ((v_month + (v_days[i] - 1)) + time '16:00') at time zone 'Asia/Jakarta',
              ((v_month + (v_days[i] - 1)) + time '17:30') at time zone 'Asia/Jakarta',
              v_andi)
      returning id into v_lesson;
      if i <= v_with_entry then
        insert into logbook_entries (logbook_id, lesson_id, topic, activities, observation, recommendation, author_id)
        values (v_logbook, v_lesson, v_topics[i],
                'Explained the idea on the board, then the group worked through graded exercises in pairs.',
                'Budi follows the method well and works carefully; he slows down on word problems.',
                'Practise two worked examples on ' || lower(v_topics[i]) || ' before the next lesson.',
                v_andi);
      end if;
    end loop;
  end loop;

  -- Two months ago is complete: Andi submitted it. Last month stays a draft with one entry missing.
  update logbooks set status = 'submitted', submitted_at = now() - interval '1 day', submitted_by = v_andi
  where class_id = v_class and month = m2;
  insert into logbook_reviews (logbook_id, action, actor_id)
  select id, 'submitted', v_andi from logbooks where class_id = v_class and month = m2;

  -- Upcoming lessons for the schedule.
  insert into lessons (class_id, tutor_id, starts_at, ends_at, created_by) values
    (v_class, v_andi, ((v_today + 2) + time '16:00') at time zone 'Asia/Jakarta', ((v_today + 2) + time '17:30') at time zone 'Asia/Jakarta', v_andi),
    (v_class, v_andi, ((v_today + 9) + time '16:00') at time zone 'Asia/Jakarta', ((v_today + 9) + time '17:30') at time zone 'Asia/Jakarta', v_andi);
end $$;

-- Budi has 1.5 hours left: let the scheduled job issue his renewal invoice, as it would in production.
select public.run_scheduled_jobs();
