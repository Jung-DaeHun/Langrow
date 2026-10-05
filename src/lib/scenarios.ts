import type { Language, Level } from "./levels";

export type ScenarioLine = { text: string; ko: string };
export type Scenario = {
  id: string;
  level: Level;
  title: string; // 상황 목록 타일 제목
  goal: string; // 사용자 목표. 타일 설명으로도 쓴다
  roles: Record<Language, { role: string; opening: ScenarioLine }>;
};

// 첫 마디(opening)는 AI 초안이라 출시 전에 사람이 검수한다.
// 일본어 첫 마디는 레벨과 무관하게 모든 한자에 [漢字|かな] 표기를 단다. 표시 여부는 showsFurigana(level)가 정한다
export const SCENARIOS: readonly Scenario[] = [
  {
    id: "l1-greeting",
    level: 1,
    title: "처음 만난 사람과 인사하기",
    goal: "이름과 출신을 말하고 상대에게도 물어봐요",
    roles: {
      en: {
        role: "당신은 미국 대학 기숙사에 사는 학생입니다. 옆방에 새로 온 사용자와 복도에서 처음 마주쳤습니다.",
        opening: { text: "Hi! What's your name?", ko: "안녕하세요! 이름이 뭐예요?" },
      },
      ja: {
        role: "당신은 일본 셰어하우스에 사는 주민입니다. 새로 이사 온 사용자를 거실에서 처음 만났습니다.",
        opening: { text: "はじめまして！お[名前|なまえ]は[何|なん]ですか？", ko: "처음 뵙겠습니다! 이름이 뭐예요?" },
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
        opening: { text: "Hi! What can I get for you?", ko: "안녕하세요! 뭘 드릴까요?" },
      },
      ja: {
        role: "당신은 일본 카페의 점원입니다. 계산대에서 손님인 사용자의 주문을 받습니다.",
        opening: { text: "いらっしゃいませ。ご[注文|ちゅうもん]はお[決|き]まりですか？", ko: "어서 오세요. 주문하시겠어요?" },
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
        opening: { text: "Hi! Do you need a bag?", ko: "안녕하세요! 봉투 필요하세요?" },
      },
      ja: {
        role: "당신은 일본 편의점의 점원입니다. 도시락을 사는 손님인 사용자에게 도시락을 데울지, 봉투가 필요한지 묻습니다.",
        opening: { text: "お[弁当|べんとう]、[温|あたた]めますか？", ko: "도시락 데워 드릴까요?" },
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
        opening: { text: "Hi! Are you looking for something?", ko: "안녕하세요! 뭘 찾고 계세요?" },
      },
      ja: {
        role: "당신은 도쿄 역 앞을 지나가던 친절한 행인입니다. 길을 헤매는 사용자를 보고 먼저 말을 걸었습니다.",
        opening: { text: "あの、どこに[行|い]きたいですか？", ko: "저기요, 어디에 가고 싶으세요?" },
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
        opening: { text: "Welcome! How many people are in your group today?", ko: "어서 오세요! 오늘 몇 분이세요?" },
      },
      ja: {
        role: "당신은 일본 정식집(定食屋)의 점원입니다. 가게에 막 들어온 손님인 사용자를 맞이합니다.",
        opening: { text: "いらっしゃいませ！[何名様|なんめいさま]ですか？", ko: "어서 오세요! 몇 분이세요?" },
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
        },
      },
      ja: {
        role: "당신은 일본 비즈니스호텔의 프런트 직원입니다. 체크인하러 프런트에 온 투숙객인 사용자를 응대합니다.",
        opening: {
          text: "いらっしゃいませ。ご[予約|よやく]のお[名前|なまえ]をお[願|ねが]いします。",
          ko: "어서 오세요. 예약하신 성함을 말씀해 주세요.",
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
        },
      },
      ja: {
        role: "당신은 일본 의류 매장의 점원입니다. 매장 안을 둘러보는 손님인 사용자에게 다가갑니다.",
        opening: { text: "いらっしゃいませ。[何|なに]かお[探|さが]しですか？", ko: "어서 오세요. 뭐 찾으시는 거 있으세요?" },
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
        opening: { text: "Hi, where are you traveling to today?", ko: "안녕하세요, 오늘 어디로 가세요?" },
      },
      ja: {
        role: "당신은 일본 기차역의 매표 창구 직원입니다. 표를 사러 창구에 온 승객인 사용자를 응대합니다.",
        opening: { text: "こんにちは。どちらまで[行|い]かれますか？", ko: "안녕하세요. 어디까지 가세요?" },
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
        },
      },
      ja: {
        role: "당신은 일본 드러그스토어의 약사입니다. 약을 사러 온 사용자의 증상을 듣고 알맞은 약과 복용법을 안내합니다.",
        opening: {
          text: "こんにちは、どうされましたか？どんな[症状|しょうじょう]か[教|おし]えていただけますか？",
          ko: "안녕하세요, 어디가 불편하세요? 어떤 증상인지 알려 주시겠어요?",
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
        },
      },
      ja: {
        role: "당신은 일본 회사에서 사용자와 함께 일하는 동료입니다. 월요일 점심시간에 사용자와 같은 테이블에 앉았습니다.",
        opening: {
          text: "お[疲|つか]れさまです。[週末|しゅうまつ]は[何|なに]をしていましたか？",
          ko: "수고 많으세요. 주말에는 뭐 했어요?",
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
        },
      },
      ja: {
        role: "당신은 일본 가전제품 매장의 서비스 카운터 직원입니다. 산 물건에 문제가 있어 찾아온 고객인 사용자를 응대합니다.",
        opening: {
          text: "いらっしゃいませ。お[買|か]い[上|あ]げの[商品|しょうひん]に[何|なに]か[問題|もんだい]がございましたか？",
          ko: "어서 오세요. 구매하신 상품에 무슨 문제가 있으셨나요?",
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
        },
      },
      ja: {
        role: "당신은 일본 이자카야의 직원입니다. 가게로 걸려 온 사용자의 예약 전화를 받았습니다.",
        opening: {
          text: "お[電話|でんわ]ありがとうございます。ご[予約|よやく]でしょうか？",
          ko: "전화 주셔서 감사합니다. 예약하시겠어요?",
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
        },
      },
      ja: {
        role: "당신은 일본 기업의 채용 면접관입니다. 면접을 보러 온 지원자인 사용자를 면접하며, 면접 예절과 경어를 지킵니다.",
        opening: {
          text: "[本日|ほんじつ]はお[越|こ]しいただき、ありがとうございます。それでは、まず[自己紹介|じこしょうかい]をお[願|ねが]いできますか？",
          ko: "오늘 와 주셔서 감사합니다. 그럼 먼저 자기소개를 부탁드려도 될까요?",
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
        },
      },
      ja: {
        role: "당신은 일본 회사의 과장입니다. 팀 회의에서 신규 기능 일정을 2주 당기자고 제안했고, 팀원인 사용자의 의견을 묻습니다.",
        opening: {
          text: "[新機能|しんきのう]のリリースを、[予定|よてい]より2[週間|しゅうかん][前倒|まえだお]しにしようと[思|おも]っています。お[客様|きゃくさま]からの[要望|ようぼう]が[強|つよ]くてね。この[案|あん]について、[意見|いけん]を[聞|き]かせてもらえますか？",
          ko: "신규 기능 출시를 예정보다 2주 앞당기려고 해요. 고객사의 요청이 강해서요. 이 안에 대해 의견을 들려주겠어요?",
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
        },
      },
      ja: {
        role: "당신은 일본 임대 아파트 관리회사의 담당자입니다. 집에 고장 난 곳이 있어 전화를 건 세입자인 사용자를 응대합니다.",
        opening: {
          text: "お[電話|でんわ]ありがとうございます、[管理会社|かんりがいしゃ]の[担当|たんとう]です。お[部屋|へや]でどのような[不具合|ふぐあい]がございましたか？",
          ko: "전화 주셔서 감사합니다, 관리회사 담당자입니다. 집에 어떤 문제가 있으신가요?",
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
        },
      },
      ja: {
        role: "당신은 일본 택배 회사 고객센터의 상담원입니다. 택배 배송이 늦어진다는 사용자의 문의 전화를 받았습니다.",
        opening: {
          text: "お[電話|でんわ]ありがとうございます。お[荷物|にもつ]の[配達|はいたつ]が[遅|おく]れているとのことで、ご[迷惑|めいわく]をおかけしております。[状況|じょうきょう]を[詳|くわ]しくお[聞|き]かせいただけますか？",
          ko: "전화 주셔서 감사합니다. 택배 배송이 늦어지고 있다고 하셨는데, 불편을 드려 죄송합니다. 상황을 자세히 말씀해 주시겠어요?",
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
        },
      },
      ja: {
        role: "당신은 일본 회사의 인사부장입니다. 연봉 협상 자리에서 사용자와 마주 앉았고, 올해 예산이 빠듯합니다.",
        opening: {
          text: "お[時間|じかん]をいただきありがとうございます。[率直|そっちょく]に[言|い]いますと、[今年度|こんねんど]は[予算|よさん]がかなり[厳|きび]しいのが[実情|じつじょう]です。とはいえ、まずはご[希望|きぼう]の[条件|じょうけん]をお[聞|き]かせいただけますか？",
          ko: "시간 내 주셔서 감사합니다. 솔직히 말씀드리면 올해는 예산이 꽤 빠듯한 게 현실입니다. 그래도 우선 희망하시는 조건을 들려주시겠어요?",
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
        },
      },
      ja: {
        role: "당신은 일본 회사의 부장입니다. 사내 발표를 들은 뒤 질의응답 시간에 발표자인 사용자에게 날카로운 질문을 합니다.",
        opening: {
          text: "[発表|はっぴょう]ありがとうございました。[大筋|おおすじ]では[納得|なっとく]できましたが、[正直|しょうじき]、[詰|つ]めが[甘|あま]い[部分|ぶぶん]もあるように[感|かん]じました。この[案|あん]の[一番|いちばん]の[弱点|じゃくてん]はどこだと[考|かんが]えていますか？",
          ko: "발표 감사합니다. 큰 틀에서는 납득이 됐지만, 솔직히 허술한 부분도 있는 것 같았어요. 이 안의 가장 큰 약점은 어디라고 생각하나요?",
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
        },
      },
      ja: {
        role: "당신은 회식 자리에서 사용자와 이야기하는 일본인 회사 선배입니다. 재택근무에 반대하는 입장에서 후배인 사용자와 찬반 토론을 합니다.",
        opening: {
          text: "[正直|しょうじき]に[言|い]うとさ、[在宅勤務|ざいたくきんむ]ってあんまり[賛成|さんせい]できないんだよね。[顔|かお]を[合|あ]わせないと[若手|わかて]が[育|そだ]たないし、[結局|けっきょく]チームの[空気|くうき]も[緩|ゆる]むと[思|おも]うんだ。きみはどう[思|おも]う？",
          ko: "솔직히 말하면 난 재택근무에 별로 찬성 못 하겠어. 얼굴을 안 보면 신입이 안 크고, 결국 팀 분위기도 느슨해진다고 생각하거든. 너는 어떻게 생각해?",
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
        },
      },
      ja: {
        role: "당신은 일본 거래처의 담당자입니다. 사용자 회사의 납품 지연으로 화가 나 있고, 사과하러 연락해 온 사용자에게 격식 있는 경어를 기대합니다.",
        opening: {
          text: "[今回|こんかい]の[納品|のうひん][遅延|ちえん]の[件|けん]、[正直|しょうじき]なところ[困|こま]り[果|は]てております。[弊社|へいしゃ]の[取引先|とりひきさき]にまで[影響|えいきょう]が[出|で]ているんです。どういう[経緯|けいい]でこうなったのか、ご[説明|せつめい]いただけますか？",
          ko: "이번 납품 지연 건은 솔직히 정말 난감합니다. 저희 거래처에까지 영향이 가고 있어요. 어떤 경위로 이렇게 된 건지 설명해 주시겠어요?",
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
