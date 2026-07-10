-- Reports Aggregator Panel: reports, audit log, storage bucket, RLS

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_email text not null,
  file_path text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null,
  theme text not null,
  tags text[] not null default '{}',
  summary text,
  summary_status text not null default 'pending' check (summary_status in ('pending', 'ready', 'error')),
  share_token uuid not null default gen_random_uuid(),
  share_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index reports_share_token_idx on public.reports (share_token);
create index reports_theme_idx on public.reports (theme);
create index reports_created_at_idx on public.reports (created_at desc);

-- Audit trail. report_id is intentionally not a foreign key: a deleted report
-- must still leave its audit history behind instead of cascading away.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  actor_id uuid,
  actor_email text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_report_id_idx on public.audit_logs (report_id);

alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

-- Reports: visible to the whole authenticated team (no per-report approval step in the MVP).
create policy "Authenticated can view all reports"
  on public.reports for select
  to authenticated
  using (true);

create policy "Authenticated can insert own reports"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = author_id);

create policy "Authors can update own reports"
  on public.reports for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

create policy "Authors can delete own reports"
  on public.reports for delete
  to authenticated
  using (auth.uid() = author_id);

create policy "Authenticated can view audit logs"
  on public.audit_logs for select
  to authenticated
  using (true);

-- Automatic audit trail: every insert/update/delete on reports is logged with
-- the acting user, regardless of which client path made the change.
create or replace function public.log_report_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text := auth.jwt() ->> 'email';
  v_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (report_id, actor_id, actor_email, action, details)
    values (new.id, v_actor_id, v_actor_email, 'upload', jsonb_build_object('title', new.title));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.summary_status is distinct from new.summary_status and new.summary_status = 'pending' then
      v_action := 'reprocess';
    elsif old.share_enabled is distinct from new.share_enabled then
      v_action := case when new.share_enabled then 'share_enabled' else 'share_disabled' end;
    else
      v_action := 'update';
    end if;
    insert into public.audit_logs (report_id, actor_id, actor_email, action, details)
    values (new.id, v_actor_id, v_actor_email, v_action, jsonb_build_object('title', new.title));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (report_id, actor_id, actor_email, action, details)
    values (old.id, v_actor_id, v_actor_email, 'delete', jsonb_build_object('title', old.title));
    return old;
  end if;
  return null;
end;
$$;

create trigger reports_audit_trigger
  after insert or update or delete on public.reports
  for each row execute function public.log_report_audit();

-- Storage bucket for uploaded files. Private: only the edge functions (service
-- role) hand out signed URLs for public share links; internal team members
-- read directly through the policies below.
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

create policy "Authenticated can read report files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'reports');

create policy "Authenticated can upload own report files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Authors can delete own report files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);
