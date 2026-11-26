-- Safe isolated schema for the Hanukkah family game.
-- This deliberately uses hanukkah_* names so it does not modify legacy tables.
create extension if not exists pgcrypto;

create table if not exists public.hanukkah_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','playing','finished','closed')),
  current_question_position integer not null default 0 check (current_question_position >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.hanukkah_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hanukkah_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 32),
  team text,
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  unique (id, room_id)
);

create table if not exists public.hanukkah_questions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hanukkah_rooms(id) on delete cascade,
  position integer not null check (position >= 0),
  prompt text not null check (char_length(trim(prompt)) between 1 and 500),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  points integer not null default 100 check (points between 0 and 10000),
  created_at timestamptz not null default now(),
  unique (room_id, position),
  unique (id, room_id)
);

create table if not exists public.hanukkah_question_keys (
  question_id uuid primary key,
  room_id uuid not null,
  correct_option smallint not null check (correct_option between 0 and 3),
  foreign key (question_id, room_id) references public.hanukkah_questions(id, room_id) on delete cascade
);

create table if not exists public.hanukkah_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  question_id uuid not null,
  participant_id uuid not null,
  selected_option smallint not null check (selected_option between 0 and 3),
  is_correct boolean not null,
  points_awarded integer not null check (points_awarded >= 0),
  answered_at timestamptz not null default now(),
  unique (question_id, participant_id),
  foreign key (question_id, room_id) references public.hanukkah_questions(id, room_id) on delete cascade,
  foreign key (participant_id, room_id) references public.hanukkah_participants(id, room_id) on delete cascade
);

create index if not exists hanukkah_participants_score_idx on public.hanukkah_participants(room_id, score desc);
create index if not exists hanukkah_questions_position_idx on public.hanukkah_questions(room_id, position);

alter table public.hanukkah_rooms enable row level security;
alter table public.hanukkah_participants enable row level security;
alter table public.hanukkah_questions enable row level security;
alter table public.hanukkah_question_keys enable row level security;
alter table public.hanukkah_answers enable row level security;

create or replace function public.hanukkah_is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.hanukkah_rooms r where r.id=p_room_id and r.owner_id=auth.uid())
  or exists(select 1 from public.hanukkah_participants p where p.room_id=p_room_id and p.user_id=auth.uid());
$$;
revoke all on function public.hanukkah_is_room_member(uuid) from public;
grant execute on function public.hanukkah_is_room_member(uuid) to authenticated;

drop policy if exists "hanukkah room member read" on public.hanukkah_rooms;
create policy "hanukkah room member read" on public.hanukkah_rooms for select to authenticated
using (public.hanukkah_is_room_member(id));
drop policy if exists "hanukkah owner create room" on public.hanukkah_rooms;
create policy "hanukkah owner create room" on public.hanukkah_rooms for insert to authenticated
with check (owner_id=auth.uid());
drop policy if exists "hanukkah owner update room" on public.hanukkah_rooms;
create policy "hanukkah owner update room" on public.hanukkah_rooms for update to authenticated
using (owner_id=auth.uid()) with check (owner_id=auth.uid());

drop policy if exists "hanukkah members read participants" on public.hanukkah_participants;
create policy "hanukkah members read participants" on public.hanukkah_participants for select to authenticated
using (public.hanukkah_is_room_member(room_id));
drop policy if exists "hanukkah owner updates participants" on public.hanukkah_participants;
create policy "hanukkah owner updates participants" on public.hanukkah_participants for update to authenticated
using (exists(select 1 from public.hanukkah_rooms r where r.id=room_id and r.owner_id=auth.uid()))
with check (exists(select 1 from public.hanukkah_rooms r where r.id=room_id and r.owner_id=auth.uid()));

drop policy if exists "hanukkah members read questions" on public.hanukkah_questions;
create policy "hanukkah members read questions" on public.hanukkah_questions for select to authenticated
using (public.hanukkah_is_room_member(room_id));
drop policy if exists "hanukkah owner manages questions" on public.hanukkah_questions;
create policy "hanukkah owner manages questions" on public.hanukkah_questions for all to authenticated
using (exists(select 1 from public.hanukkah_rooms r where r.id=room_id and r.owner_id=auth.uid()))
with check (exists(select 1 from public.hanukkah_rooms r where r.id=room_id and r.owner_id=auth.uid()));

