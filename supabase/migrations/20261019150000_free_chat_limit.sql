-- Free 하루 대화 턴 한도 20 → 10 (spec/usage.md, ADR-024, PLAN_LIMITS.free.chatTurns)
--
-- 2026-10-20에 만들었지만 운영에 아직 올리지 않은 20261019200000_target_words보다 앞에 둔다.
-- 이 파일을 먼저 운영에 올려도 target_words를 나중에 순서대로 올릴 수 있게 하려는 것이다.
-- create or replace라 권한(service_role만 실행)은 그대로다.

create or replace function public.chat_turn_limit(p_user_id uuid)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select case public.current_plan(p_user_id) when 'pro' then 50 else 10 end;
$$;
