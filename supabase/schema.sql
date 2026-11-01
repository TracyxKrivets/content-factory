-- Content Factory schema. Run once in the Supabase SQL editor.
-- Each table: indexed key columns for filtering + `doc` jsonb with the full record.
-- The server uses the service-role key; RLS is enabled with owner policies ready for
-- when browser-side auth is turned on.

create table if not exists projects (
  id text primary key, user_id text not null, format_id text, status text,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);
create index if not exists projects_user on projects(user_id, created_at desc);

create table if not exists videos (
  id text primary key, user_id text not null, project_id text not null references projects(id) on delete cascade,
  status text, created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);
create index if not exists videos_project on videos(project_id, created_at);

create table if not exists formats (
  id text primary key, user_id text not null,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);
create index if not exists formats_user on formats(user_id);

create table if not exists jobs (
  id text primary key, user_id text not null, project_id text not null, video_id text,
  kind text not null, status text not null,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);
create index if not exists jobs_status on jobs(status, created_at);
create index if not exists jobs_project on jobs(project_id);

create table if not exists errors (
  id text primary key, user_id text not null, project_id text, video_id text,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);
create index if not exists errors_user on errors(user_id, created_at desc);

create table if not exists usage (
  id text primary key, user_id text not null, project_id text, video_id text,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);
create index if not exists usage_project on usage(project_id);

create table if not exists history (
  id text primary key, user_id text not null, project_id text, video_id text,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);
create index if not exists history_project on history(project_id, created_at);

create table if not exists cache (
  id text primary key, user_id text not null,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);

-- provider configuration (preferred order per capability) lives here
create table if not exists settings (
  id text primary key, user_id text not null,
  created_at timestamptz not null, updated_at timestamptz not null, doc jsonb not null);

do $$
declare t text;
begin
  foreach t in array array['projects','videos','formats','jobs','errors','usage','history','cache','settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists owner_all on %I', t);
    execute format('create policy owner_all on %I for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id)', t);
  end loop;
end $$;

-- Storage bucket for audio, images and final videos (private; served through the app).
insert into storage.buckets (id, name, public) values ('content-factory', 'content-factory', false)
on conflict (id) do nothing;
