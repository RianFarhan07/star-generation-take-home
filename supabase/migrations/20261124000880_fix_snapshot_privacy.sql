-- The snapshot of a logbook entry removed by a lesson cancellation must stay private. Students (once
-- paid) and tutors can read lesson rows, so storing the text on the lesson would leak a draft logbook
-- through the API. It moves to its own table that only an admin can read.

create table cancelled_lesson_snapshots (
  lesson_id uuid primary key references lessons (id),
  snapshot jsonb not null,
  cancelled_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

alter table cancelled_lesson_snapshots enable row level security;
create policy cancelled_snapshots_admin on cancelled_lesson_snapshots for select to authenticated using (is_admin());

alter table lessons drop column cancelled_entry_snapshot;

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

revoke all on function cancel_lesson(uuid, text) from public, anon;
grant execute on function cancel_lesson(uuid, text) to authenticated;
