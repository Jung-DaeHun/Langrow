-- AI 정답 설명 저장 RPC가 설명을 만든 단어 내용(예문·번역·뜻)을 받는다 (spec/words.md "AI 정답 설명")
--
-- 사람 검수 뒤 단어를 고쳐 seed하는 사이에 설명이 만들어지면, 옛 내용으로 만든 설명이 저장 시점의 새 해시로
-- 들어가 고친 단어의 저장본처럼 쓰였다. 이제 받은 내용이 지금 단어와 다르면 저장하지 않는다.
-- 함수 규칙은 word_explanations 마이그레이션과 같다 (p_user_id 없음, profiles를 잠그지 않음)

drop function public.save_word_explanation(text, text, text);

-- AI 생성 성공. p_example·p_example_ko·p_meaning_ko는 프롬프트를 만든 단어 내용이다.
-- 지금 단어와 다르면 옛 내용의 설명이라 저장하지 않고 성공한다. 비교와 해시 계산은 한 문장(같은 스냅숏)에서 한다.
-- 같은 키가 있으면 해시가 다를 때(옛 단어 기준)만 바꾸고, 같으면 먼저 저장된 것을 둔다
-- (동시에 처음 요청한 두 사람이 AI를 두 번 부르는 것은 허용한다)
create function public.save_word_explanation(
  p_word_id text,
  p_choice text,
  p_explanation text,
  p_example text,
  p_example_ko text,
  p_meaning_ko text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hash text;
  v_changed boolean;
begin
  select public.word_hash(id),
         (example, example_ko, meaning_ko) is distinct from (p_example, p_example_ko, p_meaning_ko)
    into v_hash, v_changed
    from public.words
   where id = p_word_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_changed then
    return jsonb_build_object('ok', true);
  end if;

  insert into public.word_explanations as e (word_id, choice, explanation, word_hash)
    values (p_word_id, p_choice, p_explanation, v_hash)
  on conflict (word_id, choice) do update
    set explanation = excluded.explanation, word_hash = excluded.word_hash, created_at = now()
    where e.word_hash <> excluded.word_hash;
  return jsonb_build_object('ok', true);
end;
$$;

-- 함수 실행 권한: service_role만 ----------------------------------------

revoke execute on function public.save_word_explanation(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_word_explanation(text, text, text, text, text, text) to service_role;
