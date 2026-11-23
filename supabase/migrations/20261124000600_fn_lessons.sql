-- Lessons: scheduling in absolute time (WIB at the edges), overlap prevention, soft cancellation.
-- Lessons are never deleted; a cancelled lesson keeps its row (and reason) but frees its time slot
-- (the exclusion constraint ignores cancelled lessons).

-- Once a month's logbook is submitted or approved, that month's lessons are frozen: nothing can be
-- added, moved or cancelled, so the admin reviews a stable record. A returned logbook
-- (changes_requested) unlocks the month again.
create function lessons_month_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from logbooks
    where class_id = new.class_id and month = lesson_month(new.starts_at) and status in ('submitted', 'approved')
  ) then
    perform fail('MONTH_LOCKED', 'that month''s logbook has been submitted, so its lessons can no longer change');
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from logbooks
    where class_id = old.class_id and month = lesson_month(old.starts_at) and status in ('submitted', 'approved')
  ) then
    perform fail('MONTH_LOCKED', 'that month''s logbook has been submitted, so its lessons can no longer change');
  end if;
  return new;
end $$;

create trigger lessons_month_check
  before insert or update on lessons
  for each row execute function lessons_month_lock();

-- Internal: may the caller schedule or cancel lessons of this class? (admin or the class's current tutor)
create function can_manage_lessons(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or is_class_tutor(p_class_id)
$$;

create function create_lesson(p_class_id uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_id uuid;
begin
  select * into v_class from classes where id = p_class_id;
  if not found then perform fail('NOT_FOUND', 'class not found'); end if;
  if not can_manage_lessons(p_class_id) then
    perform fail('NOT_ALLOWED', 'only the class''s tutor or an admin can schedule lessons');
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    perform fail('VALIDATION', 'the lesson must end after it starts');
  end if;

  -- Past times are allowed so a lesson that really happened can still be recorded.
  begin
    insert into lessons (class_id, tutor_id, starts_at, ends_at, created_by)
    values (p_class_id, v_class.tutor_id, p_starts_at, p_ends_at, auth.uid())
    returning id into v_id;
  exception when exclusion_violation then
    perform fail('LESSON_OVERLAP', 'the tutor already has a lesson at that time');
  end;
  return v_id;
end $$;

create function update_lesson_time(p_lesson_id uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lesson lessons;
begin
  select * into v_lesson from lessons where id = p_lesson_id for update;
  if not found then perform fail('NOT_FOUND', 'lesson not found'); end if;
  if not can_manage_lessons(v_lesson.class_id) then
    perform fail('NOT_ALLOWED', 'only the class''s tutor or an admin can change lessons');
  end if;
  if v_lesson.status = 'cancelled' then
    perform fail('INVALID_STATE', 'a cancelled lesson cannot be changed');
  end if;
  if exists (select 1 from logbook_entries where lesson_id = p_lesson_id) then
    perform fail('INVALID_STATE', 'this lesson already has a logbook entry, so its time can no longer change');
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    perform fail('VALIDATION', 'the lesson must end after it starts');
  end if;

  begin
    update lessons set starts_at = p_starts_at, ends_at = p_ends_at where id = p_lesson_id;
  exception when exclusion_violation then
    perform fail('LESSON_OVERLAP', 'the tutor already has a lesson at that time');
  end;
end $$;

-- Soft cancel: no hours are deducted, no earning, no entry needed, and the slot is free again.
create function cancel_lesson(p_lesson_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lesson lessons;
begin
  select * into v_lesson from lessons where id = p_lesson_id for update;
  if not found then perform fail('NOT_FOUND', 'lesson not found'); end if;
  if not (can_manage_lessons(v_lesson.class_id) or v_lesson.tutor_id = auth.uid()) then
    perform fail('NOT_ALLOWED', 'only the lesson''s tutor or an admin can cancel it');
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    perform fail('VALIDATION', 'a reason is required to cancel a lesson');
  end if;
  if v_lesson.status = 'cancelled' then
    perform fail('INVALID_STATE', 'this lesson is already cancelled');
  end if;

  -- The month lock trigger refuses this when the month's logbook is submitted or approved.
  update lessons
  set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
  where id = p_lesson_id;

  -- A cancelled lesson did not happen: drop an entry that was already written for it.
  delete from logbook_entry_revisions where entry_id in (select id from logbook_entries where lesson_id = p_lesson_id);
  update logbook_reviews set entry_id = null where entry_id in (select id from logbook_entries where lesson_id = p_lesson_id);
  delete from logbook_entries where lesson_id = p_lesson_id;
end $$;

revoke all on function lessons_month_lock(), can_manage_lessons(uuid),
  create_lesson(uuid, timestamptz, timestamptz), update_lesson_time(uuid, timestamptz, timestamptz),
  cancel_lesson(uuid, text) from public, anon, authenticated;
grant execute on function create_lesson(uuid, timestamptz, timestamptz), update_lesson_time(uuid, timestamptz, timestamptz),
  cancel_lesson(uuid, text) to authenticated;
