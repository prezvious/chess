-- Universal Supabase schema for Cloud Chess Studio.
-- No Supabase Auth account is required for end users.

create extension if not exists pgcrypto;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();

-- Reset app tables because the old auth.uid() model is incompatible.
drop table if exists public.chess_games cascade;
drop table if exists public.user_settings cascade;
drop table if exists public.profiles cascade;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function public.current_player_token()
returns text
language sql
stable
as $$
  select coalesce((current_setting('request.headers', true)::jsonb ->> 'x-player-token'), '');
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  owner_token text not null,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.user_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  owner_token text not null,
  piece_style text not null default '2d' check (piece_style in ('2d', '3d')),
  board_style text not null default 'brown' check (board_style in ('brown', 'wood', 'blue')),
  sound_enabled boolean not null default true,
  auto_sync_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.chess_games (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  owner_token text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  title text not null default 'Cloud Chess Game',
  fen text not null,
  turn text not null check (turn in ('white', 'black')),
  status text not null default 'ongoing' check (status in ('ongoing', 'checkmate', 'stalemate', 'draw')),
  result text,
  last_move_uci text,
  moves jsonb not null default '[]'::jsonb,
  captured_white jsonb not null default '[]'::jsonb,
  captured_black jsonb not null default '[]'::jsonb,
  session_id text not null default ''
);

create index profiles_owner_token_idx on public.profiles (owner_token);
create index user_settings_owner_token_idx on public.user_settings (owner_token);
create index chess_games_owner_updated_idx on public.chess_games (owner_profile_id, updated_at desc);
create index chess_games_owner_token_idx on public.chess_games (owner_token);

-- updated_at triggers
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

drop trigger if exists trg_chess_games_updated_at on public.chess_games;
create trigger trg_chess_games_updated_at
before update on public.chess_games
for each row
execute function public.set_updated_at();

-- Create a player profile and return session payload.
create or replace function public.create_player(
  p_username text,
  p_display_name text,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  clean_username text;
  clean_display text;
  new_player_id uuid;
  new_token text;
begin
  clean_username := lower(trim(coalesce(p_username, '')));
  clean_display := trim(coalesce(p_display_name, ''));

  if clean_username !~ '^[a-z0-9_-]{3,30}$' then
    raise exception 'Username must use 3-30 chars: a-z, 0-9, _ or -';
  end if;

  if length(trim(coalesce(p_password_hash, ''))) < 32 then
    raise exception 'Invalid password hash';
  end if;

  if clean_display = '' then
    clean_display := clean_username;
  end if;

  new_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.profiles (owner_token, username, display_name, password_hash)
  values (new_token, clean_username, clean_display, p_password_hash)
  returning id into new_player_id;

  insert into public.user_settings (profile_id, owner_token)
  values (new_player_id, new_token);

  return jsonb_build_object(
    'player_id', new_player_id,
    'username', clean_username,
    'display_name', clean_display,
    'player_token', new_token
  );
exception
  when unique_violation then
    raise exception 'Username already exists';
end;
$$;

-- Validate login and rotate token.
create or replace function public.login_player(
  p_username text,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  clean_username text;
  player_row public.profiles%rowtype;
  new_token text;
begin
  clean_username := lower(trim(coalesce(p_username, '')));

  select *
  into player_row
  from public.profiles
  where username = clean_username
    and password_hash = p_password_hash
  limit 1;

  if not found then
    return null;
  end if;

  new_token := encode(extensions.gen_random_bytes(24), 'hex');

  update public.profiles
  set owner_token = new_token
  where id = player_row.id;

  update public.user_settings
  set owner_token = new_token
  where profile_id = player_row.id;

  update public.chess_games
  set owner_token = new_token
  where owner_profile_id = player_row.id;

  return jsonb_build_object(
    'player_id', player_row.id,
    'username', player_row.username,
    'display_name', player_row.display_name,
    'player_token', new_token
  );
end;
$$;

grant execute on function public.create_player(text, text, text) to anon, authenticated;
grant execute on function public.login_player(text, text) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.chess_games enable row level security;

-- profiles policies
drop policy if exists "Profiles are readable by token" on public.profiles;
create policy "Profiles are readable by token"
on public.profiles
for select
to anon, authenticated
using (owner_token = public.current_player_token());

drop policy if exists "Profiles are updateable by token" on public.profiles;
create policy "Profiles are updateable by token"
on public.profiles
for update
to anon, authenticated
using (owner_token = public.current_player_token())
with check (owner_token = public.current_player_token());

-- user_settings policies
drop policy if exists "Settings are readable by token" on public.user_settings;
create policy "Settings are readable by token"
on public.user_settings
for select
to anon, authenticated
using (owner_token = public.current_player_token());

drop policy if exists "Settings are insertable by token" on public.user_settings;
create policy "Settings are insertable by token"
on public.user_settings
for insert
to anon, authenticated
with check (
  owner_token = public.current_player_token()
  and exists (
    select 1 from public.profiles p
    where p.id = profile_id
      and p.owner_token = public.current_player_token()
  )
);

drop policy if exists "Settings are updateable by token" on public.user_settings;
create policy "Settings are updateable by token"
on public.user_settings
for update
to anon, authenticated
using (owner_token = public.current_player_token())
with check (owner_token = public.current_player_token());

-- chess_games policies
drop policy if exists "Games are readable by token" on public.chess_games;
create policy "Games are readable by token"
on public.chess_games
for select
to anon, authenticated
using (owner_token = public.current_player_token());

drop policy if exists "Games are insertable by token" on public.chess_games;
create policy "Games are insertable by token"
on public.chess_games
for insert
to anon, authenticated
with check (
  owner_token = public.current_player_token()
  and exists (
    select 1 from public.profiles p
    where p.id = owner_profile_id
      and p.owner_token = public.current_player_token()
  )
);

drop policy if exists "Games are updateable by token" on public.chess_games;
create policy "Games are updateable by token"
on public.chess_games
for update
to anon, authenticated
using (owner_token = public.current_player_token())
with check (owner_token = public.current_player_token());

drop policy if exists "Games are deletable by token" on public.chess_games;
create policy "Games are deletable by token"
on public.chess_games
for delete
to anon, authenticated
using (owner_token = public.current_player_token());

-- Realtime tables.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chess_games'
  ) then
    alter publication supabase_realtime add table public.chess_games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
end;
$$;
