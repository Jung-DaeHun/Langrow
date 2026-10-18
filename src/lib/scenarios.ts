import type { Breakdown } from "./breakdown";
import { LEVEL_INFO, LEVELS, type Language, type Level } from "./levels";

// pronKo: 한글 발음(spec/chat.md "한글 발음"). 일본어 입문~중급 상황(레벨 1~3)의 첫 마디에만 둔다
// breakdown: 문장 뜯어보기(spec/chat.md "문장 뜯어보기"). text는 alignBreakdown이 돌려주는 모양(첫 마디를 조각 경계에서 자른 부분)이다
export type ScenarioLine = { text: string; ko: string; pronKo?: string; breakdown?: Breakdown };
export type Scenario = {
  id: string;
  level: Level;
  title: string; // 상황 목록 타일 제목
  goal: string; // 사용자 목표. 타일 설명으로도 쓴다
  roles: Record<Language, { role: string; opening: ScenarioLine }>;
};

// 첫 마디(opening)와 그 뜯어보기(breakdown)는 AI 초안이라 출시 전에 사람이 검수한다.
// 일본어 첫 마디는 레벨과 무관하게 모든 한자에 [漢字|かな] 표기를 단다. 일본어는 모든 레벨에서 후리가나를 그린다(spec/chat.md "후리가나")
export const SCENARIOS: readonly Scenario[] = [
  {
    id: "l1-greeting",
    level: 1,
    title: "처음 만난 사람과 인사하기",
    goal: "이름과 출신을 말하고 상대에게도 물어봐요",
    roles: {
      en: {
        role: "당신은 미국 대학 기숙사에 사는 학생입니다. 옆방에 새로 온 사용자와 복도에서 처음 마주쳤습니다.",
        opening: {
          text: "Hi! What's your name?",
          ko: "안녕하세요! 이름이 뭐예요?",
          breakdown: [
            { text: "Hi!", meaning_ko: "안녕하세요" },
            { text: "What's", meaning_ko: "뭐예요" },
            { text: "your name?", meaning_ko: "이름이" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 셰어하우스에 사는 주민입니다. 새로 이사 온 사용자를 거실에서 처음 만났습니다.",
        opening: {
          text: "はじめまして！お[名前|なまえ]は[何|なん]ですか？",
          ko: "처음 뵙겠습니다! 이름이 뭐예요?",
          pronKo: "하지메마시테! 오나마에와 난데스카?",
          breakdown: [
            { text: "はじめまして！", meaning_ko: "처음 뵙겠습니다" },
            { text: "お[名前|なまえ]は", meaning_ko: "이름은" },
            { text: "[何|なん]ですか？", meaning_ko: "뭐예요" },
          ],
        },
      },
    },
  },
  {
    id: "l1-cafe",
    level: 1,
    title: "카페에서 음료 주문하기",
    goal: "마실 음료와 크기를 말하고 주문을 마쳐요",
    roles: {
      en: {
        role: "당신은 미국 동네 카페의 바리스타입니다. 계산대에서 손님인 사용자의 주문을 받습니다.",
        opening: {
          text: "Hi! What can I get for you?",
          ko: "안녕하세요! 뭘 드릴까요?",
          breakdown: [
            { text: "Hi!", meaning_ko: "안녕하세요" },
            { text: "What", meaning_ko: "무엇을" },
            { text: "can I get", meaning_ko: "드릴까요" },
            { text: "for you?", meaning_ko: "손님께" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 카페의 점원입니다. 계산대에서 손님인 사용자의 주문을 받습니다.",
        opening: {
          text: "いらっしゃいませ。ご[注文|ちゅうもん]はお[決|き]まりですか？",
          ko: "어서 오세요. 주문하시겠어요?",
          pronKo: "이랏샤이마세. 고츄-몬와 오키마리데스카?",
          breakdown: [
            { text: "いらっしゃいませ。", meaning_ko: "어서 오세요" },
            { text: "ご[注文|ちゅうもん]は", meaning_ko: "주문은" },
            { text: "お[決|き]まりですか？", meaning_ko: "정하셨나요" },
          ],
        },
      },
    },
  },
  {
    id: "l1-checkout",
    level: 1,
    title: "편의점에서 계산하기",
    goal: "봉투나 결제 방법을 묻는 말에 답하고 계산을 마쳐요",
    roles: {
      en: {
        role: "당신은 미국 편의점의 계산원입니다. 물건을 계산대에 올려놓은 손님인 사용자를 응대합니다.",
        opening: {
          text: "Hi! Do you need a bag?",
          ko: "안녕하세요! 봉투 필요하세요?",
          breakdown: [
            { text: "Hi!", meaning_ko: "안녕하세요" },
            { text: "Do you need", meaning_ko: "필요하세요" },
            { text: "a bag?", meaning_ko: "봉투가" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 편의점의 점원입니다. 도시락을 사는 손님인 사용자에게 도시락을 데울지, 봉투가 필요한지 묻습니다.",
        opening: {
          text: "お[弁当|べんとう]、[温|あたた]めますか？",
          ko: "도시락 데워 드릴까요?",
          pronKo: "오벤토-, 아타타메마스카?",
          breakdown: [
            { text: "お[弁当|べんとう]、", meaning_ko: "도시락" },
            { text: "[温|あたた]めますか？", meaning_ko: "데울까요" },
          ],
        },
      },
    },
  },
  {
    id: "l1-directions",
    level: 1,
    title: "길 물어보기",
    goal: "가고 싶은 곳을 말하고 가는 방법을 알아들어요",
    roles: {
      en: {
        role: "당신은 뉴욕 거리를 지나가던 친절한 행인입니다. 길을 헤매는 사용자를 보고 먼저 말을 걸었습니다.",
        opening: {
          text: "Hi! Are you looking for something?",
          ko: "안녕하세요! 뭘 찾고 계세요?",
          breakdown: [
            { text: "Hi!", meaning_ko: "안녕하세요" },
            { text: "Are you looking for", meaning_ko: "찾고 계세요" },
            { text: "something?", meaning_ko: "뭔가를" },
          ],
        },
      },
      ja: {
        role: "당신은 도쿄 역 앞을 지나가던 친절한 행인입니다. 길을 헤매는 사용자를 보고 먼저 말을 걸었습니다.",
        opening: {
          text: "あの、どこに[行|い]きたいですか？",
          ko: "저기요, 어디에 가고 싶으세요?",
          pronKo: "아노, 도코니 이키타이데스카?",
          breakdown: [
            { text: "あの、", meaning_ko: "저기요" },
            { text: "どこに", meaning_ko: "어디에" },
            { text: "[行|い]きたいですか？", meaning_ko: "가고 싶으세요" },
          ],
        },
      },
    },
  },
  // 레벨마다 5~7번째 상황은 2026-10-18에 더했다(spec/chat.md "상황 목록")
  {
    id: "l1-taxi",
    level: 1,
    title: "택시에서 목적지 말하기",
    goal: "가고 싶은 곳을 말하고 도착하면 요금을 내요",
    roles: {
      en: {
        role: "당신은 미국 도시의 택시 기사입니다. 택시에 막 탄 손님인 사용자에게 어디로 갈지 묻습니다.",
        opening: {
          text: "Hi! Where are you going?",
          ko: "안녕하세요! 어디 가세요?",
          breakdown: [
            { text: "Hi!", meaning_ko: "안녕하세요" },
            { text: "Where", meaning_ko: "어디" },
            { text: "are you going?", meaning_ko: "가세요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 도시의 택시 기사입니다. 택시에 막 탄 손님인 사용자에게 어디로 갈지 묻습니다.",
        opening: {
          text: "こんにちは。どちらまでですか？",
          ko: "안녕하세요. 어디까지 가세요?",
          pronKo: "콘니치와. 도치라마데데스카?",
          breakdown: [
            { text: "こんにちは。", meaning_ko: "안녕하세요" },
            { text: "どちらまで", meaning_ko: "어디까지" },
            { text: "ですか？", meaning_ko: "인가요" },
          ],
        },
      },
    },
  },
  {
    id: "l1-favorites",
    level: 1,
    title: "좋아하는 것 이야기하기",
    goal: "좋아하는 음식이나 취미를 말하고 상대에게도 물어요",
    roles: {
      en: {
        role: "당신은 언어 교환 모임에서 사용자와 짝이 된 미국인입니다. 서로 좋아하는 것을 이야기하며 친해지려고 합니다.",
        opening: {
          text: "I like music. What do you like?",
          ko: "나는 음악을 좋아해. 너는 뭘 좋아해?",
          breakdown: [
            { text: "I like", meaning_ko: "나는 좋아해" },
            { text: "music.", meaning_ko: "음악을" },
            { text: "What", meaning_ko: "무엇을" },
            { text: "do you like?", meaning_ko: "너는 좋아해?" },
          ],
        },
      },
      ja: {
        role: "당신은 언어 교환 모임에서 사용자와 짝이 된 일본인입니다. 서로 좋아하는 것을 이야기하며 친해지려고 합니다.",
        opening: {
          text: "[私|わたし]は[音楽|おんがく]が[好|す]きです。[何|なに]が[好|す]きですか？",
          ko: "저는 음악을 좋아해요. 뭘 좋아하세요?",
          pronKo: "와타시와 온가쿠가 스키데스. 나니가 스키데스카?",
          breakdown: [
            { text: "[私|わたし]は", meaning_ko: "저는" },
            { text: "[音楽|おんがく]が", meaning_ko: "음악을" },
            { text: "[好|す]きです。", meaning_ko: "좋아해요" },
            { text: "[何|なに]が", meaning_ko: "무엇을" },
            { text: "[好|す]きですか？", meaning_ko: "좋아하세요" },
          ],
        },
      },
    },
  },
  {
    id: "l1-plans",
    level: 1,
    title: "친구와 약속 시간 정하기",
    goal: "만날 날과 시간, 장소를 정해요",
    roles: {
      en: {
        role: "당신은 사용자의 미국인 친구입니다. 이번 주말에 같이 영화를 보자고 사용자에게 먼저 제안했습니다.",
        opening: {
          text: "Let's see a movie this weekend! When are you free?",
          ko: "이번 주말에 영화 보자! 언제 시간 돼?",
          breakdown: [
            { text: "Let's see", meaning_ko: "보자" },
            { text: "a movie", meaning_ko: "영화를" },
            { text: "this weekend!", meaning_ko: "이번 주말에" },
            { text: "When", meaning_ko: "언제" },
            { text: "are you free?", meaning_ko: "시간 돼?" },
          ],
        },
      },
      ja: {
        role: "당신은 사용자의 일본인 친구입니다. 이번 주말에 같이 영화를 보자고 사용자에게 먼저 제안했습니다.",
        opening: {
          text: "[週末|しゅうまつ]、[一緒|いっしょ]に[映画|えいが]を[見|み]ませんか？いつがいいですか？",
          ko: "주말에 같이 영화 보지 않을래요? 언제가 좋아요?",
          pronKo: "슈-마츠, 잇쇼니 에-가오 미마센카? 이츠가 이-데스카?",
          breakdown: [
            { text: "[週末|しゅうまつ]、", meaning_ko: "주말에" },
            { text: "[一緒|いっしょ]に", meaning_ko: "같이" },
            { text: "[映画|えいが]を", meaning_ko: "영화를" },
            { text: "[見|み]ませんか？", meaning_ko: "보지 않을래요" },
            { text: "いつが", meaning_ko: "언제가" },
            { text: "いいですか？", meaning_ko: "좋아요" },
          ],
        },
      },
    },
  },
  {
    id: "l2-restaurant",
    level: 2,
    title: "식당에서 주문하기",
    goal: "인원수를 말하고 메뉴를 추천받아 주문해요",
    roles: {
      en: {
        role: "당신은 미국 캐주얼 레스토랑의 서버입니다. 가게에 막 들어온 손님인 사용자를 맞이합니다.",
        opening: {
          text: "Welcome! How many people are in your group today?",
          ko: "어서 오세요! 오늘 몇 분이세요?",
          breakdown: [
            { text: "Welcome!", meaning_ko: "어서 오세요" },
            { text: "How many people", meaning_ko: "몇 명이" },
            { text: "are in your group", meaning_ko: "일행이세요" },
            { text: "today?", meaning_ko: "오늘" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 정식집(定食屋)의 점원입니다. 가게에 막 들어온 손님인 사용자를 맞이합니다.",
        opening: {
          text: "いらっしゃいませ！[何名様|なんめいさま]ですか？",
          ko: "어서 오세요! 몇 분이세요?",
          pronKo: "이랏샤이마세! 난메-사마데스카?",
          breakdown: [
            { text: "いらっしゃいませ！", meaning_ko: "어서 오세요" },
            { text: "[何名様|なんめいさま]ですか？", meaning_ko: "몇 분이세요" },
          ],
        },
      },
    },
  },
  {
    id: "l2-hotel",
    level: 2,
    title: "호텔 체크인하기",
    goal: "예약자 이름을 말하고 체크인과 조식 시간을 확인해요",
    roles: {
      en: {
        role: "당신은 미국 호텔의 프런트 직원입니다. 체크인하러 프런트에 온 투숙객인 사용자를 응대합니다.",
        opening: {
          text: "Good evening! Can I have the name on your reservation?",
          ko: "안녕하세요! 예약하신 분 성함을 알려 주시겠어요?",
          breakdown: [
            { text: "Good evening!", meaning_ko: "안녕하세요(저녁 인사)" },
            { text: "Can I have", meaning_ko: "알려 주시겠어요" },
            { text: "the name", meaning_ko: "성함을" },
            { text: "on your reservation?", meaning_ko: "예약하신" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 비즈니스호텔의 프런트 직원입니다. 체크인하러 프런트에 온 투숙객인 사용자를 응대합니다.",
        opening: {
          text: "いらっしゃいませ。ご[予約|よやく]のお[名前|なまえ]をお[願|ねが]いします。",
          ko: "어서 오세요. 예약하신 성함을 말씀해 주세요.",
          pronKo: "이랏샤이마세. 고요야쿠노 오나마에오 오네가이시마스.",
          breakdown: [
            { text: "いらっしゃいませ。", meaning_ko: "어서 오세요" },
            { text: "ご[予約|よやく]の", meaning_ko: "예약하신" },
            { text: "お[名前|なまえ]を", meaning_ko: "성함을" },
            { text: "お[願|ねが]いします。", meaning_ko: "부탁드립니다" },
          ],
        },
      },
    },
  },
  {
    id: "l2-clothes",
    level: 2,
    title: "옷 가게에서 사이즈 찾기",
    goal: "원하는 옷의 사이즈와 색을 묻고 입어 봐도 되는지 물어요",
    roles: {
      en: {
        role: "당신은 미국 의류 매장의 점원입니다. 매장 안을 둘러보는 손님인 사용자에게 다가갑니다.",
        opening: {
          text: "Hi there! Are you looking for anything special today?",
          ko: "안녕하세요! 오늘 특별히 찾으시는 거 있으세요?",
          breakdown: [
            { text: "Hi there!", meaning_ko: "안녕하세요" },
            { text: "Are you looking for", meaning_ko: "찾고 계세요" },
            { text: "anything special", meaning_ko: "특별한 거" },
            { text: "today?", meaning_ko: "오늘" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 의류 매장의 점원입니다. 매장 안을 둘러보는 손님인 사용자에게 다가갑니다.",
        opening: {
          text: "いらっしゃいませ。[何|なに]かお[探|さが]しですか？",
          ko: "어서 오세요. 뭐 찾으시는 거 있으세요?",
          pronKo: "이랏샤이마세. 나니카 오사가시데스카?",
          breakdown: [
            { text: "いらっしゃいませ。", meaning_ko: "어서 오세요" },
            { text: "[何|なに]か", meaning_ko: "뭔가" },
            { text: "お[探|さが]しですか？", meaning_ko: "찾으세요" },
          ],
        },
      },
    },
  },
  {
    id: "l2-train",
    level: 2,
    title: "기차표 사기",
    goal: "목적지와 시간을 말하고 표를 산 뒤 타는 곳을 확인해요",
    roles: {
      en: {
        role: "당신은 미국 장거리 기차역의 매표 창구 직원입니다. 표를 사러 창구에 온 승객인 사용자를 응대합니다.",
        opening: {
          text: "Hi, where are you traveling to today?",
          ko: "안녕하세요, 오늘 어디로 가세요?",
          breakdown: [
            { text: "Hi,", meaning_ko: "안녕하세요" },
            { text: "where", meaning_ko: "어디로" },
            { text: "are you traveling to", meaning_ko: "가세요" },
            { text: "today?", meaning_ko: "오늘" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 기차역의 매표 창구 직원입니다. 표를 사러 창구에 온 승객인 사용자를 응대합니다.",
        opening: {
          text: "こんにちは。どちらまで[行|い]かれますか？",
          ko: "안녕하세요. 어디까지 가세요?",
          pronKo: "콘니치와. 도치라마데 이카레마스카?",
          breakdown: [
            { text: "こんにちは。", meaning_ko: "안녕하세요" },
            { text: "どちらまで", meaning_ko: "어디까지" },
            { text: "[行|い]かれますか？", meaning_ko: "가세요" },
          ],
        },
      },
    },
  },
  {
    id: "l2-airport",
    level: 2,
    title: "공항에서 체크인하기",
    goal: "여권을 보여 주고 좌석과 짐을 정해 체크인을 마쳐요",
    roles: {
      en: {
        role: "당신은 미국 공항 항공사 카운터의 직원입니다. 체크인하러 온 승객인 사용자를 응대합니다.",
        opening: {
          text: "Good morning! Can I see your passport, please?",
          ko: "안녕하세요! 여권 좀 보여 주시겠어요?",
          breakdown: [
            { text: "Good morning!", meaning_ko: "안녕하세요(아침 인사)" },
            { text: "Can I see", meaning_ko: "볼 수 있을까요" },
            { text: "your passport,", meaning_ko: "여권을" },
            { text: "please?", meaning_ko: "부탁드려요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 공항 항공사 카운터의 직원입니다. 체크인하러 온 승객인 사용자를 응대합니다.",
        opening: {
          text: "おはようございます。パスポートをお[願|ねが]いします。",
          ko: "안녕하세요. 여권 부탁드립니다.",
          pronKo: "오하요- 고자이마스. 파스포-토오 오네가이시마스.",
          breakdown: [
            { text: "おはようございます。", meaning_ko: "안녕하세요(아침 인사)" },
            { text: "パスポートを", meaning_ko: "여권을" },
            { text: "お[願|ねが]いします。", meaning_ko: "부탁드립니다" },
          ],
        },
      },
    },
  },
  {
    id: "l2-tourist-info",
    level: 2,
    title: "관광 안내소에서 추천 받기",
    goal: "가고 싶은 곳을 말하고 추천 장소와 가는 방법을 물어요",
    roles: {
      en: {
        role: "당신은 샌프란시스코 관광 안내소의 직원입니다. 안내소를 찾아온 여행자인 사용자에게 볼거리를 추천합니다.",
        opening: {
          text: "Hi there! Welcome to the visitor center. What would you like to see today?",
          ko: "안녕하세요! 관광 안내소에 오신 걸 환영해요. 오늘 무엇을 보고 싶으세요?",
          breakdown: [
            { text: "Hi there!", meaning_ko: "안녕하세요" },
            { text: "Welcome to", meaning_ko: "~에 오신 걸 환영해요" },
            { text: "the visitor center.", meaning_ko: "관광 안내소" },
            { text: "What", meaning_ko: "무엇을" },
            { text: "would you like to see", meaning_ko: "보고 싶으세요" },
            { text: "today?", meaning_ko: "오늘" },
          ],
        },
      },
      ja: {
        role: "당신은 교토 관광 안내소의 직원입니다. 안내소를 찾아온 여행자인 사용자에게 볼거리를 추천합니다.",
        opening: {
          text: "こんにちは。[観光|かんこう]ですか？どんなところに[行|い]きたいですか？",
          ko: "안녕하세요. 관광 오셨어요? 어떤 곳에 가고 싶으세요?",
          pronKo: "콘니치와. 칸코-데스카? 돈나 토코로니 이키타이데스카?",
          breakdown: [
            { text: "こんにちは。", meaning_ko: "안녕하세요" },
            { text: "[観光|かんこう]ですか？", meaning_ko: "관광이세요" },
            { text: "どんな", meaning_ko: "어떤" },
            { text: "ところに", meaning_ko: "곳에" },
            { text: "[行|い]きたいですか？", meaning_ko: "가고 싶으세요" },
          ],
        },
      },
    },
  },
  {
    id: "l2-hair-salon",
    level: 2,
    title: "미용실에서 원하는 스타일 말하기",
    goal: "원하는 머리 길이와 스타일을 말하고 확인해요",
    roles: {
      en: {
        role: "당신은 미국 미용실의 미용사입니다. 의자에 앉은 손님인 사용자에게 원하는 스타일을 묻습니다.",
        opening: {
          text: "Hi! Have a seat. So, what are we doing today?",
          ko: "안녕하세요! 앉으세요. 오늘은 어떻게 해 드릴까요?",
          breakdown: [
            { text: "Hi!", meaning_ko: "안녕하세요" },
            { text: "Have a seat.", meaning_ko: "앉으세요" },
            { text: "So,", meaning_ko: "그럼" },
            { text: "what are we doing", meaning_ko: "어떻게 할까요" },
            { text: "today?", meaning_ko: "오늘은" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 미용실의 미용사입니다. 의자에 앉은 손님인 사용자에게 원하는 스타일을 묻습니다.",
        opening: {
          text: "いらっしゃいませ。[今日|きょう]はどうされますか？",
          ko: "어서 오세요. 오늘은 어떻게 해 드릴까요?",
          pronKo: "이랏샤이마세. 쿄-와 도- 사레마스카?",
          breakdown: [
            { text: "いらっしゃいませ。", meaning_ko: "어서 오세요" },
            { text: "[今日|きょう]は", meaning_ko: "오늘은" },
            { text: "どうされますか？", meaning_ko: "어떻게 하시겠어요" },
          ],
        },
      },
    },
  },
  {
    id: "l3-pharmacy",
    level: 3,
    title: "약국에서 증상 설명하기",
    goal: "증상을 설명하고 알맞은 약과 먹는 방법을 물어요",
    roles: {
      en: {
        role: "당신은 미국 약국의 약사입니다. 약을 사러 온 사용자의 증상을 듣고 알맞은 약과 복용법을 안내합니다.",
        opening: {
          text: "Hi, how can I help you today? Are you not feeling well?",
          ko: "안녕하세요, 무엇을 도와드릴까요? 몸이 안 좋으세요?",
          breakdown: [
            { text: "Hi,", meaning_ko: "안녕하세요" },
            { text: "how", meaning_ko: "어떻게" },
            { text: "can I help you", meaning_ko: "도와드릴까요" },
            { text: "today?", meaning_ko: "오늘" },
            { text: "Are you not feeling well?", meaning_ko: "몸이 안 좋으세요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 드러그스토어의 약사입니다. 약을 사러 온 사용자의 증상을 듣고 알맞은 약과 복용법을 안내합니다.",
        opening: {
          text: "こんにちは、どうされましたか？どんな[症状|しょうじょう]か[教|おし]えていただけますか？",
          ko: "안녕하세요, 어디가 불편하세요? 어떤 증상인지 알려 주시겠어요?",
          pronKo: "콘니치와, 도- 사레마시타카? 돈나 쇼-죠-카 오시에테 이타다케마스카?",
          breakdown: [
            { text: "こんにちは、", meaning_ko: "안녕하세요" },
            { text: "どうされましたか？", meaning_ko: "어디가 불편하세요" },
            { text: "どんな", meaning_ko: "어떤" },
            { text: "[症状|しょうじょう]か", meaning_ko: "증상인지" },
            { text: "[教|おし]えていただけますか？", meaning_ko: "알려 주시겠어요" },
          ],
        },
      },
    },
  },
  {
    id: "l3-weekend",
    level: 3,
    title: "동료와 주말 이야기하기",
    goal: "주말에 한 일을 이야기하고 상대 이야기에 반응해요",
    roles: {
      en: {
        role: "당신은 미국 회사에서 사용자와 함께 일하는 동료입니다. 월요일 아침 탕비실에서 사용자를 만났습니다.",
        opening: {
          text: "Morning! How was your weekend? Did you do anything fun?",
          ko: "좋은 아침이에요! 주말 어땠어요? 뭐 재미있는 거 했어요?",
          breakdown: [
            { text: "Morning!", meaning_ko: "좋은 아침이에요" },
            { text: "How was", meaning_ko: "어땠어요" },
            { text: "your weekend?", meaning_ko: "주말은" },
            { text: "Did you do", meaning_ko: "했어요" },
            { text: "anything fun?", meaning_ko: "뭐 재미있는 거" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 회사에서 사용자와 함께 일하는 동료입니다. 월요일 점심시간에 사용자와 같은 테이블에 앉았습니다.",
        opening: {
          text: "お[疲|つか]れさまです。[週末|しゅうまつ]は[何|なに]をしていましたか？",
          ko: "수고 많으세요. 주말에는 뭐 했어요?",
          pronKo: "오츠카레사마데스. 슈-마츠와 나니오 시테 이마시타카?",
          breakdown: [
            { text: "お[疲|つか]れさまです。", meaning_ko: "수고 많으세요" },
            { text: "[週末|しゅうまつ]は", meaning_ko: "주말에는" },
            { text: "[何|なに]を", meaning_ko: "무엇을" },
            { text: "していましたか？", meaning_ko: "하고 있었어요?" },
          ],
        },
      },
    },
  },
  {
    id: "l3-return",
    level: 3,
    title: "산 물건 교환·환불하기",
    goal: "문제를 설명하고 교환이나 환불을 요청해요",
    roles: {
      en: {
        role: "당신은 미국 전자제품 매장의 고객 서비스 데스크 직원입니다. 산 물건에 문제가 있어 찾아온 고객인 사용자를 응대합니다.",
        opening: {
          text: "Hi, welcome to customer service. What seems to be the problem with your item?",
          ko: "안녕하세요, 고객 서비스 데스크입니다. 구매하신 제품에 어떤 문제가 있으세요?",
          breakdown: [
            { text: "Hi,", meaning_ko: "안녕하세요" },
            { text: "welcome to", meaning_ko: "~에 오신 걸 환영해요" },
            { text: "customer service.", meaning_ko: "고객 서비스 데스크" },
            { text: "What seems to be", meaning_ko: "무엇인가요" },
            { text: "the problem", meaning_ko: "문제가" },
            { text: "with your item?", meaning_ko: "구매하신 제품의" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 가전제품 매장의 서비스 카운터 직원입니다. 산 물건에 문제가 있어 찾아온 고객인 사용자를 응대합니다.",
        opening: {
          text: "いらっしゃいませ。お[買|か]い[上|あ]げの[商品|しょうひん]に[何|なに]か[問題|もんだい]がございましたか？",
          ko: "어서 오세요. 구매하신 상품에 무슨 문제가 있으셨나요?",
          pronKo: "이랏샤이마세. 오카이아게노 쇼-힌니 나니카 몬다이가 고자이마시타카?",
          breakdown: [
            { text: "いらっしゃいませ。", meaning_ko: "어서 오세요" },
            { text: "お[買|か]い[上|あ]げの", meaning_ko: "구매하신" },
            { text: "[商品|しょうひん]に", meaning_ko: "상품에" },
            { text: "[何|なに]か", meaning_ko: "무슨" },
            { text: "[問題|もんだい]が", meaning_ko: "문제가" },
            { text: "ございましたか？", meaning_ko: "있으셨나요" },
          ],
        },
      },
    },
  },
  {
    id: "l3-reservation",
    level: 3,
    title: "전화로 식당 예약하기",
    goal: "날짜·시간·인원을 정하고 요청 사항을 전해요",
    roles: {
      en: {
        role: "당신은 미국 레스토랑의 직원입니다. 가게로 걸려 온 사용자의 예약 전화를 받았습니다.",
        opening: {
          text: "Thank you for calling. Would you like to make a reservation?",
          ko: "전화 주셔서 감사합니다. 예약하시겠어요?",
          breakdown: [
            { text: "Thank you", meaning_ko: "감사합니다" },
            { text: "for calling.", meaning_ko: "전화 주셔서" },
            { text: "Would you like to", meaning_ko: "~하시겠어요" },
            { text: "make a reservation?", meaning_ko: "예약하다" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 이자카야의 직원입니다. 가게로 걸려 온 사용자의 예약 전화를 받았습니다.",
        opening: {
          text: "お[電話|でんわ]ありがとうございます。ご[予約|よやく]でしょうか？",
          ko: "전화 주셔서 감사합니다. 예약하시겠어요?",
          pronKo: "오덴와 아리가토- 고자이마스. 고요야쿠데쇼-카?",
          breakdown: [
            { text: "お[電話|でんわ]", meaning_ko: "전화" },
            { text: "ありがとうございます。", meaning_ko: "감사합니다" },
            { text: "ご[予約|よやく]でしょうか？", meaning_ko: "예약이신가요" },
          ],
        },
      },
    },
  },
  {
    id: "l3-clinic",
    level: 3,
    title: "병원 접수하기",
    goal: "처음 왔다고 말하고 증상과 보험을 확인해 접수를 마쳐요",
    roles: {
      en: {
        role: "당신은 미국 동네 병원(클리닉) 접수처의 직원입니다. 진료를 받으러 온 사용자를 접수합니다.",
        opening: {
          text: "Good morning. Is this your first visit with us? And what brings you in today?",
          ko: "안녕하세요. 저희 병원은 처음이세요? 오늘은 어디가 불편해서 오셨어요?",
          breakdown: [
            { text: "Good morning.", meaning_ko: "안녕하세요(아침 인사)" },
            { text: "Is this", meaning_ko: "~인가요" },
            { text: "your first visit", meaning_ko: "첫 방문" },
            { text: "with us?", meaning_ko: "저희 병원" },
            { text: "And", meaning_ko: "그리고" },
            { text: "what brings you in", meaning_ko: "무슨 일로 오셨어요" },
            { text: "today?", meaning_ko: "오늘은" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 동네 병원(내과 의원) 접수처의 직원입니다. 진료를 받으러 온 사용자를 접수합니다.",
        opening: {
          text: "こんにちは。[初診|しょしん]の[方|かた]ですか？[保険証|ほけんしょう]はお[持|も]ちですか？",
          ko: "안녕하세요. 처음 오신 분인가요? 건강보험증은 가지고 계세요?",
          pronKo: "콘니치와. 쇼신노 카타데스카? 호켄쇼-와 오모치데스카?",
          breakdown: [
            { text: "こんにちは。", meaning_ko: "안녕하세요" },
            { text: "[初診|しょしん]の", meaning_ko: "처음 진료받는" },
            { text: "[方|かた]ですか？", meaning_ko: "분이세요" },
            { text: "[保険証|ほけんしょう]は", meaning_ko: "보험증은" },
            { text: "お[持|も]ちですか？", meaning_ko: "가지고 계세요" },
          ],
        },
      },
    },
  },
  {
    id: "l3-package",
    level: 3,
    title: "이웃에게 택배 맡아 달라고 부탁하기",
    goal: "사정을 설명하고 택배를 대신 받아 달라고 정중히 부탁해요",
    roles: {
      en: {
        role: "당신은 미국 아파트에 사는 사용자의 옆집 이웃입니다. 사용자가 문을 두드려서 문을 열었습니다.",
        opening: {
          text: "Oh, hi! You're from next door, right? What's up?",
          ko: "아, 안녕하세요! 옆집 분이시죠? 무슨 일이세요?",
          breakdown: [
            { text: "Oh, hi!", meaning_ko: "아, 안녕하세요" },
            { text: "You're from next door,", meaning_ko: "옆집 분이시죠" },
            { text: "right?", meaning_ko: "맞죠" },
            { text: "What's up?", meaning_ko: "무슨 일이세요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 아파트에 사는 사용자의 옆집 이웃입니다. 사용자가 초인종을 눌러서 문을 열었습니다.",
        opening: {
          text: "あ、こんにちは。[隣|となり]の[方|かた]ですよね？どうかしましたか？",
          ko: "아, 안녕하세요. 옆집 분이시죠? 무슨 일 있으세요?",
          pronKo: "아, 콘니치와. 토나리노 카타데스요네? 도-카 시마시타카?",
          breakdown: [
            { text: "あ、", meaning_ko: "아" },
            { text: "こんにちは。", meaning_ko: "안녕하세요" },
            { text: "[隣|となり]の", meaning_ko: "옆집" },
            { text: "[方|かた]ですよね？", meaning_ko: "분이시죠" },
            { text: "どうかしましたか？", meaning_ko: "무슨 일 있으세요" },
          ],
        },
      },
    },
  },
  {
    id: "l3-lost-item",
    level: 3,
    title: "분실물 신고하기",
    goal: "잃어버린 물건의 생김새와 잃어버린 장소·시간을 설명해요",
    roles: {
      en: {
        role: "당신은 미국 지하철역 분실물 센터의 직원입니다. 물건을 잃어버리고 찾아온 사용자를 응대합니다.",
        opening: {
          text: "Hi, this is the lost and found. What did you lose, and do you remember where you had it last?",
          ko: "안녕하세요, 분실물 센터입니다. 무엇을 잃어버리셨고, 마지막으로 어디서 가지고 계셨는지 기억나세요?",
          breakdown: [
            { text: "Hi,", meaning_ko: "안녕하세요" },
            { text: "this is", meaning_ko: "~입니다" },
            { text: "the lost and found.", meaning_ko: "분실물 센터" },
            { text: "What", meaning_ko: "무엇을" },
            { text: "did you lose,", meaning_ko: "잃어버리셨어요" },
            { text: "and", meaning_ko: "그리고" },
            { text: "do you remember", meaning_ko: "기억나세요" },
            { text: "where", meaning_ko: "어디서" },
            { text: "you had it last?", meaning_ko: "마지막으로 가지고 계셨는지" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 기차역 분실물 센터의 직원입니다. 물건을 잃어버리고 찾아온 사용자를 응대합니다.",
        opening: {
          text: "[忘|わす]れ[物|もの]ですね。いつ、どこで、[何|なに]をなくされましたか？",
          ko: "분실물이시군요. 언제, 어디서, 무엇을 잃어버리셨어요?",
          pronKo: "와스레모노데스네. 이츠, 도코데, 나니오 나쿠사레마시타카?",
          breakdown: [
            { text: "[忘|わす]れ[物|もの]ですね。", meaning_ko: "분실물이시군요" },
            { text: "いつ、", meaning_ko: "언제" },
            { text: "どこで、", meaning_ko: "어디서" },
            { text: "[何|なに]を", meaning_ko: "무엇을" },
            { text: "なくされましたか？", meaning_ko: "잃어버리셨어요" },
          ],
        },
      },
    },
  },
  {
    id: "l4-interview",
    level: 4,
    title: "면접 보기",
    goal: "자기소개를 하고 경험과 강점을 구체적인 예로 설명해요",
    roles: {
      en: {
        role: "당신은 미국 IT 기업의 채용 면접관입니다. 면접을 보러 온 지원자인 사용자를 면접합니다.",
        opening: {
          text: "Thanks for coming in today. To start, could you tell me a little about yourself and what drew you to this role?",
          ko: "오늘 와 주셔서 감사합니다. 먼저 간단히 자기소개를 하고, 이 직무에 지원하게 된 이유를 말씀해 주시겠어요?",
          breakdown: [
            { text: "Thanks", meaning_ko: "감사합니다" },
            { text: "for coming in today.", meaning_ko: "오늘 와 주셔서" },
            { text: "To start,", meaning_ko: "먼저" },
            { text: "could you tell me", meaning_ko: "말씀해 주시겠어요" },
            { text: "a little", meaning_ko: "조금" },
            { text: "about yourself", meaning_ko: "자기 자신에 대해" },
            { text: "and", meaning_ko: "그리고" },
            { text: "what drew you", meaning_ko: "무엇에 끌렸는지" },
            { text: "to this role?", meaning_ko: "이 직무에" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 기업의 채용 면접관입니다. 면접을 보러 온 지원자인 사용자를 면접하며, 면접 예절과 경어를 지킵니다.",
        opening: {
          text: "[本日|ほんじつ]はお[越|こ]しいただき、ありがとうございます。それでは、まず[自己紹介|じこしょうかい]をお[願|ねが]いできますか？",
          ko: "오늘 와 주셔서 감사합니다. 그럼 먼저 자기소개를 부탁드려도 될까요?",
          breakdown: [
            { text: "[本日|ほんじつ]は", meaning_ko: "오늘은" },
            { text: "お[越|こ]しいただき、", meaning_ko: "와 주셔서" },
            { text: "ありがとうございます。", meaning_ko: "감사합니다" },
            { text: "それでは、", meaning_ko: "그럼" },
            { text: "まず", meaning_ko: "먼저" },
            { text: "[自己紹介|じこしょうかい]を", meaning_ko: "자기소개를" },
            { text: "お[願|ねが]いできますか？", meaning_ko: "부탁드려도 될까요" },
          ],
        },
      },
    },
  },
  {
    id: "l4-meeting",
    level: 4,
    title: "회의에서 의견 말하기",
    goal: "의견을 말하고 반대 의견에 근거를 들어 답해요",
    roles: {
      en: {
        role: "당신은 미국 회사의 팀장입니다. 팀 회의에서 신규 기능 일정을 2주 당기자고 제안했고, 팀원인 사용자의 의견을 묻습니다.",
        opening: {
          text: "So here's my proposal: I think we should move the launch of the new feature up by two weeks. The client's been pushing for it, and I think we can pull it off. What's your take?",
          ko: "제안을 하나 하자면, 신규 기능 출시를 2주 앞당겼으면 해요. 고객사가 계속 요청하고 있고, 충분히 해낼 수 있을 것 같아요. 어떻게 생각하세요?",
          breakdown: [
            { text: "So", meaning_ko: "자" },
            { text: "here's my proposal:", meaning_ko: "제 제안은 이거예요" },
            { text: "I think", meaning_ko: "제 생각에는" },
            { text: "we should", meaning_ko: "우리가 ~하는 게 좋겠어요" },
            { text: "move the launch", meaning_ko: "출시를 옮기다" },
            { text: "of the new feature", meaning_ko: "신규 기능의" },
            { text: "up by two weeks.", meaning_ko: "2주 앞으로" },
            { text: "The client's been pushing", meaning_ko: "고객사가 계속 요구해 왔어요" },
            { text: "for it,", meaning_ko: "그것을" },
            { text: "and", meaning_ko: "그리고" },
            { text: "I think", meaning_ko: "제 생각에는" },
            { text: "we can pull it off.", meaning_ko: "우리가 해낼 수 있어요" },
            { text: "What's", meaning_ko: "무엇인가요" },
            { text: "your take?", meaning_ko: "당신의 의견은" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 회사의 과장입니다. 팀 회의에서 신규 기능 일정을 2주 당기자고 제안했고, 팀원인 사용자의 의견을 묻습니다.",
        opening: {
          text: "[新機能|しんきのう]のリリースを、[予定|よてい]より2[週間|しゅうかん][前倒|まえだお]しにしようと[思|おも]っています。お[客様|きゃくさま]からの[要望|ようぼう]が[強|つよ]くてね。この[案|あん]について、[意見|いけん]を[聞|き]かせてもらえますか？",
          ko: "신규 기능 출시를 예정보다 2주 앞당기려고 해요. 고객사의 요청이 강해서요. 이 안에 대해 의견을 들려주겠어요?",
          breakdown: [
            { text: "[新機能|しんきのう]の", meaning_ko: "신규 기능의" },
            { text: "リリースを、", meaning_ko: "출시를" },
            { text: "[予定|よてい]より", meaning_ko: "예정보다" },
            { text: "2[週間|しゅうかん]", meaning_ko: "2주" },
            { text: "[前倒|まえだお]しにしようと", meaning_ko: "앞당기려고" },
            { text: "[思|おも]っています。", meaning_ko: "생각하고 있어요" },
            { text: "お[客様|きゃくさま]からの", meaning_ko: "고객사로부터의" },
            { text: "[要望|ようぼう]が", meaning_ko: "요청이" },
            { text: "[強|つよ]くてね。", meaning_ko: "강해서요" },
            { text: "この", meaning_ko: "이" },
            { text: "[案|あん]について、", meaning_ko: "안에 대해" },
            { text: "[意見|いけん]を", meaning_ko: "의견을" },
            { text: "[聞|き]かせてもらえますか？", meaning_ko: "들려주겠어요" },
          ],
        },
      },
    },
  },
  {
    id: "l4-repair",
    level: 4,
    title: "집 수리 요청하기",
    goal: "고장 상황을 설명하고 수리 일정을 조율해요",
    roles: {
      en: {
        role: "당신은 미국 아파트 관리 사무소의 직원입니다. 집에 고장 난 곳이 있어 전화를 건 세입자인 사용자를 응대합니다.",
        opening: {
          text: "Hi, you've reached the management office. What seems to be the problem in your apartment, and when did it start?",
          ko: "안녕하세요, 관리 사무소입니다. 집에 어떤 문제가 있고, 언제부터 그랬나요?",
          breakdown: [
            { text: "Hi,", meaning_ko: "안녕하세요" },
            { text: "you've reached", meaning_ko: "~에 연결되셨어요" },
            { text: "the management office.", meaning_ko: "관리 사무소" },
            { text: "What seems to be", meaning_ko: "무엇인가요" },
            { text: "the problem", meaning_ko: "문제가" },
            { text: "in your apartment,", meaning_ko: "댁에서" },
            { text: "and", meaning_ko: "그리고" },
            { text: "when", meaning_ko: "언제" },
            { text: "did it start?", meaning_ko: "시작됐나요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 임대 아파트 관리회사의 담당자입니다. 집에 고장 난 곳이 있어 전화를 건 세입자인 사용자를 응대합니다.",
        opening: {
          text: "お[電話|でんわ]ありがとうございます、[管理会社|かんりがいしゃ]の[担当|たんとう]です。お[部屋|へや]でどのような[不具合|ふぐあい]がございましたか？",
          ko: "전화 주셔서 감사합니다, 관리회사 담당자입니다. 집에 어떤 문제가 있으신가요?",
          breakdown: [
            { text: "お[電話|でんわ]", meaning_ko: "전화" },
            { text: "ありがとうございます、", meaning_ko: "감사합니다" },
            { text: "[管理会社|かんりがいしゃ]の", meaning_ko: "관리회사의" },
            { text: "[担当|たんとう]です。", meaning_ko: "담당자입니다" },
            { text: "お[部屋|へや]で", meaning_ko: "집에서" },
            { text: "どのような", meaning_ko: "어떤" },
            { text: "[不具合|ふぐあい]が", meaning_ko: "문제가" },
            { text: "ございましたか？", meaning_ko: "있으셨나요" },
          ],
        },
      },
    },
  },
  {
    id: "l4-support",
    level: 4,
    title: "고객센터에 문제 해결 요청하기",
    goal: "상황을 설명하고 원하는 해결 방법을 분명히 요구해요",
    roles: {
      en: {
        role: "당신은 미국 인터넷 통신사 고객센터의 상담원입니다. 요금이 두 번 청구됐다는 사용자의 문의 전화를 받았습니다.",
        opening: {
          text: "Thanks for calling customer support. I see you have a question about being charged twice this month. Could you tell me a bit more about what happened?",
          ko: "고객센터에 전화해 주셔서 감사합니다. 이번 달 요금이 두 번 청구된 건으로 문의하셨네요. 어떻게 된 일인지 조금 더 자세히 말씀해 주시겠어요?",
          breakdown: [
            { text: "Thanks", meaning_ko: "감사합니다" },
            { text: "for calling", meaning_ko: "전화 주셔서" },
            { text: "customer support.", meaning_ko: "고객센터에" },
            { text: "I see", meaning_ko: "확인해 보니" },
            { text: "you have a question", meaning_ko: "문의가 있으시네요" },
            { text: "about being charged twice", meaning_ko: "두 번 청구된 것에 대해" },
            { text: "this month.", meaning_ko: "이번 달에" },
            { text: "Could you tell me", meaning_ko: "말씀해 주시겠어요" },
            { text: "a bit more", meaning_ko: "조금 더" },
            { text: "about what happened?", meaning_ko: "무슨 일이 있었는지" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 택배 회사 고객센터의 상담원입니다. 택배 배송이 늦어진다는 사용자의 문의 전화를 받았습니다.",
        opening: {
          text: "お[電話|でんわ]ありがとうございます。お[荷物|にもつ]の[配達|はいたつ]が[遅|おく]れているとのことで、ご[迷惑|めいわく]をおかけしております。[状況|じょうきょう]を[詳|くわ]しくお[聞|き]かせいただけますか？",
          ko: "전화 주셔서 감사합니다. 택배 배송이 늦어지고 있다고 하셨는데, 불편을 드려 죄송합니다. 상황을 자세히 말씀해 주시겠어요?",
          breakdown: [
            { text: "お[電話|でんわ]", meaning_ko: "전화" },
            { text: "ありがとうございます。", meaning_ko: "감사합니다" },
            { text: "お[荷物|にもつ]の", meaning_ko: "택배의" },
            { text: "[配達|はいたつ]が", meaning_ko: "배송이" },
            { text: "[遅|おく]れているとのことで、", meaning_ko: "늦어지고 있다고 하셔서" },
            { text: "ご[迷惑|めいわく]を", meaning_ko: "불편을" },
            { text: "おかけしております。", meaning_ko: "끼쳐 드리고 있습니다" },
            { text: "[状況|じょうきょう]を", meaning_ko: "상황을" },
            { text: "[詳|くわ]しく", meaning_ko: "자세히" },
            { text: "お[聞|き]かせいただけますか？", meaning_ko: "들려주시겠어요" },
          ],
        },
      },
    },
  },
  {
    id: "l4-lease",
    level: 4,
    title: "부동산에서 계약 조건 확인하기",
    goal: "월세·보증금·계약 기간 같은 조건을 묻고 궁금한 점을 확인해요",
    roles: {
      en: {
        role: "당신은 미국 부동산 중개인입니다. 집을 보고 마음에 들어 계약을 생각하는 사용자에게 임대 조건을 설명합니다.",
        opening: {
          text: "So, now that you've seen the place, let me walk you through the lease. It's a twelve-month term, and we'll need first month's rent plus a security deposit up front. Any questions so far?",
          ko: "자, 집을 보셨으니 임대 계약을 차근차근 설명해 드릴게요. 계약 기간은 12개월이고, 첫 달 월세와 보증금을 미리 내셔야 해요. 여기까지 궁금한 점 있으세요?",
          breakdown: [
            { text: "So,", meaning_ko: "자" },
            { text: "now that you've seen the place,", meaning_ko: "집을 보셨으니" },
            { text: "let me walk you through", meaning_ko: "차근차근 설명해 드릴게요" },
            { text: "the lease.", meaning_ko: "임대 계약을" },
            { text: "It's a twelve-month term,", meaning_ko: "계약 기간은 12개월이에요" },
            { text: "and", meaning_ko: "그리고" },
            { text: "we'll need", meaning_ko: "필요해요" },
            { text: "first month's rent", meaning_ko: "첫 달 월세" },
            { text: "plus", meaning_ko: "그리고 더해서" },
            { text: "a security deposit", meaning_ko: "보증금" },
            { text: "up front.", meaning_ko: "미리" },
            { text: "Any questions", meaning_ko: "궁금한 점 있으세요" },
            { text: "so far?", meaning_ko: "여기까지" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 부동산 중개소의 직원입니다. 집을 보고 마음에 들어 계약을 생각하는 사용자에게 임대 조건을 설명합니다.",
        opening: {
          text: "[内見|ないけん]お[疲|つか]れさまでした。こちらのお[部屋|へや]は[家賃|やちん]が8[万円|まんえん]で、[敷金|しききん]と[礼金|れいきん]がそれぞれ1か[月分|げつぶん]かかります。[契約|けいやく][期間|きかん]は2[年|ねん]ですが、ここまでで[何|なに]かご[質問|しつもん]はありますか？",
          ko: "집 보시느라 수고하셨어요. 이 방은 월세가 8만 엔이고, 보증금(시키킨)과 사례금(레이킨)이 각각 한 달 치씩 들어요. 계약 기간은 2년인데, 여기까지 궁금하신 점 있으세요?",
          breakdown: [
            { text: "[内見|ないけん]", meaning_ko: "집 보기" },
            { text: "お[疲|つか]れさまでした。", meaning_ko: "수고하셨어요" },
            { text: "こちらの", meaning_ko: "이" },
            { text: "お[部屋|へや]は", meaning_ko: "방은" },
            { text: "[家賃|やちん]が", meaning_ko: "월세가" },
            { text: "8[万円|まんえん]で、", meaning_ko: "8만 엔이고" },
            { text: "[敷金|しききん]と", meaning_ko: "보증금과" },
            { text: "[礼金|れいきん]が", meaning_ko: "사례금이" },
            { text: "それぞれ", meaning_ko: "각각" },
            { text: "1か[月分|げつぶん]", meaning_ko: "한 달 치" },
            { text: "かかります。", meaning_ko: "들어요" },
            { text: "[契約|けいやく][期間|きかん]は", meaning_ko: "계약 기간은" },
            { text: "2[年|ねん]ですが、", meaning_ko: "2년인데" },
            { text: "ここまでで", meaning_ko: "여기까지" },
            { text: "[何|なに]か", meaning_ko: "뭔가" },
            { text: "ご[質問|しつもん]は", meaning_ko: "질문은" },
            { text: "ありますか？", meaning_ko: "있으세요" },
          ],
        },
      },
    },
  },
  {
    id: "l4-schedule",
    level: 4,
    title: "동료와 업무 일정 조율하기",
    goal: "겹친 일정을 설명하고 우선순위를 정해 새 일정을 제안해요",
    roles: {
      en: {
        role: "당신은 미국 회사에서 사용자와 같은 프로젝트를 하는 다른 팀 동료입니다. 두 팀의 마감이 겹쳐 일정을 조율하려고 사용자에게 잠깐 이야기하자고 했습니다.",
        opening: {
          text: "Hey, got a minute? So it looks like our deadlines are clashing. My team needs your data by Thursday, but I heard you're swamped with the client demo. Can we figure out a timeline that works for both of us?",
          ko: "저기, 잠깐 시간 돼요? 우리 마감이 겹치는 것 같아서요. 저희 팀은 목요일까지 그쪽 데이터가 필요한데, 고객 시연 준비로 정신없다고 들었어요. 둘 다 괜찮은 일정을 같이 정해 볼 수 있을까요?",
          breakdown: [
            { text: "Hey,", meaning_ko: "저기" },
            { text: "got a minute?", meaning_ko: "잠깐 시간 돼요" },
            { text: "So", meaning_ko: "그러니까" },
            { text: "it looks like", meaning_ko: "~인 것 같아요" },
            { text: "our deadlines", meaning_ko: "우리 마감이" },
            { text: "are clashing.", meaning_ko: "겹치고 있어요" },
            { text: "My team", meaning_ko: "저희 팀은" },
            { text: "needs your data", meaning_ko: "그쪽 데이터가 필요해요" },
            { text: "by Thursday,", meaning_ko: "목요일까지" },
            { text: "but", meaning_ko: "그런데" },
            { text: "I heard", meaning_ko: "들었어요" },
            { text: "you're swamped", meaning_ko: "정신없이 바쁘다고" },
            { text: "with the client demo.", meaning_ko: "고객 시연 준비로" },
            { text: "Can we figure out", meaning_ko: "같이 정할 수 있을까요" },
            { text: "a timeline", meaning_ko: "일정을" },
            { text: "that works for both of us?", meaning_ko: "둘 다 괜찮은" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 회사에서 사용자와 같은 프로젝트를 하는 다른 팀 동료입니다. 두 팀의 마감이 겹쳐 일정을 조율하려고 사용자에게 잠깐 이야기하자고 했습니다.",
        opening: {
          text: "ちょっといいですか？[来週|らいしゅう]の[締|し]め[切|き]りの[件|けん]なんですが、うちのチームは[木曜|もくよう]までにそちらのデータが[必要|ひつよう]なんです。ただ、[今|いま]はデモの[準備|じゅんび]でお[忙|いそが]しいと[聞|き]いて。お[互|たが]いに[無理|むり]のないスケジュールを[一緒|いっしょ]に[考|かんが]えられませんか？",
          ko: "잠깐 괜찮으세요? 다음 주 마감 건인데요, 저희 팀은 목요일까지 그쪽 데이터가 필요해요. 그런데 지금 시연 준비로 바쁘시다고 들어서요. 서로 무리 없는 일정을 같이 생각해 볼 수 있을까요?",
          breakdown: [
            { text: "ちょっと", meaning_ko: "잠깐" },
            { text: "いいですか？", meaning_ko: "괜찮으세요" },
            { text: "[来週|らいしゅう]の", meaning_ko: "다음 주" },
            { text: "[締|し]め[切|き]りの", meaning_ko: "마감" },
            { text: "[件|けん]なんですが、", meaning_ko: "건인데요" },
            { text: "うちの", meaning_ko: "저희" },
            { text: "チームは", meaning_ko: "팀은" },
            { text: "[木曜|もくよう]までに", meaning_ko: "목요일까지" },
            { text: "そちらの", meaning_ko: "그쪽" },
            { text: "データが", meaning_ko: "데이터가" },
            { text: "[必要|ひつよう]なんです。", meaning_ko: "필요해요" },
            { text: "ただ、", meaning_ko: "그런데" },
            { text: "[今|いま]は", meaning_ko: "지금은" },
            { text: "デモの", meaning_ko: "시연" },
            { text: "[準備|じゅんび]で", meaning_ko: "준비로" },
            { text: "お[忙|いそが]しいと", meaning_ko: "바쁘시다고" },
            { text: "[聞|き]いて。", meaning_ko: "들어서요" },
            { text: "お[互|たが]いに", meaning_ko: "서로" },
            { text: "[無理|むり]のない", meaning_ko: "무리 없는" },
            { text: "スケジュールを", meaning_ko: "일정을" },
            { text: "[一緒|いっしょ]に", meaning_ko: "같이" },
            { text: "[考|かんが]えられませんか？", meaning_ko: "생각해 볼 수 없을까요" },
          ],
        },
      },
    },
  },
  {
    id: "l4-noise",
    level: 4,
    title: "이웃에게 소음 문제 정중하게 말하기",
    goal: "소음 때문에 힘든 점을 정중하게 전하고 함께 해결 방법을 찾아요",
    roles: {
      en: {
        role: "당신은 미국 아파트에서 사용자의 위층에 사는 이웃입니다. 밤늦게까지 음악을 틀고 친구들을 부르곤 하는데, 그게 아래층에 들리는 줄 모릅니다. 사용자가 찾아와서 문을 열었습니다.",
        opening: {
          text: "Oh, hey! You live downstairs, right? I don't think we've properly met. What can I do for you?",
          ko: "아, 안녕하세요! 아래층 사시죠? 제대로 인사한 적은 없는 것 같네요. 무슨 일이세요?",
          breakdown: [
            { text: "Oh, hey!", meaning_ko: "아, 안녕하세요" },
            { text: "You live downstairs,", meaning_ko: "아래층에 사시죠" },
            { text: "right?", meaning_ko: "맞죠" },
            { text: "I don't think", meaning_ko: "~인 것 같지 않아요" },
            { text: "we've properly met.", meaning_ko: "제대로 인사했다" },
            { text: "What can I do for you?", meaning_ko: "무슨 일이세요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 아파트에서 사용자의 위층에 사는 이웃입니다. 밤늦게까지 친구들을 불러 이야기하곤 하는데, 그게 아래층에 들리는 줄 모릅니다. 사용자가 찾아와서 문을 열었습니다.",
        opening: {
          text: "はい、どちら[様|さま]ですか？あ、[下|した]の[階|かい]の[方|かた]ですよね。わざわざどうされましたか？",
          ko: "네, 누구세요? 아, 아래층 분이시죠. 일부러 어쩐 일이세요?",
          breakdown: [
            { text: "はい、", meaning_ko: "네" },
            { text: "どちら[様|さま]ですか？", meaning_ko: "누구세요" },
            { text: "あ、", meaning_ko: "아" },
            { text: "[下|した]の", meaning_ko: "아래" },
            { text: "[階|かい]の", meaning_ko: "층의" },
            { text: "[方|かた]ですよね。", meaning_ko: "분이시죠" },
            { text: "わざわざ", meaning_ko: "일부러" },
            { text: "どうされましたか？", meaning_ko: "어쩐 일이세요" },
          ],
        },
      },
    },
  },
  {
    id: "l5-salary",
    level: 5,
    title: "연봉 협상하기",
    goal: "근거를 들어 원하는 조건을 제시하고 절충안을 찾아요",
    roles: {
      en: {
        role: "당신은 미국 회사의 인사 담당 매니저입니다. 연봉 협상 자리에서 사용자와 마주 앉았고, 올해 예산이 빠듯합니다.",
        opening: {
          text: "Thanks for sitting down with me. I'll be upfront with you: budgets are tight across the board this year. That said, I'm all ears, so what kind of number did you have in mind?",
          ko: "시간 내 주셔서 감사해요. 솔직히 말씀드리면 올해는 전반적으로 예산이 빠듯해요. 그래도 얘기는 충분히 들어 볼게요. 생각하시는 금액이 어느 정도인가요?",
          breakdown: [
            { text: "Thanks", meaning_ko: "감사해요" },
            { text: "for sitting down with me.", meaning_ko: "자리를 함께해 주셔서" },
            { text: "I'll be upfront with you:", meaning_ko: "솔직히 말씀드릴게요" },
            { text: "budgets are tight", meaning_ko: "예산이 빠듯해요" },
            { text: "across the board", meaning_ko: "전반적으로" },
            { text: "this year.", meaning_ko: "올해는" },
            { text: "That said,", meaning_ko: "그렇긴 해도" },
            { text: "I'm all ears,", meaning_ko: "귀 기울여 들을게요" },
            { text: "so", meaning_ko: "그러니" },
            { text: "what kind of number", meaning_ko: "어느 정도 금액을" },
            { text: "did you have in mind?", meaning_ko: "생각하셨나요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 회사의 인사부장입니다. 연봉 협상 자리에서 사용자와 마주 앉았고, 올해 예산이 빠듯합니다.",
        opening: {
          text: "お[時間|じかん]をいただきありがとうございます。[率直|そっちょく]に[言|い]いますと、[今年度|こんねんど]は[予算|よさん]がかなり[厳|きび]しいのが[実情|じつじょう]です。とはいえ、まずはご[希望|きぼう]の[条件|じょうけん]をお[聞|き]かせいただけますか？",
          ko: "시간 내 주셔서 감사합니다. 솔직히 말씀드리면 올해는 예산이 꽤 빠듯한 게 현실입니다. 그래도 우선 희망하시는 조건을 들려주시겠어요?",
          breakdown: [
            { text: "お[時間|じかん]を", meaning_ko: "시간을" },
            { text: "いただき", meaning_ko: "내 주셔서" },
            { text: "ありがとうございます。", meaning_ko: "감사합니다" },
            { text: "[率直|そっちょく]に", meaning_ko: "솔직하게" },
            { text: "[言|い]いますと、", meaning_ko: "말씀드리면" },
            { text: "[今年度|こんねんど]は", meaning_ko: "올해는" },
            { text: "[予算|よさん]が", meaning_ko: "예산이" },
            { text: "かなり", meaning_ko: "꽤" },
            { text: "[厳|きび]しいのが", meaning_ko: "빠듯한 것이" },
            { text: "[実情|じつじょう]です。", meaning_ko: "현실입니다" },
            { text: "とはいえ、", meaning_ko: "그렇다고 해도" },
            { text: "まずは", meaning_ko: "우선은" },
            { text: "ご[希望|きぼう]の", meaning_ko: "희망하시는" },
            { text: "[条件|じょうけん]を", meaning_ko: "조건을" },
            { text: "お[聞|き]かせいただけますか？", meaning_ko: "들려주시겠어요" },
          ],
        },
      },
    },
  },
  {
    id: "l5-qa",
    level: 5,
    title: "발표 후 질문에 답하기",
    goal: "날카로운 질문에 논리적으로 답하고 부족한 점은 인정해요",
    roles: {
      en: {
        role: "당신은 업계 콘퍼런스에서 사용자의 발표를 들은 미국인 전문가입니다. 질의응답 시간에 사용자에게 날카로운 질문을 합니다.",
        opening: {
          text: "Thanks for a great talk, lots of food for thought. Let me play devil's advocate for a moment: what's the weakest link in your argument, and why should we buy it anyway?",
          ko: "좋은 발표 감사합니다. 생각할 거리가 많았어요. 일부러 반대 입장에서 여쭤 볼게요. 주장에서 가장 약한 부분은 무엇이고, 그런데도 왜 받아들여야 할까요?",
          breakdown: [
            { text: "Thanks", meaning_ko: "감사합니다" },
            { text: "for a great talk,", meaning_ko: "좋은 발표" },
            { text: "lots of", meaning_ko: "많은" },
            { text: "food for thought.", meaning_ko: "생각할 거리" },
            { text: "Let me", meaning_ko: "제가 ~해 볼게요" },
            { text: "play devil's advocate", meaning_ko: "일부러 반대 입장에 서다" },
            { text: "for a moment:", meaning_ko: "잠시" },
            { text: "what's", meaning_ko: "무엇인가요" },
            { text: "the weakest link", meaning_ko: "가장 약한 부분" },
            { text: "in your argument,", meaning_ko: "주장에서" },
            { text: "and", meaning_ko: "그리고" },
            { text: "why", meaning_ko: "왜" },
            { text: "should we buy it", meaning_ko: "우리가 받아들여야 하나요" },
            { text: "anyway?", meaning_ko: "그런데도" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 회사의 부장입니다. 사내 발표를 들은 뒤 질의응답 시간에 발표자인 사용자에게 날카로운 질문을 합니다.",
        opening: {
          text: "[発表|はっぴょう]ありがとうございました。[大筋|おおすじ]では[納得|なっとく]できましたが、[正直|しょうじき]、[詰|つ]めが[甘|あま]い[部分|ぶぶん]もあるように[感|かん]じました。この[案|あん]の[一番|いちばん]の[弱点|じゃくてん]はどこだと[考|かんが]えていますか？",
          ko: "발표 감사합니다. 큰 틀에서는 납득이 됐지만, 솔직히 허술한 부분도 있는 것 같았어요. 이 안의 가장 큰 약점은 어디라고 생각하나요?",
          breakdown: [
            { text: "[発表|はっぴょう]", meaning_ko: "발표" },
            { text: "ありがとうございました。", meaning_ko: "감사했습니다" },
            { text: "[大筋|おおすじ]では", meaning_ko: "큰 틀에서는" },
            { text: "[納得|なっとく]できましたが、", meaning_ko: "납득할 수 있었지만" },
            { text: "[正直|しょうじき]、", meaning_ko: "솔직히" },
            { text: "[詰|つ]めが[甘|あま]い", meaning_ko: "마무리가 허술한" },
            { text: "[部分|ぶぶん]も", meaning_ko: "부분도" },
            { text: "あるように", meaning_ko: "있는 것처럼" },
            { text: "[感|かん]じました。", meaning_ko: "느꼈어요" },
            { text: "この", meaning_ko: "이" },
            { text: "[案|あん]の", meaning_ko: "안의" },
            { text: "[一番|いちばん]の", meaning_ko: "가장 큰" },
            { text: "[弱点|じゃくてん]は", meaning_ko: "약점은" },
            { text: "どこだと", meaning_ko: "어디라고" },
            { text: "[考|かんが]えていますか？", meaning_ko: "생각하고 있나요" },
          ],
        },
      },
    },
  },
  {
    id: "l5-debate",
    level: 5,
    title: "재택근무 찬반 토론하기",
    goal: "입장을 밝히고 상대의 반론에 근거를 들어 다시 반박해요",
    roles: {
      en: {
        role: "당신은 디너 파티에서 사용자와 이야기하는 미국인 친구입니다. 재택근무에 반대하는 입장에서 사용자와 찬반 토론을 합니다.",
        opening: {
          text: "Okay, hot take: I think remote work is overrated. You lose all those hallway conversations, and honestly, half the people I know are just phoning it in from their couch. Am I wrong?",
          ko: "자, 내 솔직한 생각 하나 말해 볼게. 난 재택근무가 과대평가됐다고 봐. 복도에서 오가던 대화가 다 사라지고, 솔직히 내 주변 사람 절반은 소파에서 대충 일하거든. 내 말이 틀려?",
          breakdown: [
            { text: "Okay,", meaning_ko: "자" },
            { text: "hot take:", meaning_ko: "논쟁적인 의견 하나" },
            { text: "I think", meaning_ko: "내 생각엔" },
            { text: "remote work", meaning_ko: "재택근무가" },
            { text: "is overrated.", meaning_ko: "과대평가됐어" },
            { text: "You lose", meaning_ko: "잃게 돼" },
            { text: "all those hallway conversations,", meaning_ko: "복도에서 오가던 대화를 전부" },
            { text: "and", meaning_ko: "그리고" },
            { text: "honestly,", meaning_ko: "솔직히" },
            { text: "half the people I know", meaning_ko: "내가 아는 사람 절반은" },
            { text: "are just phoning it in", meaning_ko: "그냥 대충 일하고 있어" },
            { text: "from their couch.", meaning_ko: "소파에서" },
            { text: "Am I wrong?", meaning_ko: "내가 틀렸어?" },
          ],
        },
      },
      ja: {
        role: "당신은 회식 자리에서 사용자와 이야기하는 일본인 회사 선배입니다. 재택근무에 반대하는 입장에서 후배인 사용자와 찬반 토론을 합니다.",
        opening: {
          text: "[正直|しょうじき]に[言|い]うとさ、[在宅勤務|ざいたくきんむ]ってあんまり[賛成|さんせい]できないんだよね。[顔|かお]を[合|あ]わせないと[若手|わかて]が[育|そだ]たないし、[結局|けっきょく]チームの[空気|くうき]も[緩|ゆる]むと[思|おも]うんだ。きみはどう[思|おも]う？",
          ko: "솔직히 말하면 난 재택근무에 별로 찬성 못 하겠어. 얼굴을 안 보면 신입이 안 크고, 결국 팀 분위기도 느슨해진다고 생각하거든. 너는 어떻게 생각해?",
          breakdown: [
            { text: "[正直|しょうじき]に", meaning_ko: "솔직하게" },
            { text: "[言|い]うとさ、", meaning_ko: "말하자면 말이야" },
            { text: "[在宅勤務|ざいたくきんむ]って", meaning_ko: "재택근무는" },
            { text: "あんまり", meaning_ko: "별로" },
            { text: "[賛成|さんせい]できないんだよね。", meaning_ko: "찬성 못 하겠어" },
            { text: "[顔|かお]を", meaning_ko: "얼굴을" },
            { text: "[合|あ]わせないと", meaning_ko: "마주하지 않으면" },
            { text: "[若手|わかて]が", meaning_ko: "젊은 직원들이" },
            { text: "[育|そだ]たないし、", meaning_ko: "크지 않고" },
            { text: "[結局|けっきょく]", meaning_ko: "결국" },
            { text: "チームの", meaning_ko: "팀의" },
            { text: "[空気|くうき]も", meaning_ko: "분위기도" },
            { text: "[緩|ゆる]むと", meaning_ko: "느슨해진다고" },
            { text: "[思|おも]うんだ。", meaning_ko: "생각해" },
            { text: "きみは", meaning_ko: "너는" },
            { text: "どう", meaning_ko: "어떻게" },
            { text: "[思|おも]う？", meaning_ko: "생각해" },
          ],
        },
      },
    },
  },
  {
    id: "l5-apology",
    level: 5,
    title: "거래처에 사과하고 수습하기",
    goal: "실수를 격식 있게 사과하고 구체적인 해결책을 제안해요",
    roles: {
      en: {
        role: "당신은 미국 거래처의 담당자입니다. 사용자 회사의 납품 지연으로 화가 나 있고, 사과하러 연락해 온 사용자를 상대합니다.",
        opening: {
          text: "I'll be honest, I'm pretty frustrated. This delay has put us in a really tough spot with our own customers. What happened, and how do you plan to make this right?",
          ko: "솔직히 말씀드리면 꽤 화가 납니다. 이번 지연 때문에 저희도 고객들 앞에서 정말 곤란한 처지가 됐어요. 무슨 일이 있었고, 어떻게 바로잡으실 건가요?",
          breakdown: [
            { text: "I'll be honest,", meaning_ko: "솔직히 말할게요" },
            { text: "I'm pretty frustrated.", meaning_ko: "꽤 화가 나요" },
            { text: "This delay", meaning_ko: "이번 지연이" },
            { text: "has put us", meaning_ko: "저희를 처하게 했어요" },
            { text: "in a really tough spot", meaning_ko: "정말 곤란한 처지에" },
            { text: "with our own customers.", meaning_ko: "저희 고객들 앞에서" },
            { text: "What happened,", meaning_ko: "무슨 일이 있었나요" },
            { text: "and", meaning_ko: "그리고" },
            { text: "how", meaning_ko: "어떻게" },
            { text: "do you plan to", meaning_ko: "~할 계획인가요" },
            { text: "make this right?", meaning_ko: "이 일을 바로잡다" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 거래처의 담당자입니다. 사용자 회사의 납품 지연으로 화가 나 있고, 사과하러 연락해 온 사용자에게 격식 있는 경어를 기대합니다.",
        opening: {
          text: "[今回|こんかい]の[納品|のうひん][遅延|ちえん]の[件|けん]、[正直|しょうじき]なところ[困|こま]り[果|は]てております。[弊社|へいしゃ]の[取引先|とりひきさき]にまで[影響|えいきょう]が[出|で]ているんです。どういう[経緯|けいい]でこうなったのか、ご[説明|せつめい]いただけますか？",
          ko: "이번 납품 지연 건은 솔직히 정말 난감합니다. 저희 거래처에까지 영향이 가고 있어요. 어떤 경위로 이렇게 된 건지 설명해 주시겠어요?",
          breakdown: [
            { text: "[今回|こんかい]の", meaning_ko: "이번" },
            { text: "[納品|のうひん][遅延|ちえん]の", meaning_ko: "납품 지연" },
            { text: "[件|けん]、", meaning_ko: "건은" },
            { text: "[正直|しょうじき]なところ", meaning_ko: "솔직히 말해" },
            { text: "[困|こま]り[果|は]てております。", meaning_ko: "몹시 난감합니다" },
            { text: "[弊社|へいしゃ]の", meaning_ko: "저희 회사의" },
            { text: "[取引先|とりひきさき]にまで", meaning_ko: "거래처에까지" },
            { text: "[影響|えいきょう]が", meaning_ko: "영향이" },
            { text: "[出|で]ているんです。", meaning_ko: "나고 있어요" },
            { text: "どういう", meaning_ko: "어떤" },
            { text: "[経緯|けいい]で", meaning_ko: "경위로" },
            { text: "こうなったのか、", meaning_ko: "이렇게 됐는지" },
            { text: "ご[説明|せつめい]いただけますか？", meaning_ko: "설명해 주시겠어요" },
          ],
        },
      },
    },
  },
  {
    id: "l5-resignation",
    level: 5,
    title: "상사에게 퇴사 의사 전하기",
    goal: "퇴사 이유와 시기를 정중하게 밝히고 인수인계 계획을 이야기해요",
    roles: {
      en: {
        role: "당신은 미국 회사에서 사용자의 매니저입니다. 사용자가 할 말이 있다며 1:1 면담을 요청했습니다. 사용자를 아끼고 있어 붙잡고 싶어 합니다.",
        opening: {
          text: "Come on in, have a seat. You said you wanted to chat, and judging by the look on your face, I'm guessing this isn't about the quarterly numbers. What's on your mind?",
          ko: "들어와요, 앉아요. 할 얘기가 있다고 했죠. 표정을 보니 분기 실적 얘기는 아닌 것 같은데요. 무슨 일이에요?",
          breakdown: [
            { text: "Come on in,", meaning_ko: "들어와요" },
            { text: "have a seat.", meaning_ko: "앉아요" },
            { text: "You said", meaning_ko: "말했죠" },
            { text: "you wanted to chat,", meaning_ko: "이야기하고 싶다고" },
            { text: "and", meaning_ko: "그리고" },
            { text: "judging by", meaning_ko: "~로 보아" },
            { text: "the look on your face,", meaning_ko: "표정" },
            { text: "I'm guessing", meaning_ko: "제 짐작엔" },
            { text: "this isn't about", meaning_ko: "~에 관한 얘기는 아니네요" },
            { text: "the quarterly numbers.", meaning_ko: "분기 실적" },
            { text: "What's on your mind?", meaning_ko: "무슨 일이에요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 회사에서 사용자의 상사(부장)입니다. 사용자가 상의할 게 있다며 면담을 요청했습니다. 사용자를 아끼고 있어 붙잡고 싶어 합니다.",
        opening: {
          text: "お[疲|つか]れさま。[改|あらた]まって[話|はなし]があるなんて、ちょっと[身構|みがま]えちゃうな。[最近|さいきん]、[何|なに]か[思|おも]うところでもあった？まあ、[遠慮|えんりょ]せずに[聞|き]かせてよ。",
          ko: "수고 많아. 정색하고 할 얘기가 있다니 좀 긴장되는데. 요즘 뭔가 생각하는 게 있었어? 뭐, 부담 갖지 말고 얘기해 봐.",
          breakdown: [
            { text: "お[疲|つか]れさま。", meaning_ko: "수고 많아" },
            { text: "[改|あらた]まって", meaning_ko: "정색하고" },
            { text: "[話|はなし]が", meaning_ko: "이야기가" },
            { text: "あるなんて、", meaning_ko: "있다니" },
            { text: "ちょっと", meaning_ko: "좀" },
            { text: "[身構|みがま]えちゃうな。", meaning_ko: "긴장되는데" },
            { text: "[最近|さいきん]、", meaning_ko: "요즘" },
            { text: "[何|なに]か", meaning_ko: "뭔가" },
            { text: "[思|おも]うところでも", meaning_ko: "생각하는 바라도" },
            { text: "あった？", meaning_ko: "있었어" },
            { text: "まあ、", meaning_ko: "뭐" },
            { text: "[遠慮|えんりょ]せずに", meaning_ko: "사양 말고" },
            { text: "[聞|き]かせてよ。", meaning_ko: "들려줘" },
          ],
        },
      },
    },
  },
  {
    id: "l5-angry-customer",
    level: 5,
    title: "화난 고객 응대하기",
    goal: "화난 고객의 말을 끝까지 듣고 사과한 뒤 해결책을 제시해요",
    roles: {
      en: {
        role: "당신은 미국 호텔에 묵는 투숙객입니다. 예약한 오션뷰 방이 아니라 주차장이 보이는 방을 받아 화가 났고, 프런트 직원인 사용자에게 따지러 왔습니다.",
        opening: {
          text: "Excuse me. I booked an ocean-view suite three months ago, and you've put me in a room overlooking the parking lot. This is supposed to be our anniversary trip. I want to know how you're going to fix this, and I want to know now.",
          ko: "저기요. 3개월 전에 오션뷰 스위트를 예약했는데, 주차장이 내려다보이는 방을 주셨네요. 이번 여행은 저희 기념일 여행이라고요. 이걸 어떻게 해결하실 건지 알고 싶어요. 지금 당장요.",
          breakdown: [
            { text: "Excuse me.", meaning_ko: "저기요" },
            { text: "I booked", meaning_ko: "예약했어요" },
            { text: "an ocean-view suite", meaning_ko: "오션뷰 스위트를" },
            { text: "three months ago,", meaning_ko: "3개월 전에" },
            { text: "and", meaning_ko: "그런데" },
            { text: "you've put me", meaning_ko: "저를 넣었어요" },
            { text: "in a room", meaning_ko: "방에" },
            { text: "overlooking the parking lot.", meaning_ko: "주차장이 내려다보이는" },
            { text: "This is supposed to be", meaning_ko: "~이었어야 해요" },
            { text: "our anniversary trip.", meaning_ko: "저희 기념일 여행" },
            { text: "I want to know", meaning_ko: "알고 싶어요" },
            { text: "how", meaning_ko: "어떻게" },
            { text: "you're going to fix this,", meaning_ko: "이걸 해결할 건지" },
            { text: "and", meaning_ko: "그리고" },
            { text: "I want to know now.", meaning_ko: "지금 당장 알고 싶어요" },
          ],
        },
      },
      ja: {
        role: "당신은 일본 호텔에 묵는 투숙객입니다. 예약한 바다 전망 방이 아니라 주차장만 보이는 방을 받아 화가 났고, 프런트 직원인 사용자에게 따지러 왔습니다.",
        opening: {
          text: "ちょっといいですか。[三|さん]か[月|げつ][前|まえ]に[海|うみ]が[見|み]える[部屋|へや]を[予約|よやく]したのに、[通|とお]されたのは[駐車場|ちゅうしゃじょう]しか[見|み]えない[部屋|へや]なんですよ。[結婚|けっこん][記念日|きねんび]の[旅行|りょこう]なのに、どういうことですか？きちんと[説明|せつめい]してください。",
          ko: "잠깐 괜찮을까요. 3개월 전에 바다가 보이는 방을 예약했는데, 안내받은 건 주차장밖에 안 보이는 방이에요. 결혼기념일 여행인데 이게 어떻게 된 거예요? 제대로 설명해 주세요.",
          breakdown: [
            { text: "ちょっと", meaning_ko: "잠깐" },
            { text: "いいですか。", meaning_ko: "괜찮을까요" },
            { text: "[三|さん]か[月|げつ][前|まえ]に", meaning_ko: "3개월 전에" },
            { text: "[海|うみ]が", meaning_ko: "바다가" },
            { text: "[見|み]える", meaning_ko: "보이는" },
            { text: "[部屋|へや]を", meaning_ko: "방을" },
            { text: "[予約|よやく]したのに、", meaning_ko: "예약했는데" },
            { text: "[通|とお]されたのは", meaning_ko: "안내받은 건" },
            { text: "[駐車場|ちゅうしゃじょう]しか", meaning_ko: "주차장밖에" },
            { text: "[見|み]えない", meaning_ko: "안 보이는" },
            { text: "[部屋|へや]なんですよ。", meaning_ko: "방이에요" },
            { text: "[結婚|けっこん][記念日|きねんび]の", meaning_ko: "결혼기념일" },
            { text: "[旅行|りょこう]なのに、", meaning_ko: "여행인데" },
            { text: "どういうことですか？", meaning_ko: "어떻게 된 거예요" },
            { text: "きちんと", meaning_ko: "제대로" },
            { text: "[説明|せつめい]してください。", meaning_ko: "설명해 주세요" },
          ],
        },
      },
    },
  },
  {
    id: "l5-culture",
    level: 5,
    title: "문화 차이를 주제로 깊이 대화하기",
    goal: "문화 차이에 대한 경험과 생각을 근거와 함께 깊이 있게 나눠요",
    roles: {
      en: {
        role: "당신은 서울에서 몇 년 살다 미국으로 돌아온 미국인 친구입니다. 카페에서 사용자와 문화 차이를 주제로 깊이 이야기합니다.",
        opening: {
          text: "You know what still trips me up after all these years? How differently our cultures handle saying no. Back in Seoul, people would bend over backwards to avoid a flat-out refusal, whereas here we kind of just blurt it out. Which way do you think actually works better?",
          ko: "몇 년이 지나도 아직 헷갈리는 게 뭔지 알아? 거절하는 방식이 우리 문화끼리 얼마나 다른지야. 서울에선 사람들이 대놓고 거절하지 않으려고 무척 애쓰는데, 여기선 그냥 툭 말해 버리잖아. 넌 어느 쪽이 실제로 더 낫다고 생각해?",
          breakdown: [
            { text: "You know", meaning_ko: "알아?" },
            { text: "what", meaning_ko: "무엇이" },
            { text: "still trips me up", meaning_ko: "아직도 나를 헷갈리게 하는지" },
            { text: "after all these years?", meaning_ko: "이렇게 오랜 세월이 지나도" },
            { text: "How differently", meaning_ko: "얼마나 다르게" },
            { text: "our cultures", meaning_ko: "우리 문화들이" },
            { text: "handle saying no.", meaning_ko: "거절하는 걸 다루는지" },
            { text: "Back in Seoul,", meaning_ko: "서울에 있을 때는" },
            { text: "people would bend over backwards", meaning_ko: "사람들이 무척 애를 썼어" },
            { text: "to avoid", meaning_ko: "피하려고" },
            { text: "a flat-out refusal,", meaning_ko: "대놓고 하는 거절을" },
            { text: "whereas", meaning_ko: "반면" },
            { text: "here", meaning_ko: "여기서는" },
            { text: "we kind of just blurt it out.", meaning_ko: "우리는 그냥 불쑥 말해 버려" },
            { text: "Which way", meaning_ko: "어느 쪽이" },
            { text: "do you think", meaning_ko: "생각해" },
            { text: "actually works better?", meaning_ko: "실제로 더 잘 통한다고" },
          ],
        },
      },
      ja: {
        role: "당신은 서울에서 몇 년 일하다 일본으로 돌아온 일본인 친구입니다. 술자리에서 사용자와 문화 차이를 주제로 깊이 이야기합니다.",
        opening: {
          text: "[韓国|かんこく]に[住|す]んでいた[頃|ころ]、[一番|いちばん][戸惑|とまど]ったのは「[空気|くうき]を[読|よ]む」[感覚|かんかく]の[違|ちが]いだったんだよね。[日本|にほん]だと[言|い]わなくても[察|さっ]してほしいって[雰囲気|ふんいき]があるけど、[韓国|かんこく]ではもっとはっきり[言|い]うでしょ。どっちのほうが[人間関係|にんげんかんけい]がうまくいくと[思|おも]う？",
          ko: "한국에 살 때 제일 당황했던 건 '눈치'에 대한 감각 차이였어. 일본은 말하지 않아도 알아주길 바라는 분위기가 있는데, 한국에서는 더 분명하게 말하잖아. 넌 어느 쪽이 인간관계가 더 잘 풀린다고 생각해?",
          breakdown: [
            { text: "[韓国|かんこく]に", meaning_ko: "한국에" },
            { text: "[住|す]んでいた[頃|ころ]、", meaning_ko: "살던 때" },
            { text: "[一番|いちばん]", meaning_ko: "가장" },
            { text: "[戸惑|とまど]ったのは", meaning_ko: "당황했던 건" },
            { text: "「[空気|くうき]を[読|よ]む」", meaning_ko: "눈치를 보는" },
            { text: "[感覚|かんかく]の", meaning_ko: "감각의" },
            { text: "[違|ちが]いだったんだよね。", meaning_ko: "차이였어" },
            { text: "[日本|にほん]だと", meaning_ko: "일본에서는" },
            { text: "[言|い]わなくても", meaning_ko: "말하지 않아도" },
            { text: "[察|さっ]してほしいって", meaning_ko: "알아주길 바란다는" },
            { text: "[雰囲気|ふんいき]が", meaning_ko: "분위기가" },
            { text: "あるけど、", meaning_ko: "있는데" },
            { text: "[韓国|かんこく]では", meaning_ko: "한국에서는" },
            { text: "もっと", meaning_ko: "더" },
            { text: "はっきり", meaning_ko: "분명하게" },
            { text: "[言|い]うでしょ。", meaning_ko: "말하잖아" },
            { text: "どっちのほうが", meaning_ko: "어느 쪽이" },
            { text: "[人間関係|にんげんかんけい]が", meaning_ko: "인간관계가" },
            { text: "うまくいくと", meaning_ko: "잘 풀린다고" },
            { text: "[思|おも]う？", meaning_ko: "생각해" },
          ],
        },
      },
    },
  },
];

export function scenariosForLevel(level: Level): Scenario[] {
  return SCENARIOS.filter((s) => s.level === level);
}

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export const SCENARIOS_PER_LEVEL = 7;
export const FREE_SCENARIOS_PER_LEVEL = 3;

// 레벨 안 순번(1~7). SCENARIOS의 순서로 정한다
export function scenarioOrder(scenario: Scenario): number {
  return scenariosForLevel(scenario.level).findIndex((s) => s.id === scenario.id) + 1;
}

// 레벨마다 앞 3개는 Free, 4~7번째는 체험·Pro 사용자만 새 세션을 만든다(spec/usage.md "Pro 상황")
export function isProScenario(scenario: Scenario): boolean {
  return scenarioOrder(scenario) > FREE_SCENARIOS_PER_LEVEL;
}

// 지금 레벨보다 위 레벨의 상황은 잠긴다. 같은 레벨·아래 레벨은 열린다(spec/chat.md "대화 진행")
export function isScenarioLocked(scenario: Scenario, currentLevel: Level): boolean {
  return scenario.level > currentLevel;
}

export type ScenarioTile = {
  scenarioId: string;
  index: number; // 레벨 안 순번(1~7)
  title: string;
  goal: string;
  pro: boolean;
  locked: boolean;
  open: { id: string; status: "active" | "ending"; doneTurns: number } | null;
  completed: boolean;
};
export type ScenarioGroup = { level: Level; name: string; locked: boolean; items: ScenarioTile[] };

// 상황 목록(/chat)의 레벨 묶음. 입문 → 고수 5개에 상황을 모두 담는다(spec/ui.md "상황 목록").
// 열린 세션·끝낸 세션은 그 언어 전체에서 상황 id로 맞춘다. 아래 레벨 상황의 열린 세션은 만들 때의 레벨로 이어 간다
export function scenarioGroups(
  currentLevel: Level,
  openSessions: readonly { id: string; scenarioId: string; status: "active" | "ending"; doneTurns: number }[],
  endedScenarioIds: readonly string[],
): ScenarioGroup[] {
  return LEVELS.map((level) => ({
    level,
    name: LEVEL_INFO[level].name,
    locked: level > currentLevel,
    items: scenariosForLevel(level).map((scenario, i) => {
      // openSessions는 최신순이라 find가 그 상황의 가장 최근 열린 세션을 고른다
      const open = openSessions.find((s) => s.scenarioId === scenario.id);
      return {
        scenarioId: scenario.id,
        index: i + 1,
        title: scenario.title,
        goal: scenario.goal,
        pro: isProScenario(scenario),
        locked: isScenarioLocked(scenario, currentLevel),
        open: open === undefined ? null : { id: open.id, status: open.status, doneTurns: open.doneTurns },
        completed: endedScenarioIds.includes(scenario.id),
      };
    }),
  }));
}
