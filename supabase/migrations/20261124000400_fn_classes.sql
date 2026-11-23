-- Class administration (admin only) and the student catalog.

-- Second line of defence for "capacity cannot go below the seats already held".
-- Seats are held by enrollments in these statuses: pending_payment, awaiting_verification, active.
create function classes_capacity_guard() returns trigger
language plpgsql as $$
declare
  v_held int;
begin
  select count(*) into v_held from enrollments
  where class_id = new.id and status in ('pending_payment', 'awaiting_verification', 'active');
  if new.capacity < v_held then
    perform fail('CAPACITY_BELOW_SEATS', format('%s seats are already held, so capacity cannot go below that', v_held));
  end if;
  return new;
end $$;

create trigger classes_capacity_check
  before update of capacity on classes
  for each row execute function classes_capacity_guard();

create function create_class(
  p_name text,
  p_description text,
  p_tutor_id uuid,
  p_capacity int,
  p_package_hours int,
  p_student_rate bigint,
  p_tutor_rate bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform require_admin();
  if btrim(coalesce(p_name, '')) = '' then perform fail('VALIDATION', 'the class needs a name'); end if;
  if p_capacity is null or p_capacity <= 0 then perform fail('VALIDATION', 'capacity must be at least 1'); end if;
  if p_package_hours is null or p_package_hours <= 0 then perform fail('VALIDATION', 'package hours must be at least 1'); end if;
  if p_student_rate is null or p_student_rate < 0 or p_tutor_rate is null or p_tutor_rate < 0 then
    perform fail('VALIDATION', 'rates cannot be negative');
  end if;

  insert into classes (name, description, tutor_id, capacity, package_hours, created_by)
  values (btrim(p_name), coalesce(p_description, ''), p_tutor_id, p_capacity, p_package_hours, auth.uid())
  returning id into v_id; -- the trigger rejects a tutor_id that is not a tutor

  -- The first rate applies from the beginning of time, so lessons recorded in the past still find a rate.
  insert into class_rates (class_id, effective_from, student_rate_per_hour, tutor_rate_per_hour, created_by)
  values (v_id, '2000-01-01 00:00:00+00', p_student_rate, p_tutor_rate, auth.uid());

  return v_id;
end $$;

create function update_class_details(p_class_id uuid, p_name text, p_description text, p_package_hours int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if btrim(coalesce(p_name, '')) = '' then perform fail('VALIDATION', 'the class needs a name'); end if;
  if p_package_hours is null or p_package_hours <= 0 then perform fail('VALIDATION', 'package hours must be at least 1'); end if;
  update classes
  set name = btrim(p_name), description = coalesce(p_description, ''), package_hours = p_package_hours
  where id = p_class_id;
  if not found then perform fail('NOT_FOUND', 'class not found'); end if;
end $$;

-- Adds a history row effective now. Issued invoices and lessons already taught keep the rate they had
-- (changes apply forward only); new invoices and lessons starting later use the new rate.
create function set_class_rates(p_class_id uuid, p_student_rate bigint, p_tutor_rate bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_student_rate is null or p_student_rate < 0 or p_tutor_rate is null or p_tutor_rate < 0 then
    perform fail('VALIDATION', 'rates cannot be negative');
  end if;
  if not exists (select 1 from classes where id = p_class_id) then perform fail('NOT_FOUND', 'class not found'); end if;
  insert into class_rates (class_id, effective_from, student_rate_per_hour, tutor_rate_per_hour, created_by)
  values (p_class_id, clock_timestamp(), p_student_rate, p_tutor_rate, auth.uid());
end $$;

create function set_class_capacity(p_class_id uuid, p_capacity int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_capacity is null or p_capacity <= 0 then perform fail('VALIDATION', 'capacity must be at least 1'); end if;
  -- Locks the class row, so it cannot race with a student enrolling at the same moment.
  perform 1 from classes where id = p_class_id for update;
  if not found then perform fail('NOT_FOUND', 'class not found'); end if;
  update classes set capacity = p_capacity where id = p_class_id; -- the trigger enforces the lower bound
end $$;

-- Catalog for students: enough to decide and enroll, no schedule or logbooks, never the tutor rate.
create function list_open_classes()
returns table (
  class_id uuid,
  name text,
  description text,
  tutor_name text,
  package_hours int,
  package_price bigint,
  seats_left int,
  my_enrollment_id uuid,
  my_enrollment_status enrollment_status
)
language sql stable security definer set search_path = public as $$
  select
    c.id, c.name, c.description, p.full_name, c.package_hours,
    c.package_hours * r.student_rate_per_hour,
    greatest(c.capacity - coalesce(seats.n, 0), 0)::int,
    mine.id, mine.status
  from classes c
  join profiles p on p.id = c.tutor_id
  join lateral (
    select cr.student_rate_per_hour from class_rates cr
    where cr.class_id = c.id and cr.effective_from <= now()
    order by cr.effective_from desc limit 1
  ) r on true
  left join lateral (
    select count(*) as n from enrollments e
    where e.class_id = c.id and e.status in ('pending_payment', 'awaiting_verification', 'active')
  ) seats on true
  left join lateral (
    select e.id, e.status from enrollments e
    where e.class_id = c.id and e.student_id = auth.uid()
    order by (e.status in ('pending_payment', 'awaiting_verification', 'active')) desc, e.created_at desc
    limit 1
  ) mine on true
  where auth.uid() is not null
  order by c.name
$$;

revoke all on function classes_capacity_guard(), create_class(text, text, uuid, int, int, bigint, bigint),
  update_class_details(uuid, text, text, int), set_class_rates(uuid, bigint, bigint),
  set_class_capacity(uuid, int), list_open_classes() from public, anon;
grant execute on function create_class(text, text, uuid, int, int, bigint, bigint),
  update_class_details(uuid, text, text, int), set_class_rates(uuid, bigint, bigint),
  set_class_capacity(uuid, int), list_open_classes() to authenticated;
