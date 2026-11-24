-- A lesson belongs to the tutor who teaches it.
--
-- After the admin changes the tutor of a class, the lessons that already started stay with the old tutor (their
-- record and their pay). The new tutor manages the class, so can_manage_lessons() let them cancel or move those
-- lessons too, which would erase the old tutor's work. Cancelling or moving an existing lesson now needs to be
-- its own tutor (who must still teach the class) or an admin. Admins keep full control: they are the way out
-- when a month is stuck, for example a lesson whose former tutor never wrote an entry.
--
-- Scheduling a new lesson is unchanged (create_lesson still needs can_manage_lessons).

create function can_change_lesson(p_class_id uuid, p_lesson_tutor_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (is_class_tutor(p_class_id) and p_lesson_tutor_id = auth.uid())
$$;

create or replace function update_lesson_time(p_lesson_id uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lesson lessons;
begin
  select * into v_lesson from lessons where id = p_lesson_id for update;
  if not found then perform fail('NOT_FOUND', 'lesson not found'); end if;
  if not can_change_lesson(v_lesson.class_id, v_lesson.tutor_id) then
    perform fail('NOT_ALLOWED', 'only the tutor who teaches the lesson (and still teaches the class) or an admin can change it');
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

create or replace function cancel_lesson(p_lesson_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lesson lessons;
  v_snapshot jsonb;
begin
  select * into v_lesson from lessons where id = p_lesson_id for update;
  if not found then perform fail('NOT_FOUND', 'lesson not found'); end if;
  if not can_change_lesson(v_lesson.class_id, v_lesson.tutor_id) then
    perform fail('NOT_ALLOWED', 'only the tutor who teaches the lesson (and still teaches the class) or an admin can cancel it');
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    perform fail('VALIDATION', 'a reason is required to cancel a lesson');
  end if;
  if v_lesson.status = 'cancelled' then
    perform fail('INVALID_STATE', 'this lesson is already cancelled');
  end if;

  select jsonb_build_object(
           'entry', to_jsonb(e),
           'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.edited_at) from logbook_entry_revisions r where r.entry_id = e.id), '[]'::jsonb))
    into v_snapshot
  from logbook_entries e where e.lesson_id = p_lesson_id;

  -- The month lock trigger refuses this when the month's logbook is submitted or approved.
  update lessons
  set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
  where id = p_lesson_id;

  -- The lesson did not happen, so an entry written for it is removed; the text is kept for the admin only.
  if v_snapshot is not null then
    insert into cancelled_lesson_snapshots (lesson_id, snapshot, cancelled_by) values (p_lesson_id, v_snapshot, auth.uid());
  end if;
  delete from logbook_entry_revisions where entry_id in (select id from logbook_entries where lesson_id = p_lesson_id);
  update logbook_reviews set entry_id = null where entry_id in (select id from logbook_entries where lesson_id = p_lesson_id);
  delete from logbook_entries where lesson_id = p_lesson_id;
end $$;

revoke all on function can_change_lesson(uuid, uuid) from public, anon, authenticated;
revoke all on function update_lesson_time(uuid, timestamptz, timestamptz), cancel_lesson(uuid, text) from public, anon;
grant execute on function update_lesson_time(uuid, timestamptz, timestamptz), cancel_lesson(uuid, text) to authenticated;
