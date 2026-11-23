-- Private bucket for payment proof images. Bank transfer screenshots contain account numbers and
-- names, so nothing here is public: a student reaches only their own folder, the admin reads all,
-- tutors have no access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Object paths look like "<student id>/<file>", so the first folder is the owner.
create policy payment_proofs_student_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy payment_proofs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
