-- Tutor earnings: tutor rate x lesson hours, paid once per lesson of an APPROVED logbook.
--   * the amount uses the tutor rate in force when the lesson STARTED (rate history, Decision 2)
--   * earnings are written at approval and never change afterwards (frozen)
--   * approving again adds nothing: row lock + status check, and UNIQUE(lesson_id) as the last line
--   * one SQL function computes a lesson's earning; the admin preview, the approval and the tutor's
--     statement all use it, so the three can never disagree

-- Internal: what one lesson earns. Half-up rounding to whole rupiah (90 min x Rp100,000/h = Rp150,000).
create function lesson_earning(p_lesson_id uuid) returns table (minutes int, rate_per_hour bigint, amount bigint)
language sql stable security definer set search_path = public as $$
  select l.duration_minutes,
         r.tutor_rate_per_hour,
         (l.duration_minutes * r.tutor_rate_per_hour + 30) / 60
  from lessons l
  cross join lateral current_class_rate(l.class_id, l.starts_at) r
  where l.id = p_lesson_id
$$;

create function preview_logbook_earnings(p_logbook_id uuid)
returns table (
  lesson_id uuid,
  starts_at timestamptz,
  tutor_id uuid,
  tutor_name text,
  minutes int,
  rate_per_hour bigint,
  amount bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  if not exists (select 1 from logbooks where id = p_logbook_id) then perform fail('NOT_FOUND', 'logbook not found'); end if;
  return query
    select l.id, l.starts_at, l.tutor_id, p.full_name, e.minutes, e.rate_per_hour, e.amount
    from logbook_entries le
    join lessons l on l.id = le.lesson_id
    join profiles p on p.id = l.tutor_id
    cross join lateral lesson_earning(l.id) e
    where le.logbook_id = p_logbook_id
    order by l.starts_at;
end $$;

-- Admin approval. Returns how many earnings were created (0 when it was already approved).
create function approve_logbook(p_logbook_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_logbook logbooks;
  v_created int;
begin
  perform require_admin();
  select * into v_logbook from logbooks where id = p_logbook_id for update; -- a second approval waits here
  if not found then perform fail('NOT_FOUND', 'logbook not found'); end if;
  if v_logbook.status = 'approved' then
    return 0; -- idempotent: nothing is added the second time
  end if;
  if v_logbook.status <> 'submitted' then
    perform fail('INVALID_STATE', 'only a submitted logbook can be approved');
  end if;

  insert into tutor_earnings (lesson_id, logbook_id, tutor_id, class_id, minutes, rate_per_hour, amount)
  select l.id, p_logbook_id, l.tutor_id, l.class_id, e.minutes, e.rate_per_hour, e.amount
  from logbook_entries le
  join lessons l on l.id = le.lesson_id
  cross join lateral lesson_earning(l.id) e
  where le.logbook_id = p_logbook_id and l.status = 'scheduled'
  on conflict (lesson_id) do nothing;
  get diagnostics v_created = row_count;

  update logbooks set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_logbook_id;
  insert into logbook_reviews (logbook_id, action, actor_id) values (p_logbook_id, 'approved', auth.uid());
  return v_created;
end $$;

-- Replace a class's tutor. Lessons that have already started stay with the tutor who taught them (and
-- keep their entries and earnings); lessons that have not started move to the new tutor in ONE
-- transaction. If any of them would overlap the new tutor's own lessons, nothing changes at all.
create function change_class_tutor(p_class_id uuid, p_new_tutor_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_moved int;
begin
  perform require_admin();
  select * into v_class from classes where id = p_class_id for update;
  if not found then perform fail('NOT_FOUND', 'class not found'); end if;
  if v_class.tutor_id = p_new_tutor_id then
    perform fail('VALIDATION', 'that tutor already teaches this class');
  end if;

  begin
    update classes set tutor_id = p_new_tutor_id where id = p_class_id; -- the trigger rejects a non-tutor
    update lessons set tutor_id = p_new_tutor_id
    where class_id = p_class_id and status = 'scheduled' and starts_at > now();
    get diagnostics v_moved = row_count;
  exception when exclusion_violation then
    perform fail('LESSON_OVERLAP', 'a lesson of this class overlaps a lesson the new tutor already has');
  end;
  return v_moved;
end $$;

revoke all on function lesson_earning(uuid), preview_logbook_earnings(uuid), approve_logbook(uuid),
  change_class_tutor(uuid, uuid) from public, anon, authenticated;
grant execute on function preview_logbook_earnings(uuid), approve_logbook(uuid), change_class_tutor(uuid, uuid) to authenticated;