drop policy if exists "hanukkah owner reads answer keys" on public.hanukkah_question_keys;
create policy "hanukkah owner reads answer keys" on public.hanukkah_question_keys for select to authenticated
using (exists(select 1 from public.hanukkah_rooms r where r.id=room_id and r.owner_id=auth.uid()));
drop policy if exists "hanukkah owner manages answer keys" on public.hanukkah_question_keys;
create policy "hanukkah owner manages answer keys" on public.hanukkah_question_keys for all to authenticated
using (exists(select 1 from public.hanukkah_rooms r where r.id=room_id and r.owner_id=auth.uid()))
with check (exists(select 1 from public.hanukkah_rooms r where r.id=room_id and r.owner_id=auth.uid()));

drop policy if exists "hanukkah members read answers" on public.hanukkah_answers;
create policy "hanukkah members read answers" on public.hanukkah_answers for select to authenticated
using (public.hanukkah_is_room_member(room_id));

grant select, insert, update, delete on public.hanukkah_rooms to authenticated;
grant select, insert, update, delete on public.hanukkah_participants to authenticated;
grant select, insert, update, delete on public.hanukkah_questions to authenticated;
grant select, insert, update, delete on public.hanukkah_question_keys to authenticated;
grant select on public.hanukkah_answers to authenticated;

create or replace function public.hanukkah_join_game_room(p_room_code text, p_display_name text)
returns table(room_id uuid, participant_id uuid, display_name text)
language plpgsql security definer set search_path = public
as $$
declare v_room public.hanukkah_rooms%rowtype; v_player public.hanukkah_participants%rowtype;
begin
  if auth.uid() is null then raise exception 'יש להתחבר תחילה'; end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 32 then
    raise exception 'השם חייב להכיל 1 עד 32 תווים';
  end if;
  select * into v_room from public.hanukkah_rooms where code=p_room_code and status='lobby';
  if not found then raise exception 'קוד המשחק לא נמצא או שהמשחק כבר התחיל'; end if;
  insert into public.hanukkah_participants(room_id,user_id,display_name)
  values(v_room.id,auth.uid(),trim(p_display_name))
  on conflict(room_id,user_id) do update set display_name=excluded.display_name
  returning * into v_player;
  return query select v_room.id,v_player.id,v_player.display_name;
end;
$$;
revoke all on function public.hanukkah_join_game_room(text,text) from public;
grant execute on function public.hanukkah_join_game_room(text,text) to authenticated;

create or replace function public.hanukkah_submit_game_answer(p_room_code text,p_question_id uuid,p_selected_option smallint)
returns table(correct boolean,awarded integer,total_score integer)
language plpgsql security definer set search_path = public
as $$
declare v_room public.hanukkah_rooms%rowtype; v_player public.hanukkah_participants%rowtype;
v_question public.hanukkah_questions%rowtype; v_key smallint; v_correct boolean; v_points integer; v_total integer;
begin
  if auth.uid() is null then raise exception 'יש להתחבר תחילה'; end if;
  if p_selected_option not between 0 and 3 then raise exception 'תשובה לא תקינה'; end if;
  select * into v_room from public.hanukkah_rooms where code=p_room_code and status='playing' for update;
  if not found then raise exception 'המשחק אינו פעיל'; end if;
  select * into v_player from public.hanukkah_participants where room_id=v_room.id and user_id=auth.uid();
  if not found then raise exception 'אינך משתתף בחדר הזה'; end if;
  select * into v_question from public.hanukkah_questions
    where id=p_question_id and room_id=v_room.id and position=v_room.current_question_position;
  if not found then raise exception 'השאלה אינה פעילה כרגע'; end if;
  select correct_option into v_key from public.hanukkah_question_keys where question_id=v_question.id and room_id=v_room.id;
  if not found then raise exception 'חסרה תשובה נכונה לשאלה'; end if;
  v_correct := p_selected_option=v_key;
  v_points := case when v_correct then v_question.points else 0 end;
  insert into public.hanukkah_answers(room_id,question_id,participant_id,selected_option,is_correct,points_awarded)
  values(v_room.id,v_question.id,v_player.id,p_selected_option,v_correct,v_points);
  update public.hanukkah_participants set score=score+v_points where id=v_player.id returning score into v_total;
  return query select v_correct,v_points,v_total;
end;
$$;
revoke all on function public.hanukkah_submit_game_answer(text,uuid,smallint) from public;
grant execute on function public.hanukkah_submit_game_answer(text,uuid,smallint) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['hanukkah_rooms','hanukkah_participants','hanukkah_questions'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
