-- Weekly recurring lessons: "every Monday 16:00-17:30 WIB for 8 weeks" in ONE transaction.
-- It is all or nothing: the whole series is checked against the tutor's other lessons first, and if any
-- week overlaps, nothing is created and the message lists every clashing date (in WIB). Each lesson stays an
-- ordinary lesson (same overlap rule, month lock and cancellation) and the series id only groups them.

create function create_lesson_series(p_class_id uuid, p_first_starts_at timestamptz, p_minutes int, p_weeks int)
returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  v_class classes;
  v_series uuid := gen_random_uuid();
  v_ids uuid[] := '{}';
  v_conflicts text[] := '{}';
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  i int;
begin
  if not can_manage_lessons(p_class_id) then
    perform fail('NOT_ALLOWED', 'only the class''s tutor or an admin can schedule lessons');
  end if;
  select * into v_class from classes where id = p_class_id;
  if not found then perform fail('NOT_FOUND', 'class not found'); end if; -- only an admin can get here
  if p_first_starts_at is null or p_minutes is null or p_minutes <= 0 or p_minutes > 720 then
    perform fail('VALIDATION', 'a lesson must last between 1 and 720 minutes');
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then
    perform fail('VALIDATION', 'a series covers 1 to 26 weeks');
  end if;

  -- Check every week first so the message can name all the dates that clash.
  for i in 0 .. p_weeks - 1 loop
    v_start := p_first_starts_at + (i * interval '7 days');
    v_end := v_start + make_interval(mins => p_minutes);
    if exists (
      select 1 from lessons
      where tutor_id = v_class.tutor_id and status <> 'cancelled'
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_start, v_end, '[)')
    ) then
      v_conflicts := v_conflicts || to_char(v_start at time zone 'Asia/Jakarta', 'DD Mon YYYY');
    end if;
  end loop;
  if cardinality(v_conflicts) > 0 then
    perform fail('LESSON_OVERLAP', 'these dates overlap another lesson of the tutor: ' || array_to_string(v_conflicts, ', '));
  end if;

  begin
    for i in 0 .. p_weeks - 1 loop
      v_start := p_first_starts_at + (i * interval '7 days');
      insert into lessons (class_id, tutor_id, starts_at, ends_at, series_id, created_by)
      values (p_class_id, v_class.tutor_id, v_start, v_start + make_interval(mins => p_minutes), v_series, auth.uid())
      returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;
  exception when exclusion_violation then
    perform fail('LESSON_OVERLAP', 'a lesson of the series overlaps another lesson of the tutor');
  end;
  return v_ids;
end $$;

revoke all on function create_lesson_series(uuid, timestamptz, int, int) from public, anon;
grant execute on function create_lesson_series(uuid, timestamptz, int, int) to authenticated;
