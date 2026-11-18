import { z } from "zod";
import { PRE_REVIEW_KINDS } from "./editing";

// 구조화 출력 스키마. 제약(min/max 등)은 모델 출력 단계에서 지원이 제한적이라 모양만 정의하고,
// 값 검증은 editing.ts의 validate/locate 함수가 한다.
export const suggestionSchema = z.object({
  reason: z.string(),
  after: z.string(),
});

export const storyReviewSchema = z.object({
  title: z.string(),
  items: z.array(
    z.object({
      chapterNumber: z.number().int(),
      paragraphNumber: z.number().int(),
      text: z.string(),
    }),
  ),
});

export const preReviewSchema = z.object({
  items: z.array(
    z.object({
      chapterNumber: z.number().int(),
      paragraphNumber: z.number().int(),
      kind: z.enum(PRE_REVIEW_KINDS),
      text: z.string(),
    }),
  ),
});
