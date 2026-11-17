-- Initial data model for the family Hanukkah game.
-- IMPORTANT: This starter schema is not production-secure for public events yet.
-- Do not collect sensitive personal information. Add authenticated host authorization
-- and stricter room membership policies before using with real participants.

create table if not exists public.game_state (
  room_code text primary key check (room_code ~ '^[0-9]{6}$'),
  active_question integer not null default 0,
  is_open boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.game_state(room_code) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  score integer not null default 0,
  team text,
  created_at timestamptz not null default now()
);

alter table public.game_state enable row level security;
alter table public.participants enable row level security;

-- Starter policies permit room reads and participant self-registration.
-- Host write policies must be replaced with authenticated host ownership before launch.
create policy "rooms can be read" on public.game_state for select to anon, authenticated using (true);
create policy "participants can join open rooms" on public.participants for insert to anon, authenticated
  with check (exists (select 1 from public.game_state g where g.room_code = room_code and g.is_open = true));
create policy "participants can be listed" on public.participants for select to anon, authenticated using (true);
create policy "room state can be created" on public.game_state for insert to anon, authenticated with check (true);
create policy "room state can be advanced" on public.game_state for update to anon, authenticated using (true) with check (true);

alter publication supabase_realtime add table public.game_state;
alter publication supabase_realtime add table public.participants;