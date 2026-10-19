-- Pro 하루 대화 턴 한도 150 → 50 (spec/usage.md, ADR-020, PLAN_LIMITS.pro.chatTurns)
--
-- create or replace라 권한(service_role만 실행)은 그대로다.

create or replace function public.chat_turn_limit(p_user_id uuid)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select case public.current_plan(p_user_id) when 'pro' then 50 else 20 end;
$$;
