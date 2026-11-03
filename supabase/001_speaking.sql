-- ===========================================================
--  Speaking Lab — R&R archive(abaakjkidxsnfigqfcbx)에 더하는 표·버킷·규칙
--
--  실행: Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run. 여러 번 돌려도 돼요.
--  기존 rw-english 표(students, attempts, …)는 건드리지 않아요. 새 이름은 모두 speaking_ 로 시작해요.
--  public.teachers / public.is_teacher() 는 rw-english schema.sql 에 이미 있는 것을 그대로 써요.
--
--  누가 무엇을 하나요
--    학생   선생님이 준 등록 코드로 한 번 speaking_claim() → 그다음부터 자기 행·자기 녹음만 읽고 써요.
--           R&R archive 는 가입이 열려 있어서, 등록 코드 없이 가입한 계정(rw 학생 포함)은 여기 아무것도 못 봐요.
--    선생님 teachers 표에 있는 계정. 모두 읽고, 제출을 내려받고(pulled_at), 피드백을 써요.
--    관리자 키(service_role)는 어디에도 쓰지 않아요.
--
--  녹음 경로: speaking-audio/<학생 uid>/<응시 ID>/qNN.webm
-- ===========================================================

-- ── 표 ──────────────────────────────────────────────────────
create table if not exists public.speaking_students (
  id               uuid primary key references auth.users (id) on delete cascade,
  code             text not null unique check (code ~ '^S[0-9]{3,}$'),         -- 피드백 작업에 쓰는 학생 번호
  login_id         text not null unique check (login_id ~ '^[a-z0-9._-]{3,30}$'),
  profile          jsonb not null default '{}'::jsonb,                          -- 이름·휴대폰·14세 미만·시험·목표·보호자·선택 항목
  consent          jsonb,                                                       -- 지금 유효한 동의 기록
  consent_history  jsonb not null default '[]'::jsonb,
  ended_on         date,                                                        -- 수업 종료일 (보유 기간 계산)
  withdrawn_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.speaking_invites (
  code          text primary key check (code ~ '^[A-Z0-9]{8}$'),
  student_code  text not null unique check (student_code ~ '^S[0-9]{3,}$'),
  note          text,                                   -- 선생님 메모(이름 대신 "화요일 7시반" 같은 것)
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  used_by       uuid references auth.users (id) on delete set null,
  used_at       timestamptz
);

create table if not exists public.speaking_attempts (
  id            text primary key check (id ~ '^a[0-9a-z]+$'),
  student_id    uuid not null references public.speaking_students (id) on delete cascade,
  exam          text not null check (exam in ('toeic', 'opic')),
  set_id        text not null,
  target        text,
  meta          jsonb not null default '{}'::jsonb,     -- OPIc 자가평가·재조정·주제 등
  items         jsonb not null default '[]'::jsonb,     -- [{num, file, mime, ms, qid?, type?}]
  started_at    timestamptz,
  finished_at   timestamptz,
  submitted_at  timestamptz,
  pulled_at     timestamptz,                            -- 선생님 도구가 내려받은 때
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists speaking_attempts_student on public.speaking_attempts (student_id);
create index if not exists speaking_attempts_inbox on public.speaking_attempts (submitted_at) where pulled_at is null;

create table if not exists public.speaking_feedback (
  attempt_id  text primary key references public.speaking_attempts (id) on delete cascade,
  student_id  uuid not null references public.speaking_students (id) on delete cascade,
  feedback    jsonb not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

-- ── 도우미 ──────────────────────────────────────────────────
create or replace function public.speaking_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists speaking_students_touch on public.speaking_students;
create trigger speaking_students_touch before update on public.speaking_students for each row execute function public.speaking_touch();
drop trigger if exists speaking_attempts_touch on public.speaking_attempts;
create trigger speaking_attempts_touch before update on public.speaking_attempts for each row execute function public.speaking_touch();

-- 피드백의 학생은 응시 기록에서 정해요(잘못된 학생에게 붙지 않게).
create or replace function public.speaking_feedback_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select a.student_id into new.student_id from public.speaking_attempts a where a.id = new.attempt_id;
  return new;
end $$;
drop trigger if exists speaking_feedback_owner on public.speaking_feedback;
create trigger speaking_feedback_owner before insert or update on public.speaking_feedback for each row execute function public.speaking_feedback_owner();

create or replace function public.is_speaking_student() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.speaking_students s where s.id = auth.uid() and s.withdrawn_at is null);
$$;

-- 등록 코드 쓰기: 로그인한 계정을 Speaking Lab 학생으로 묶어요. 아이디는 로그인 이메일과 같아야 해요.
create or replace function public.speaking_claim(p_code text, p_login_id text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.speaking_invites;
  lid text := lower(trim(p_login_id));
begin
  if uid is null then raise exception '로그인이 필요해요' using errcode = '42501'; end if;
  if exists (select 1 from public.speaking_students where id = uid) then
    return (select code from public.speaking_students where id = uid);
  end if;
  if (select lower(email) from auth.users where id = uid) is distinct from lid || '@speaking.local' then
    raise exception '아이디가 로그인 계정과 달라요' using errcode = '42501';
  end if;
  select * into inv from public.speaking_invites where code = upper(trim(p_code)) for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception '등록 코드가 맞지 않거나 이미 쓰였어요' using errcode = '42501';
  end if;
  insert into public.speaking_students (id, code, login_id) values (uid, inv.student_code, lid);
  update public.speaking_invites set used_by = uid, used_at = now() where code = inv.code;
  return inv.student_code;
end $$;

-- 동의 철회: 응시 기록·피드백을 지우고 학생 정보를 비워요. 녹음 파일은 앱이 Storage API로 먼저 지워요.
-- 행은 남겨서(학생 번호·철회 시각) 선생님 도구가 컴퓨터에 있는 자료도 지우게 해요.
create or replace function public.speaking_withdraw() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not public.is_speaking_student() then raise exception 'Speaking Lab 학생이 아니에요' using errcode = '42501'; end if;
  delete from public.speaking_attempts where student_id = uid;
  update public.speaking_students
     set profile = '{}'::jsonb, consent = null, withdrawn_at = now(),
         consent_history = consent_history || jsonb_build_array(jsonb_build_object('withdrawn_at', now()))
   where id = uid;
end $$;

revoke all on function public.speaking_claim(text, text) from public, anon;
revoke all on function public.speaking_withdraw() from public, anon;
grant execute on function public.speaking_claim(text, text) to authenticated;
grant execute on function public.speaking_withdraw() to authenticated;
grant execute on function public.is_speaking_student() to authenticated;

-- ── 권한: Supabase 기본값(모든 권한)을 거두고 필요한 칸만 열어요 ──
revoke all on public.speaking_students, public.speaking_invites, public.speaking_attempts, public.speaking_feedback from anon, authenticated;

grant select, delete on public.speaking_students to authenticated;
grant update (profile, consent, consent_history, ended_on) on public.speaking_students to authenticated;   -- ended_on은 선생님만(정책에서 막아요)
grant select, insert, update, delete on public.speaking_invites to authenticated;                         -- 선생님만(정책)
grant select, delete on public.speaking_attempts to authenticated;
grant insert (id, student_id, exam, set_id, target, meta, items, started_at, finished_at, submitted_at) on public.speaking_attempts to authenticated;
grant update (target, meta, items, started_at, finished_at, submitted_at, pulled_at) on public.speaking_attempts to authenticated;  -- pulled_at은 선생님만(정책·트리거)
grant select, insert, delete on public.speaking_feedback to authenticated;
grant update (feedback, read_at) on public.speaking_feedback to authenticated;

alter table public.speaking_students enable row level security;
alter table public.speaking_invites  enable row level security;
alter table public.speaking_attempts enable row level security;
alter table public.speaking_feedback enable row level security;

-- 학생 정보
drop policy if exists sl_students_self_read on public.speaking_students;
create policy sl_students_self_read on public.speaking_students for select to authenticated using (id = auth.uid() or public.is_teacher());
drop policy if exists sl_students_self_update on public.speaking_students;
create policy sl_students_self_update on public.speaking_students for update to authenticated
  using ((id = auth.uid() and withdrawn_at is null) or public.is_teacher())
  with check ((id = auth.uid() and withdrawn_at is null) or public.is_teacher());
drop policy if exists sl_students_teacher_delete on public.speaking_students;
create policy sl_students_teacher_delete on public.speaking_students for delete to authenticated using (public.is_teacher());

-- 학생이 바꾸면 안 되는 칸(수업 종료일)을 지켜요. 칸 권한은 표 단위라 선생님/학생을 트리거로 나눠요.
create or replace function public.speaking_students_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() and new.ended_on is distinct from old.ended_on then
    raise exception '수업 종료일은 선생님만 바꿔요' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists speaking_students_guard on public.speaking_students;
create trigger speaking_students_guard before update on public.speaking_students for each row execute function public.speaking_students_guard();

-- 등록 코드: 선생님만
drop policy if exists sl_invites_teacher on public.speaking_invites;
create policy sl_invites_teacher on public.speaking_invites for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- 응시 기록
drop policy if exists sl_attempts_read on public.speaking_attempts;
create policy sl_attempts_read on public.speaking_attempts for select to authenticated using (student_id = auth.uid() or public.is_teacher());
drop policy if exists sl_attempts_insert on public.speaking_attempts;
create policy sl_attempts_insert on public.speaking_attempts for insert to authenticated
  with check (student_id = auth.uid() and public.is_speaking_student());
drop policy if exists sl_attempts_update on public.speaking_attempts;
create policy sl_attempts_update on public.speaking_attempts for update to authenticated
  using ((student_id = auth.uid() and public.is_speaking_student()) or public.is_teacher())
  with check ((student_id = auth.uid() and public.is_speaking_student()) or public.is_teacher());
drop policy if exists sl_attempts_delete on public.speaking_attempts;
create policy sl_attempts_delete on public.speaking_attempts for delete to authenticated
  using (student_id = auth.uid() or public.is_teacher());

create or replace function public.speaking_attempts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() and new.pulled_at is distinct from old.pulled_at then
    raise exception 'pulled_at은 선생님 도구만 바꿔요' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists speaking_attempts_guard on public.speaking_attempts;
create trigger speaking_attempts_guard before update on public.speaking_attempts for each row execute function public.speaking_attempts_guard();

-- 피드백: 학생은 읽고 읽은 시각만 남겨요
drop policy if exists sl_feedback_read on public.speaking_feedback;
create policy sl_feedback_read on public.speaking_feedback for select to authenticated using (student_id = auth.uid() or public.is_teacher());
drop policy if exists sl_feedback_teacher_write on public.speaking_feedback;
create policy sl_feedback_teacher_write on public.speaking_feedback for insert to authenticated with check (public.is_teacher());
drop policy if exists sl_feedback_update on public.speaking_feedback;
create policy sl_feedback_update on public.speaking_feedback for update to authenticated
  using (student_id = auth.uid() or public.is_teacher()) with check (student_id = auth.uid() or public.is_teacher());
drop policy if exists sl_feedback_teacher_delete on public.speaking_feedback;
create policy sl_feedback_teacher_delete on public.speaking_feedback for delete to authenticated using (public.is_teacher());

create or replace function public.speaking_feedback_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() and new.feedback is distinct from old.feedback then
    raise exception '피드백 내용은 선생님만 바꿔요' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists speaking_feedback_guard on public.speaking_feedback;
create trigger speaking_feedback_guard before update on public.speaking_feedback for each row execute function public.speaking_feedback_guard();

-- ── 녹음 버킷 ───────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('speaking-audio', 'speaking-audio', false, 31457280, array['audio/*'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sl_audio_student_insert on storage.objects;
create policy sl_audio_student_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'speaking-audio' and (storage.foldername(name))[1] = auth.uid()::text and public.is_speaking_student());
drop policy if exists sl_audio_student_update on storage.objects;
create policy sl_audio_student_update on storage.objects for update to authenticated
  using (bucket_id = 'speaking-audio' and (storage.foldername(name))[1] = auth.uid()::text and public.is_speaking_student())
  with check (bucket_id = 'speaking-audio' and (storage.foldername(name))[1] = auth.uid()::text and public.is_speaking_student());
drop policy if exists sl_audio_read on storage.objects;
create policy sl_audio_read on storage.objects for select to authenticated
  using (bucket_id = 'speaking-audio' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher()));
drop policy if exists sl_audio_delete on storage.objects;
create policy sl_audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'speaking-audio' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher()));
