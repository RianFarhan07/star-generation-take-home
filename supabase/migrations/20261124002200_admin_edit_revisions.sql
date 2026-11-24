-- The admin's edit screen now saves automatically, so one entry can be saved many times in a row.
--
-- The previous version we keep is the tutor's text, which is what "the tutor's original text is kept" asks for.
-- So a revision is written only when the text being replaced is the tutor's (the entry is not yet marked as edited
-- by the admin); further saves just update the admin's own text. When the tutor rewrites the entry (after changes
-- were requested) the mark is cleared, so the next admin edit again keeps the tutor's new text.
-- Saving the same text again does nothing.

create or replace function admin_edit_entry(
  p_entry_id uuid,
  p_topic text,
  p_activities text,
  p_observation text,
  p_recommendation text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry logbook_entries;
  v_status logbook_status;
begin
  perform require_admin();
  if btrim(coalesce(p_topic, '')) = '' or btrim(coalesce(p_activities, '')) = ''
     or btrim(coalesce(p_observation, '')) = '' or btrim(coalesce(p_recommendation, '')) = '' then
    perform fail('VALIDATION', 'topic, activities, observation and recommendation are all required');
  end if;
  select * into v_entry from logbook_entries where id = p_entry_id for update;
  if not found then perform fail('NOT_FOUND', 'entry not found'); end if;
  select status into v_status from logbooks where id = v_entry.logbook_id for update;
  if v_status <> 'submitted' then
    perform fail('INVALID_STATE', 'an entry can only be edited by the admin while its logbook is submitted');
  end if;

  if v_entry.topic = btrim(p_topic) and v_entry.activities = btrim(p_activities)
     and v_entry.observation = btrim(p_observation) and v_entry.recommendation = btrim(p_recommendation) then
    return; -- nothing changed
  end if;

  if not v_entry.edited_by_admin then
    insert into logbook_entry_revisions (entry_id, topic, activities, observation, recommendation, edited_by)
    values (p_entry_id, v_entry.topic, v_entry.activities, v_entry.observation, v_entry.recommendation, auth.uid());
    insert into logbook_reviews (logbook_id, action, entry_id, actor_id)
    values (v_entry.logbook_id, 'admin_edited', p_entry_id, auth.uid());
  end if;

  perform set_config('app.admin_edit', 'on', true); -- opens the gate in entries_lock for this transaction only
  update logbook_entries
  set topic = btrim(p_topic), activities = btrim(p_activities), observation = btrim(p_observation),
      recommendation = btrim(p_recommendation), edited_by_admin = true, updated_at = now()
  where id = p_entry_id;
  perform set_config('app.admin_edit', 'off', true);
end $$;

create or replace function upsert_logbook_entry(
  p_lesson_id uuid,
  p_topic text,
  p_activities text,
  p_observation text,
  p_recommendation text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_lesson lessons;
  v_logbook logbooks;
  v_entry uuid;
begin
  select * into v_lesson from lessons where id = p_lesson_id;
  if not found or v_lesson.tutor_id is distinct from auth.uid() then
    perform fail('NOT_ALLOWED', 'only the tutor who taught the lesson can write its entry');
  end if;
  if btrim(coalesce(p_topic, '')) = '' or btrim(coalesce(p_activities, '')) = ''
     or btrim(coalesce(p_observation, '')) = '' or btrim(coalesce(p_recommendation, '')) = '' then
    perform fail('VALIDATION', 'topic, activities, observation and recommendation are all required');
  end if;
  if v_lesson.status <> 'scheduled' then
    perform fail('VALIDATION', 'a cancelled lesson cannot have a logbook entry');
  end if;
  if v_lesson.ends_at > now() then
    perform fail('LESSON_NOT_ENDED', 'an entry can only be written after the lesson has ended');
  end if;

  insert into logbooks (class_id, month) values (v_lesson.class_id, lesson_month(v_lesson.starts_at))
  on conflict (class_id, month) do nothing;
  select * into v_logbook from logbooks
  where class_id = v_lesson.class_id and month = lesson_month(v_lesson.starts_at) for update;
  if v_logbook.status in ('submitted', 'approved') then
    perform fail('INVALID_STATE', 'this logbook has been submitted, so its entries can no longer change');
  end if;

  insert into logbook_entries (logbook_id, lesson_id, topic, activities, observation, recommendation, author_id)
  values (v_logbook.id, p_lesson_id, btrim(p_topic), btrim(p_activities), btrim(p_observation), btrim(p_recommendation), auth.uid())
  on conflict (lesson_id) do update
    set topic = excluded.topic, activities = excluded.activities, observation = excluded.observation,
        recommendation = excluded.recommendation, updated_at = now(),
        edited_by_admin = false -- the text is the tutor's again
  returning id into v_entry;
  return v_entry;
end $$;
