-- Monthly logbooks: one per class per month (UNIQUE class_id + month), one entry per lesson that has
-- ended (UNIQUE lesson_id), four required text fields, and read-only once submitted or approved.
--
-- Status flow: draft -> submitted -> (changes_requested -> submitted)* -> approved.
--   draft / changes_requested : the tutor can write entries
--   submitted                 : locked for the tutor; only the admin edit function may touch the text
--   approved                  : read-only for everybody (enforced by triggers, so direct writes fail too)

-- An entry describes something that happened: the lesson must have ended, not be cancelled, and
-- belong to the same class and WIB month as the logbook.
create function entries_validity() returns trigger
language plpgsql set search_path = public as $$
declare
  v_lesson lessons;
  v_logbook logbooks;
begin
  select * into v_lesson from lessons where id = new.lesson_id;
  select * into v_logbook from logbooks where id = new.logbook_id;
  if v_lesson.status <> 'scheduled' then
    perform fail('VALIDATION', 'a cancelled lesson cannot have a logbook entry');
  end if;
  if v_lesson.ends_at > now() then
    perform fail('LESSON_NOT_ENDED', 'an entry can only be written after the lesson has ended');
  end if;
  if v_lesson.class_id <> v_logbook.class_id or lesson_month(v_lesson.starts_at) <> v_logbook.month then
    perform fail('VALIDATION', 'this lesson does not belong to that logbook');
  end if;
  return new;
end $$;

create trigger entries_validity_check
  before insert or update of lesson_id, logbook_id on logbook_entries
  for each row execute function entries_validity();

-- Read-only once approved; locked while submitted unless the admin edit function opened the gate.
create function entries_lock() returns trigger
language plpgsql set search_path = public as $$
declare
  v_status logbook_status;
begin
  select status into v_status from logbooks
  where id = case when tg_op = 'DELETE' then old.logbook_id else new.logbook_id end;
  if v_status = 'approved' then
    perform fail('INVALID_STATE', 'an approved logbook is read-only');
  elsif v_status = 'submitted' and coalesce(current_setting('app.admin_edit', true), '') <> 'on' then
    perform fail('INVALID_STATE', 'a submitted logbook is locked');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger entries_lock_check
  before insert or update or delete on logbook_entries
  for each row execute function entries_lock();

-- An approved logbook never changes again (nobody can reopen it or edit its status).
create function logbooks_approved_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'approved' then
    perform fail('INVALID_STATE', 'an approved logbook is read-only');
  end if;
  return new;
end $$;

create trigger logbooks_approved_check
  before update on logbooks
  for each row execute function logbooks_approved_lock();

-- The lesson's own tutor writes the entry. The month's logbook is created on the first entry.
create function upsert_logbook_entry(
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
        recommendation = excluded.recommendation, updated_at = now()
  returning id into v_entry;
  return v_entry;
end $$;

-- The class's current tutor finalises the month. Every lesson of that month must have ended and have an entry.
create function submit_logbook(p_logbook_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_logbook logbooks;
begin
  select * into v_logbook from logbooks where id = p_logbook_id for update;
  if not found or not is_class_tutor(v_logbook.class_id) then
    perform fail('NOT_ALLOWED', 'only the class''s tutor can submit its logbook');
  end if;
  if v_logbook.status not in ('draft', 'changes_requested') then
    perform fail('INVALID_STATE', 'this logbook has already been submitted');
  end if;
  if not exists (select 1 from logbook_entries where logbook_id = p_logbook_id)
     or exists (
       select 1 from lessons l
       where l.class_id = v_logbook.class_id and l.status = 'scheduled'
         and lesson_month(l.starts_at) = v_logbook.month
         and (l.ends_at > now() or not exists (select 1 from logbook_entries e where e.lesson_id = l.id))
     ) then
    perform fail('LOGBOOK_INCOMPLETE', 'every lesson of the month must have ended and have an entry before submitting');
  end if;

  update logbooks set status = 'submitted', submitted_at = now(), submitted_by = auth.uid() where id = p_logbook_id;
  insert into logbook_reviews (logbook_id, action, actor_id) values (p_logbook_id, 'submitted', auth.uid());
end $$;

-- Admin sends the logbook back with a comment and optionally flags entries.
create function request_logbook_changes(p_logbook_id uuid, p_comment text, p_flagged_entry_ids uuid[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_logbook logbooks;
  v_flagged uuid[] := coalesce(p_flagged_entry_ids, '{}');
  v_entry uuid;
begin
  perform require_admin();
  if btrim(coalesce(p_comment, '')) = '' then perform fail('VALIDATION', 'a comment is required'); end if;
  select * into v_logbook from logbooks where id = p_logbook_id for update;
  if not found then perform fail('NOT_FOUND', 'logbook not found'); end if;
  if v_logbook.status <> 'submitted' then
    perform fail('INVALID_STATE', 'only a submitted logbook can be sent back');
  end if;
  if (select count(*) from logbook_entries where logbook_id = p_logbook_id and id = any (v_flagged))
     <> (select count(distinct x) from unnest(v_flagged) as x) then
    perform fail('VALIDATION', 'a flagged entry does not belong to this logbook');
  end if;

  update logbooks set status = 'changes_requested' where id = p_logbook_id;
  insert into logbook_reviews (logbook_id, action, comment, actor_id)
  values (p_logbook_id, 'changes_requested', btrim(p_comment), auth.uid());
  for v_entry in select distinct x from unnest(v_flagged) as x loop
    insert into logbook_reviews (logbook_id, action, comment, entry_id, actor_id)
    values (p_logbook_id, 'changes_requested', btrim(p_comment), v_entry, auth.uid());
  end loop;
end $$;

-- Quick fix by the admin while the logbook is submitted. The previous text is kept, the entry is marked
-- as edited by the admin, and the tutor can see what changed.
create function admin_edit_entry(
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

  insert into logbook_entry_revisions (entry_id, topic, activities, observation, recommendation, edited_by)
  values (p_entry_id, v_entry.topic, v_entry.activities, v_entry.observation, v_entry.recommendation, auth.uid());

  perform set_config('app.admin_edit', 'on', true); -- opens the gate in entries_lock for this transaction only
  update logbook_entries
  set topic = btrim(p_topic), activities = btrim(p_activities), observation = btrim(p_observation),
      recommendation = btrim(p_recommendation), edited_by_admin = true, updated_at = now()
  where id = p_entry_id;
  perform set_config('app.admin_edit', 'off', true);

  insert into logbook_reviews (logbook_id, action, entry_id, actor_id)
  values (v_entry.logbook_id, 'admin_edited', p_entry_id, auth.uid());
end $$;

revoke all on function entries_validity(), entries_lock(), logbooks_approved_lock(),
  upsert_logbook_entry(uuid, text, text, text, text), submit_logbook(uuid),
  request_logbook_changes(uuid, text, uuid[]), admin_edit_entry(uuid, text, text, text, text)
  from public, anon;
grant execute on function upsert_logbook_entry(uuid, text, text, text, text), submit_logbook(uuid),
  request_logbook_changes(uuid, text, uuid[]), admin_edit_entry(uuid, text, text, text, text) to authenticated;
