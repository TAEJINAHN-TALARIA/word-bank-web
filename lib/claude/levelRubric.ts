// 레벨 기준표의 "어휘·문장구조" 칸 — 문장 다듬기(③) 프롬프트가 그 레벨 독자가 막힐 곳을 가늠하는 기준.
// 출처: docs/superpowers/specs/2026-11-25-level-rubric-draft.md 표(칸마다 추정이 들어 있는 초안).
// 내용 복잡성 칸은 아직 쓰는 곳이 없어 옮기지 않았다.
// "server-only"를 import하지 않으므로 클라이언트에서도 쓴다.
export type LevelRubric = { reader: string; vocabulary: string };

const RUBRICS: Record<string, LevelRubric> = {
  Lv1: {
    reader: "미취학 아동",
    vocabulary:
      "일상 기초 낱말(가족·음식·장소·동작). 고유어 위주. 한 문장에 한 사건. 이어지는 절 1개까지. 비유·관용구 없음. 추상어·한자어 없음.",
  },
  Lv2: {
    reader: "초등 저학년",
    vocabulary: "일상 낱말 + 기본 감정어(기쁘다, 걱정되다). 이어지는 절 2개까지. 꾸미는 말은 한 겹. 비유 없음. 의성의태어는 기초만.",
  },
  Lv3: {
    reader: "초등 고학년",
    vocabulary:
      "학교·사회생활 낱말. 쉬운 한자어(회의, 교통) 허용. 꾸미는 절 1~2겹. 단순한 비유 1~2개 허용. 낱말 풀이가 필요한 전문어는 피한다.",
  },
  Lv4: {
    reader: "중학생",
    vocabulary:
      "일반 추상어 일부(경험, 관계, 책임). 인용·접속 구조 허용. 관용표현은 문맥에서 뜻이 드러나면 허용. 전문어는 처음 나올 때 풀어 쓴다.",
  },
  Lv5: {
    reader: "고등학생",
    vocabulary:
      "추상 개념어(체면, 갈등, 자존심) 허용. 한 문장에 절 3개까지. 꾸미는 절 중첩 2겹. 비유는 문맥에서 뜻을 짐작할 수 있는 것만. 전문어는 풀어 쓴다.",
  },
  Lv6: {
    reader: "대학생·성인 숙련 독자",
    vocabulary:
      "추상어·한자어 폭넓게 허용. 문어체 접속(-으나, -으며) 허용. 절 4개 이하. 꾸미는 절 중첩 3겹까지. 은유는 한 문장에 하나. 전문어도 문맥에서 뜻이 풀려야 한다.",
  },
};

/** "Lv1"~"Lv6"만 기준이 있다. 그 밖의 값은 null. */
export function levelRubric(level: string): LevelRubric | null {
  return Object.hasOwn(RUBRICS, level) ? RUBRICS[level] : null;
}
