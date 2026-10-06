-- 학습 RPC: 단어 회차 저장, 오답 복습, 레벨업 테스트 결과, 클라이언트 이벤트
-- (spec 3장 "오늘의 학습"·"오답 복습", 3-1장 "기록", 4장, 5장 "세는 방법", 6-3)
--
-- 함수 규칙은 schema 마이그레이션 머리말과 같다. 모든 RPC는 먼저 profiles를 FOR UPDATE로 잠근다.
-- known/review 결정과 레벨업 채점은 2-api use-case가 lib로 하고, RPC는 판정이 끝난 status·score·passed를 받는다.
--
-- 상수 (테스트는 lib 상수와 같은 값으로 기대값을 만든다)
-- - 하루 새 단어: Free 10, Pro 30 (src/lib/plan.ts의 PLAN_LIMITS). 계정 전체(언어 합산), first_seen_at 기준
-- - 회차 최대 10개 (src/lib/wordBatch.ts의 BATCH_MAX)
-- - 레벨업 from_level 1~4, 점수 0~20 (src/lib/levelTest.ts의 LEVEL_TEST_SIZE)

-- helper ---------------------------------------------------------------

-- 하루 새 단어 한도 (PLAN_LIMITS.*.newWords)
create function public.new_word_limit(p_user_id uuid)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select case public.current_plan(p_user_id) when 'pro' then 30 else 10 end;
$$;

-- 학습 RPC -------------------------------------------------------------

