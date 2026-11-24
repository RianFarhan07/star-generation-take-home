-- Clicking a notification marks it as read: one notification, and only if it belongs to the caller.
create function mark_notification_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update notifications set read_at = now() where id = p_id and user_id = auth.uid() and read_at is null;
end $$;

revoke all on function mark_notification_read(uuid) from public, anon;
grant execute on function mark_notification_read(uuid) to authenticated;
