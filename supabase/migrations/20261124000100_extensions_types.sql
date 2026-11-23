-- Extensions and enum types.

create extension if not exists btree_gist with schema extensions; -- exclusion constraint on (tutor, time range)
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;                            -- scheduled jobs (payment windows, renewals)

create type user_role as enum ('admin', 'tutor', 'student');

-- pending_payment: seat locked, invoice issued, waiting for the transfer report (24 h window)
-- awaiting_verification: student reported a transfer, admin has not verified yet
-- active: at least one invoice verified as paid
create type enrollment_status as enum ('pending_payment', 'awaiting_verification', 'active', 'cancelled', 'withdrawn');
create type end_cause as enum ('student', 'business', 'expired', 'rejected', 'not_renewed');

create type invoice_kind as enum ('initial', 'renewal');
create type invoice_status as enum ('unpaid', 'awaiting_verification', 'paid', 'cancelled');

create type payment_kind as enum ('transfer_report', 'offline');
create type payment_status as enum ('pending', 'verified', 'rejected', 'reversed');

create type refund_cause as enum ('business', 'exception', 'late_no_seat');
create type refund_status as enum ('pending', 'refunded', 'cancelled');

create type lesson_status as enum ('scheduled', 'cancelled');
create type logbook_status as enum ('draft', 'submitted', 'changes_requested', 'approved');
create type review_action as enum ('submitted', 'changes_requested', 'admin_edited', 'approved');
