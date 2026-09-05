// word-bank/functions/src/langNames.ts와 동기화 유지 (word-bank는 별도 레포라 공유 패키지가 없음)
export const LANG_NAMES: Record<string, string> = {
  en: "English", ko: "Korean", ja: "Japanese", zh: "Chinese",
  fr: "French", de: "German", es: "Spanish", it: "Italian",
  pt: "Portuguese", ar: "Arabic", la: "Latin",
  hi: "Hindi", bn: "Bengali", ru: "Russian", id: "Indonesian",
};

// word-bank/functions/src/expressionPool.ts의 MEANING_LANGUAGE_CODES와 동기화 유지.
// LANG_NAMES와 달리 'it'(이탈리아어)이 빠져 있다 — 뜻 번역이 지원되는 14개 언어만 포함.
export const MEANING_LANGUAGE_CODES = ["ko", "en", "ja", "zh", "de", "fr", "es", "pt", "ar", "la", "hi", "bn", "ru", "id"];
