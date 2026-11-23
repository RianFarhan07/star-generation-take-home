-- Tightens two things in the lesson functions after review:
--   1. cancel_lesson uses the same gate as every other lesson function: the admin or the class's CURRENT
--      tutor. A tutor who was replaced can no longer cancel old lessons of a class they stopped teaching.
--   2. create_lesson checks permission before existence, so a non-admin learns nothing about class ids.
-- A cancelled lesson's logbook entry is still removed (the event did not happen), but its text and any
-- admin-edit history are kept on the lesson row so the removal stays auditable.

alter table lessons add column cancelled_entry_snapshot jsonb;

create or replace function create_lesson(p_class_id uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_id uuid;
begin
  if not can_manage_lessons(p_class_id) then
    perform fail('NOT_ALLOWED', 'only the class''s tutor or an admin can schedule lessons');
  end if;
  select * into v_class from classes where id = p_class_id;
  if not found then perform fail('NOT_FOUND', 'class not found'); end if; -- only an admin can get here
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    perform fail('VALIDATION', 'the lesson must end after it starts');
  end if;

  begin
    insert into lessons (class_id, tutor_id, starts_at, ends_at, created_by)
    values (p_class_id, v_class.tutor_id, p_starts_at, p_ends_at, auth.uid())
    returning id into v_id;
  exception when exclusion_violation then
    perform fail('LESSON_OVERLAP', 'the tutor already has a lesson at that time');
  end;
  return v_id;
end $$;

create or replace function cancel_lesson(p_lesson_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lesson lessons;
  v_snapshot jsonb;
begin
  select * into v_lesson from lessons where id = p_lesson_id for update;
  if not found then perform fail('NOT_FOUND', 'lesson not found'); end if;
  if not can_manage_lessons(v_lesson.class_id) then
    perform fail('NOT_ALLOWED', 'only the class''s current tutor or an admin can cancel a lesson');
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
  set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now(),
      cancelled_entry_snapshot = v_snapshot
  where id = p_lesson_id;

  delete from logbook_entry_revisions where entry_id in (select id from logbook_entries where lesson_id = p_lesson_id);
  update logbook_reviews set entry_id = null where entry_id in (select id from logbook_entries where lesson_id = p_lesson_id);
  delete from logbook_entries where lesson_id = p_lesson_id;
end $$;

revoke all on function create_lesson(uuid, timestamptz, timestamptz), cancel_lesson(uuid, text) from public, anon;
grant execute on function create_lesson(uuid, timestamptz, timestamptz), cancel_lesson(uuid, text) to authenticated;
