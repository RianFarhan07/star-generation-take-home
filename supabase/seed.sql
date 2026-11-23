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
