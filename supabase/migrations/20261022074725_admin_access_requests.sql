-- Requests never grant access until explicitly approved by a superadmin API.
begin;
create table if not exists public.admin_access_requests (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 check ((status = 'pending' and decided_by is null and decided_at is null)
   or (status <> 'pending' and decided_by is not null and decided_at is not null)),
 check (decided_by is null or decided_by <> user_id)
);
alter table public.admin_access_requests enable row level security;
revoke all on public.admin_access_requests from public, anon, authenticated;
grant select, insert, update on public.admin_access_requests to service_role;
create index if not exists admin_access_requests_created_idx on public.admin_access_requests(created_at desc, user_id);
commit;