-- 단어 회차 저장. items: [{"word_id": text, "status": "known" | "review"}].
-- 기존 단어는 빼고 신규분만 한도를 확인한다. 신규분은 전부 저장하거나 하나도 저장하지 않는다
create function public.save_word_batch(p_user_id uuid, p_language text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
  v_ids text[];
  v_statuses_valid boolean;
  v_new_ids text[];
  v_limit int;
  v_used int;
  v_inserted int;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'ready', p_language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  select coalesce(array_agg(item.word_id), '{}'),
         coalesce(bool_and(coalesce(item.status in ('known', 'review'), false)), false)
    into v_ids, v_statuses_valid
    from jsonb_to_recordset(p_items) as item(word_id text, status text);

  -- 서로 다른 단어 1~10개가 모두 그 언어의 단어여야 한다. 단어의 레벨은 검사하지 않는다 (본인 손해)
  if cardinality(v_ids) not between 1 and 10
     or not v_statuses_valid
     or (select count(distinct item.word_id) from unnest(v_ids) as item(word_id)) <> cardinality(v_ids)
     or (select count(*) from public.words where language = p_language and id = any(v_ids)) <> cardinality(v_ids) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select coalesce(array_agg(item.word_id), '{}')
    into v_new_ids
    from unnest(v_ids) as item(word_id)
   where not exists (
     select 1 from public.user_words uw where uw.user_id = p_user_id and uw.word_id = item.word_id);

  -- 전부 기존 단어(응답 유실 재전송)면 한도와 무관하게 성공하고 아무것도 바꾸지 않는다
  if cardinality(v_new_ids) = 0 then
    return jsonb_build_object('ok', true, 'inserted_count', 0);
  end if;

  v_limit := public.new_word_limit(p_user_id);
  select count(*) into v_used
    from public.user_words
   where user_id = p_user_id and first_seen_at >= public.kst_today_start();
  if v_used + cardinality(v_new_ids) > v_limit then
    perform public.record_limit_reached(p_user_id, 'words');
    return jsonb_build_object('ok', false, 'code', 'LIMIT_REACHED');
  end if;

  -- on conflict는 보조 방어다. 같은 계정의 저장은 위 profiles 잠금으로 순서가 정해진다
  insert into public.user_words (user_id, word_id, status, first_seen_at, updated_at)
  select p_user_id, item.word_id, item.status, now(), now()
    from jsonb_to_recordset(p_items) as item(word_id text, status text)
   where item.word_id = any(v_new_ids)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  perform public.record_activity(p_user_id);

  -- 이 저장으로 오늘 한도를 채웠다 (spec 1장 "지표 수집")
  if v_used + v_inserted = v_limit then
    perform public.record_limit_reached(p_user_id, 'words');
  end if;
  return jsonb_build_object('ok', true, 'inserted_count', v_inserted);
end;
$$;

-- 오답 복습 저장. items: [{"word_id": text, "knew": boolean}]. 사용량에 세지 않는다
create function public.save_review(p_user_id uuid, p_language text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
  v_ids text[];
  v_reviewed int;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'ready', p_language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  select coalesce(array_agg(item.word_id), '{}')
    into v_ids
    from jsonb_to_recordset(p_items) as item(word_id text);

  -- 서로 다른 단어 1~10개가 모두 이 사용자가 학습한 그 언어의 단어여야 한다
  if cardinality(v_ids) not between 1 and 10
     or (select count(distinct item.word_id) from unnest(v_ids) as item(word_id)) <> cardinality(v_ids)
     or (select count(*)
           from public.user_words uw
           join public.words w on w.id = uw.word_id
          where uw.user_id = p_user_id and uw.word_id = any(v_ids) and w.language = p_language)
        <> cardinality(v_ids) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- 아직 review인 제출 단어만 유효하다. [알아요]면 known으로 바꾸고, 아니면 review로 둔다
  select count(*) into v_reviewed
    from public.user_words
   where user_id = p_user_id and word_id = any(v_ids) and status = 'review';
  update public.user_words uw
     set status = 'known', updated_at = now()
    from jsonb_to_recordset(p_items) as item(word_id text, knew boolean)
   where uw.user_id = p_user_id and uw.word_id = item.word_id and uw.status = 'review' and item.knew;

  if v_reviewed > 0 then
    perform public.record_activity(p_user_id);
  end if;
  return jsonb_build_object('ok', true, 'reviewed_count', v_reviewed);
end;
$$;

-- 레벨업 테스트 결과. 채점은 use-case가 끝냈다. user_words는 바꾸지 않는다
create function public.submit_level_test(
  p_user_id uuid, p_language text, p_from_level int, p_score int, p_passed boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
  v_level int;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'ready', p_language);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  -- 고수(5)는 테스트가 없다
  if p_from_level not between 1 and 4 or p_score not between 0 and 20 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- 출제 뒤 레벨이 바뀌었거나 이미 반영한 시험이다. 합격 여부와 무관하게 아무것도 남기지 않는다
  if not exists (
    select 1 from public.user_levels
     where user_id = p_user_id and language = p_language and level = p_from_level
  ) then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  insert into public.events (user_id, name, props)
  values (p_user_id, 'level_test_submitted', jsonb_build_object(
    'language', p_language, 'from_level', p_from_level, 'score', p_score, 'passed', p_passed));
  if p_passed then
    update public.user_levels
       set level = p_from_level + 1
     where user_id = p_user_id and language = p_language and level = p_from_level;
  end if;
  perform public.record_activity(p_user_id);

  select level into v_level
    from public.user_levels
   where user_id = p_user_id and language = p_language;
  return jsonb_build_object('ok', true, 'passed', p_passed, 'level', v_level);
end;
$$;

-- /api/events가 남기는 이벤트는 이 2개뿐이다. 나머지 이벤트는 서버가 각 RPC 안에서 기록한다
create function public.record_event(p_user_id uuid, p_name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  v_code := public.check_readiness(p_user_id, 'ready');
  if v_code is not null then
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  if p_name is null or p_name not in ('pro_clicked', 'kana_studied') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  insert into public.events (user_id, name) values (p_user_id, p_name);
  -- 가나 회차 완료는 학습한 날이다 (spec 3-1장)
  if p_name = 'kana_studied' then
    perform public.record_activity(p_user_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 함수 실행 권한: service_role만 ----------------------------------------

revoke execute on function public.new_word_limit(uuid) from public, anon, authenticated;
grant execute on function public.new_word_limit(uuid) to service_role;
revoke execute on function public.save_word_batch(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_word_batch(uuid, text, jsonb) to service_role;
revoke execute on function public.save_review(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_review(uuid, text, jsonb) to service_role;
revoke execute on function public.submit_level_test(uuid, text, int, int, boolean) from public, anon, authenticated;
grant execute on function public.submit_level_test(uuid, text, int, int, boolean) to service_role;
revoke execute on function public.record_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_event(uuid, text) to service_role;
