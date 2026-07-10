-- Temporarily disable the login requirement for the Reports Panel.
-- Opens reports/storage access to the anon key instead of requiring an
-- authenticated session. Revisit before wider rollout: the PRD's security
-- requirements (login obrigatório, autoria por usuário) assume this is
-- re-enabled later — see migration 0002 for the original policies.

alter table public.reports alter column author_id drop not null;

drop policy "Authenticated can view all reports" on public.reports;
drop policy "Authenticated can insert own reports" on public.reports;
drop policy "Authors can update own reports" on public.reports;
drop policy "Authors can delete own reports" on public.reports;
drop policy "Authenticated can view audit logs" on public.audit_logs;

create policy "Public can view all reports"
  on public.reports for select
  to public
  using (true);

create policy "Public can insert reports"
  on public.reports for insert
  to public
  with check (true);

create policy "Public can update reports"
  on public.reports for update
  to public
  using (true)
  with check (true);

create policy "Public can delete reports"
  on public.reports for delete
  to public
  using (true);

create policy "Public can view audit logs"
  on public.audit_logs for select
  to public
  using (true);

drop policy "Authenticated can read report files" on storage.objects;
drop policy "Authenticated can upload own report files" on storage.objects;
drop policy "Authors can delete own report files" on storage.objects;

create policy "Public can read report files"
  on storage.objects for select
  to public
  using (bucket_id = 'reports');

create policy "Public can upload report files"
  on storage.objects for insert
  to public
  with check (bucket_id = 'reports');

create policy "Public can delete report files"
  on storage.objects for delete
  to public
  using (bucket_id = 'reports');
