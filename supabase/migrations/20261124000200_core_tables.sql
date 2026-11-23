-- Core tables. Conventions:
--   money = bigint rupiah, durations = integer minutes, times = timestamptz (WIB only at the edges).
--   RLS is enabled on every table; read policies come in 20261124000300, writes only go through functions.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  role user_role not null,
  created_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  tutor_id uuid not null references profiles (id),
  capacity int not null check (capacity > 0),
  package_hours int not null default 12 check (package_hours > 0),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- A class's tutor must really be a tutor (functions check too; this is the second line of defence).
create function classes_tutor_must_be_tutor() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from profiles where id = new.tutor_id and role = 'tutor') then
    raise exception 'VALIDATION: the assigned user is not a tutor' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger classes_tutor_check
  before insert or update of tutor_id on classes
  for each row execute function classes_tutor_must_be_tutor();

-- Rate history. Admin-only on purpose: row-level security works per row, not per column, so keeping
-- rates out of `classes` is what stops a tutor (who may read the class row) from reading student rates.
create table class_rates (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes (id) on delete cascade,
  effective_from timestamptz not null default now(),
  student_rate_per_hour bigint not null check (student_rate_per_hour >= 0),
  tutor_rate_per_hour bigint not null check (tutor_rate_per_hour >= 0),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (class_id, effective_from)
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes (id),
  student_id uuid not null references profiles (id),
  status enrollment_status not null default 'pending_payment',
  terms_accepted_at timestamptz not null,
  activated_at timestamptz,
  ended_at timestamptz,
  end_cause end_cause,
  end_reason text,
  created_at timestamptz not null default now()
);

-- One live enrollment per student per class. Ended ones stay as history, so a student may enroll again later.
create unique index enrollments_one_live_per_student
  on enrollments (class_id, student_id)
  where status in ('pending_payment', 'awaiting_verification', 'active');

create index enrollments_student_idx on enrollments (student_id);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments (id),
  kind invoice_kind not null,
  hours int not null check (hours > 0),
  rate_per_hour bigint not null check (rate_per_hour >= 0),
  amount bigint not null,
  status invoice_status not null default 'unpaid',
  issued_at timestamptz not null default now(),
  issued_by uuid references profiles (id), -- null = issued by the system
  payment_due_at timestamptz,              -- initial invoices only (24 h window)
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  -- The price is a snapshot: later rate changes never touch an issued invoice.
  constraint invoices_amount_matches check (amount = hours * rate_per_hour)
);

create index invoices_enrollment_idx on invoices (enrollment_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id),
  kind payment_kind not null,
  sender_name text,
  bank text,
  transfer_date date,
  amount bigint not null check (amount > 0),
  proof_path text,
  reference text,
  no_seat boolean not null default false, -- late transfer after the seat was given away (refund on verify)
  status payment_status not null default 'pending',
  reported_by uuid references profiles (id),
  reported_at timestamptz not null default now(),
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  reject_reason text,
  reversed_at timestamptz,
  reversed_by uuid references profiles (id),
  reversal_reason text
);

create index payments_invoice_idx on payments (invoice_id);

create table invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id),
  action text not null,
  actor_id uuid references profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index invoice_events_invoice_idx on invoice_events (invoice_id);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments (id),
  invoice_id uuid references invoices (id),
  amount bigint not null check (amount > 0),
  cause refund_cause not null,
  reason text not null check (btrim(reason) <> ''),
  status refund_status not null default 'pending',
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  refunded_by uuid references profiles (id),
  refunded_at timestamptz,
  bank_reference text,
  cancel_reason text
);

create index refunds_enrollment_idx on refunds (enrollment_id);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes (id),
  tutor_id uuid not null references profiles (id), -- teacher of record: earnings and logbook entry follow this
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes int generated always as ((extract(epoch from (ends_at - starts_at)) / 60)::int) stored,
  status lesson_status not null default 'scheduled',
  cancel_reason text,
  cancelled_by uuid references profiles (id),
  cancelled_at timestamptz,
  series_id uuid,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  constraint lessons_end_after_start check (ends_at > starts_at),
  constraint lessons_cancel_needs_reason check (status <> 'cancelled' or btrim(coalesce(cancel_reason, '')) <> ''),
  -- A tutor can never teach two lessons at once, in any class. Back-to-back is fine ('[)' = end excluded).
  -- Cancelled lessons free their slot.
  constraint lessons_no_tutor_overlap exclude using gist (
    tutor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);

create index lessons_class_idx on lessons (class_id, starts_at);

create table logbooks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes (id),
  month date not null check (extract(day from month) = 1), -- first day of the WIB month
  status logbook_status not null default 'draft',
  submitted_at timestamptz,
  submitted_by uuid references profiles (id),
  approved_at timestamptz,
  approved_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (class_id, month) -- one logbook per class per month
);

create table logbook_entries (
  id uuid primary key default gen_random_uuid(),
  logbook_id uuid not null references logbooks (id),
  lesson_id uuid not null unique references lessons (id), -- one entry per lesson
  topic text not null check (btrim(topic) <> ''),
  activities text not null check (btrim(activities) <> ''),
  observation text not null check (btrim(observation) <> ''),
  recommendation text not null check (btrim(recommendation) <> ''),
  author_id uuid not null references profiles (id),
  edited_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index logbook_entries_logbook_idx on logbook_entries (logbook_id);

create table logbook_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references logbook_entries (id),
  topic text not null,
  activities text not null,
  observation text not null,
  recommendation text not null,
  edited_by uuid references profiles (id),
  edited_at timestamptz not null default now()
);

create table logbook_reviews (
  id uuid primary key default gen_random_uuid(),
  logbook_id uuid not null references logbooks (id),
  action review_action not null,
  comment text,
  entry_id uuid references logbook_entries (id), -- set when the comment flags one entry
  actor_id uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index logbook_reviews_logbook_idx on logbook_reviews (logbook_id);

create table tutor_earnings (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references lessons (id), -- earned once per lesson, however often approve runs
  logbook_id uuid not null references logbooks (id),
  tutor_id uuid not null references profiles (id),
  class_id uuid not null references classes (id),
  minutes int not null check (minutes > 0),
  rate_per_hour bigint not null check (rate_per_hour >= 0),
  amount bigint not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index tutor_earnings_tutor_idx on tutor_earnings (tutor_id);

-- Row-level security on every table (read policies are added in the next migration).
alter table profiles enable row level security;
alter table classes enable row level security;
alter table class_rates enable row level security;
alter table enrollments enable row level security;
alter table invoices enable row level security;
alter table payments enable row level security;
alter table invoice_events enable row level security;
alter table refunds enable row level security;
alter table lessons enable row level security;
alter table logbooks enable row level security;
alter table logbook_entries enable row level security;
alter table logbook_entry_revisions enable row level security;
alter table logbook_reviews enable row level security;
alter table tutor_earnings enable row level security;

-- Signed-in users may read (RLS filters rows) but never write directly: every change goes through a function.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public grant select on tables to authenticated;
