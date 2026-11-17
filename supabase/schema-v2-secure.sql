-- Secure v2 foundation for the Hanukkah family game.
-- Apply to a fresh Supabase project before enabling the v2 client.
-- Participants authenticate anonymously with Supabase Auth; the browser must never
-- receive the service_role key. The old game_state/participants tables are retained
-- for reference only and must not be used by the production client.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','playing','finished','closed')),
  current_question_position integer not null default 0 check (current_question_position >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.game_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 32),
  team text,
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  unique (id, room_id)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  position integer not null check (position >= 0),
  prompt text not null check (char_length(trim(prompt)) between 1 and 500),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option smallint not null check (correct_option between 0 and 3),
  points integer not null default 100 check (points between 0 and 10000),
  created_at timestamptz not null default now(),
  unique (room_id, position),
  unique (id, room_id)
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  question_id uuid not null,
  participant_id uuid not null,
  selected_option smallint not null check (selected_option between 0 and 3),
  is_correct boolean not null,
  points_awarded integer not null check (points_awarded >= 0),
  answered_at timestamptz not null default now(),
  unique (question_id, participant_id),
  foreign key (question_id, room_id) references public.questions(id, room_id) on delete cascade,
  foreign key (participant_id, room_id) references public.game_participants(id, room_id) on delete cascade
);

create index if not exists game_participants_room_score_idx
  on public.game_participants(room_id, score desc);
create index if not exists questions_room_position_idx
  on public.questions(room_id, position);
create index if not exists answers_room_idx on public.answers(room_id);

alter table public.rooms enable row level security;
alter table public.game_participants enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;

-- Rooms are visible only to their owner and authenticated participants.
drop policy if exists "room members can read room" on public.rooms;
create policy "room members can read room" on public.rooms
for select to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.game_participants p
    where p.room_id = rooms.id and p.user_id = auth.uid()
  )
);

drop policy if exists "authenticated users create own rooms" on public.rooms;
create policy "authenticated users create own rooms" on public.rooms
for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "room owner updates room" on public.rooms;
create policy "room owner updates room" on public.rooms
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "room members read participants" on public.game_participants;
create policy "room members read participants" on public.game_participants
for select to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid())
  or exists (
    select 1 from public.game_participants self
    where self.room_id = game_participants.room_id and self.user_id = auth.uid()
  )
);

drop policy if exists "users join open rooms as themselves" on public.game_participants;
create policy "users join open rooms as themselves" on public.game_participants
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from public.rooms r where r.id = room_id and r.status = 'lobby')
);

drop policy if exists "room owner manages participants" on public.game_participants;
create policy "room owner manages participants" on public.game_participants
for update to authenticated
using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()))
with check (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()));

drop policy if exists "room members read questions" on public.questions;
create policy "room members read questions" on public.questions
for select to authenticated
using (
  exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid())
  or exists (select 1 from public.game_participants p where p.room_id = questions.room_id and p.user_id = auth.uid())
);

drop policy if exists "room owner manages questions" on public.questions;
create policy "room owner manages questions" on public.questions
for all to authenticated
using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()))
with check (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()));

drop policy if exists "participants and owner read answers" on public.answers;
create policy "participants and owner read answers" on public.answers
for select to authenticated
using (
  exists (select 1 from public.game_participants p where p.id = participant_id and p.user_id = auth.uid())
  or exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid())
);

-- Answers are submitted only through this transaction: correct answers and points
-- are calculated on the database, and the unique key prevents repeat scoring.
create or replace function public.submit_game_answer(
  p_room_code text,
  p_question_id uuid,
  p_selected_option smallint
) returns table (correct boolean, awarded integer, total_score integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_participant public.game_participants%rowtype;
  v_question public.questions%rowtype;
  v_correct boolean;
  v_awarded integer;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_selected_option not between 0 and 3 then
    raise exception 'Invalid answer option';
  end if;

  select * into v_room from public.rooms
  where code = p_room_code and status = 'playing'
  for update;
  if not found then raise exception 'Room is not active'; end if;

  select * into v_participant from public.game_participants
  where room_id = v_room.id and user_id = auth.uid();
  if not found then raise exception 'Participant is not in this room'; end if;

  select * into v_question from public.questions
  where id = p_question_id and room_id = v_room.id
    and position = v_room.current_question_position;
  if not found then raise exception 'Question is not currently active'; end if;

  v_correct := p_selected_option = v_question.correct_option;
  v_awarded := case when v_correct then v_question.points else 0 end;

  insert into public.answers(room_id, question_id, participant_id, selected_option, is_correct, points_awarded)
  values (v_room.id, v_question.id, v_participant.id, p_selected_option, v_correct, v_awarded);

  update public.game_participants
  set score = score + v_awarded
  where id = v_participant.id
  returning score into v_total;

  return query select v_correct, v_awarded, v_total;
end;
$$;

revoke all on function public.submit_game_answer(text, uuid, smallint) from public;
grant execute on function public.submit_game_answer(text, uuid, smallint) to authenticated;

-- Enable realtime safely (ignore if a table is already in the publication).
do $$
declare t text;
begin
  foreach t in array array['rooms','game_participants','questions','answers'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
