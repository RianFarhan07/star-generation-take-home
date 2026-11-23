-- Helper functions and read policies (RLS).
--
-- Principle: every table is read through RLS; nobody writes tables directly (writes = functions).
-- Helpers are SECURITY DEFINER so a policy can ask "is this caller the class tutor?" without that
-- question being filtered by RLS itself (which would otherwise recurse). They only ever answer
-- questions about the caller (auth.uid()), so granting them to signed-in users leaks nothing.

-- Internal: raise our error format "CODE: message" (the app maps the CODE to a friendly message).
create function fail(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception '%: %', p_code, p_message using errcode = 'P0001';
end $$;

create function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- Internal: first line of every admin-only function.
create function require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    perform fail('NOT_ALLOWED', 'only an admin can do this');
  end if;
end $$;

-- The class's current tutor.
create function is_class_tutor(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = p_class_id and tutor_id = auth.uid())
$$;

-- Current tutor, or a tutor who taught a lesson in the class before being replaced.
create function teaches_in_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_class_tutor(p_class_id)
      or exists (select 1 from lessons where class_id = p_class_id and tutor_id = auth.uid())
$$;

create function has_active_enrollment(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments
    where class_id = p_class_id and student_id = auth.uid() and status = 'active'
  )
$$;

create function has_any_enrollment(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments where class_id = p_class_id and student_id = auth.uid())
$$;

create function owns_enrollment(p_enrollment_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments where id = p_enrollment_id and student_id = auth.uid())
$$;

create function owns_invoice(p_invoice_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from invoices i join enrollments e on e.id = i.enrollment_id
    where i.id = p_invoice_id and e.student_id = auth.uid()
  )
$$;

-- Tutor <-> student link, in both directions, for reading each other's names.
create function shares_class_with(p_profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e join classes c on c.id = e.class_id
    where (c.tutor_id = auth.uid() and e.student_id = p_profile_id)
       or (e.student_id = auth.uid() and e.status = 'active' and c.tutor_id = p_profile_id)
  )
$$;

create function logbook_class_id(p_logbook_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select class_id from logbooks where id = p_logbook_id
$$;

create function entry_class_id(p_entry_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select l.class_id from logbook_entries e join logbooks l on l.id = e.logbook_id where e.id = p_entry_id
$$;

-- The WIB month (first day) a lesson belongs to. A lesson at 06:00 WIB on the 1st is 23:00 UTC the
-- day before, so the zone conversion matters.
create function lesson_month(p_ts timestamptz) returns date
language sql immutable as $$
  select date_trunc('month', p_ts at time zone 'Asia/Jakarta')::date
$$;

-- Internal: rate that applies at a moment (the latest history row effective at or before it).
-- Not granted to signed-in users: it contains the student rate.
create function current_class_rate(p_class_id uuid, p_at timestamptz default now()) returns class_rates
language sql stable security definer set search_path = public as $$
  select * from class_rates
  where class_id = p_class_id and effective_from <= p_at
  order by effective_from desc
  limit 1
$$;

-- Function privileges: nothing is public by default.
revoke all on function fail(text, text), require_admin(), current_class_rate(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function auth_role(), is_admin(), is_class_tutor(uuid), teaches_in_class(uuid),
  has_active_enrollment(uuid), has_any_enrollment(uuid), owns_enrollment(uuid), owns_invoice(uuid),
  shares_class_with(uuid), logbook_class_id(uuid), entry_class_id(uuid), lesson_month(timestamptz)
  from public, anon;
grant execute on function auth_role(), is_admin(), is_class_tutor(uuid), teaches_in_class(uuid),
  has_active_enrollment(uuid), has_any_enrollment(uuid), owns_enrollment(uuid), owns_invoice(uuid),
  shares_class_with(uuid), logbook_class_id(uuid), entry_class_id(uuid), lesson_month(timestamptz)
  to authenticated;

-- ---------------------------------------------------------------- read policies (select only)

create policy profiles_admin on profiles for select to authenticated using (is_admin());
create policy profiles_self on profiles for select to authenticated using (id = auth.uid());
create policy profiles_linked on profiles for select to authenticated using (shares_class_with(id));

create policy classes_admin on classes for select to authenticated using (is_admin());
create policy classes_tutor on classes for select to authenticated using (teaches_in_class(id));
create policy classes_student on classes for select to authenticated using (has_any_enrollment(id));

-- class_rates: admin only (rates never reach tutors or students).
create policy class_rates_admin on class_rates for select to authenticated using (is_admin());

create policy enrollments_admin on enrollments for select to authenticated using (is_admin());
create policy enrollments_tutor on enrollments for select to authenticated using (is_class_tutor(class_id));
create policy enrollments_student on enrollments for select to authenticated using (student_id = auth.uid());

create policy invoices_admin on invoices for select to authenticated using (is_admin());
create policy invoices_student on invoices for select to authenticated using (owns_enrollment(enrollment_id));

create policy payments_admin on payments for select to authenticated using (is_admin());
create policy payments_student on payments for select to authenticated using (owns_invoice(invoice_id));

create policy invoice_events_admin on invoice_events for select to authenticated using (is_admin());
create policy invoice_events_student on invoice_events for select to authenticated using (owns_invoice(invoice_id));

create policy refunds_admin on refunds for select to authenticated using (is_admin());
create policy refunds_student on refunds for select to authenticated using (owns_enrollment(enrollment_id));

create policy lessons_admin on lessons for select to authenticated using (is_admin());
create policy lessons_tutor on lessons for select to authenticated using (is_class_tutor(class_id) or tutor_id = auth.uid());
-- Students see the schedule only while their enrollment is active (= they have paid).
create policy lessons_student on lessons for select to authenticated using (has_active_enrollment(class_id));

create policy logbooks_admin on logbooks for select to authenticated using (is_admin());
create policy logbooks_tutor on logbooks for select to authenticated using (teaches_in_class(class_id));
-- Logbooks stay hidden from students until approved, through the API too.
create policy logbooks_student on logbooks for select to authenticated
  using (status = 'approved' and has_active_enrollment(class_id));

create policy entries_admin on logbook_entries for select to authenticated using (is_admin());
create policy entries_tutor on logbook_entries for select to authenticated
  using (author_id = auth.uid() or is_class_tutor(logbook_class_id(logbook_id)));
create policy entries_student on logbook_entries for select to authenticated
  using (
    has_active_enrollment(logbook_class_id(logbook_id))
    and exists (select 1 from logbooks l where l.id = logbook_id and l.status = 'approved')
  );

create policy reviews_admin on logbook_reviews for select to authenticated using (is_admin());
create policy reviews_tutor on logbook_reviews for select to authenticated using (is_class_tutor(logbook_class_id(logbook_id)));

create policy revisions_admin on logbook_entry_revisions for select to authenticated using (is_admin());
create policy revisions_tutor on logbook_entry_revisions for select to authenticated
  using (is_class_tutor(entry_class_id(entry_id)));

create policy earnings_admin on tutor_earnings for select to authenticated using (is_admin());
create policy earnings_tutor on tutor_earnings for select to authenticated using (tutor_id = auth.uid());
