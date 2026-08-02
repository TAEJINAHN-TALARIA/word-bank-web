# Word Bank 랜딩페이지 다국어화 (한국어/영어) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the landing page (`/`) and privacy policy (`/privacy`) in Korean and English under `/ko` and `/en`, with automatic browser-language redirect at the root and a manual language toggle, using a structure that scales to more languages by adding a locale + JSON file only.

**Architecture:** `next-intl` (App Router, i18n routing mode) provides `defineRouting`/`createNavigation`/`getRequestConfig`. All routes move under `app/[locale]/`. A root `proxy.ts` (this Next.js version renamed `middleware.ts` → `proxy.ts`, see Global Constraints) runs `createMiddleware(routing)` to detect `Accept-Language` and redirect `/` → `/ko` or `/en`. Copy lives in `messages/ko.json` / `messages/en.json`, read via `useTranslations` (Server Components) / `getTranslations` (metadata).

**Tech Stack:** Next.js 16.2.7 (App Router, Turbopack), React 19.2.4, TypeScript 5, Tailwind CSS v4, `next-intl` 4.13.4.

## Global Constraints

- **`proxy.ts`, not `middleware.ts`.** This Next.js version deprecated the `middleware.ts` file convention in favor of `proxy.ts` with an exported `proxy` function (`export default proxy` or named `proxy`). `next-intl` 4.13.4 supports this: same `createMiddleware` API, just save it to `proxy.ts` at the project root. Do not create `middleware.ts` — it will not run in this version.
- **Locales for this iteration: `ko` (default), `en` only.** Do not add other languages now. Extending later must only require adding a code to `i18n/routing.ts`'s `locales` array and a new `messages/<locale>.json` — no other file should need to change.
- **Deployment target is Vercel** (confirmed via `git log -- next.config.ts`: project moved off GitHub Pages static export in commit `276807d`), so `proxy.ts` (Node.js runtime) is fully supported — no static-export constraint applies.
- **No `src/` directory** in this project — `i18n/`, `messages/`, `proxy.ts` live at the repository root, `app/` stays at the root, and the `@/*` TS path alias already maps to `./*` (`tsconfig.json`).
- **English translations are a first draft.** Per spec section 5, translation accuracy — especially for `/privacy` — is explicitly out of scope for "done"; the user reviews before shipping. Do not treat translation wording as a defect during this plan's execution.
- Preserve all existing Tailwind classes and visual structure exactly — this is a copy/routing refactor, not a redesign.

---

## Task 1: Add next-intl, i18n config, and message catalogs

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `next.config.ts`
- Create: `i18n/routing.ts`
- Create: `i18n/navigation.ts`
- Create: `i18n/request.ts`
- Create: `messages/ko.json`
- Create: `messages/en.json`

**Interfaces:**
- Produces: `routing` (exported from `i18n/routing.ts`, type `{ locales: readonly ["ko","en"], defaultLocale: "ko" }`) — consumed by Task 2's `proxy.ts` and layout/page `generateStaticParams`/`hasLocale` checks, and Task 3's `LocaleSwitcher`.
- Produces: `Link`, `usePathname`, `useRouter`, `redirect`, `getPathname` (exported from `i18n/navigation.ts`) — consumed by Task 2 (`Link` in footer/back-home) and Task 3 (`Link`, `usePathname` in `LocaleSwitcher`).
- Produces: message keys under namespaces `Metadata`, `Home`, `Privacy` in `messages/ko.json` / `messages/en.json` — consumed by Task 2's `useTranslations`/`getTranslations` calls by exact key path (e.g. `Home.hero.tagline`, `Privacy.sections.collect.items`).

- [ ] **Step 1: Install next-intl**

```bash
npm install next-intl@4.13.4
```

- [ ] **Step 2: Verify install**

Run: `npm ls next-intl`
Expected: prints `next-intl@4.13.4` with no `UNMET DEPENDENCY` errors.

- [ ] **Step 3: Create `i18n/routing.ts`**

```ts
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en"],
  defaultLocale: "ko",
});
```

- [ ] **Step 4: Create `i18n/navigation.ts`**

```ts
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

- [ ] **Step 5: Create `i18n/request.ts`**

```ts
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 6: Create `messages/ko.json`**

```json
{
  "Metadata": {
    "title": "Word Bank — AI 단어장 & 리딩",
    "description": "AI가 단어 뜻과 예문을 자동으로 채워주고, 읽기 콘텐츠와 Leitner 복습으로 완벽하게 익혀요. 14개 언어 지원.",
    "ogDescription": "AI가 단어 뜻과 예문을 자동으로 채워주고, 읽기 콘텐츠와 Leitner 복습으로 완벽하게 익혀요."
  },
  "Home": {
    "hero": {
      "tagline": "호기심을 저축하세요.",
      "subtitleLine1": "모르는 단어를 발견했나요? 저장하기만 하세요.",
      "subtitleLine2": "AI가 즉시 뜻, 예문, 유의어까지 찾아드려요.",
      "iosNote": "iOS 버전은 준비 중입니다."
    },
    "downloadLabel": "Google Play에서 다운로드",
    "journey": {
      "read": {
        "title": "읽으면서 단어를 만나요",
        "desc": "10개 언어, 6단계 레벨의 AI 생성 이야기로 읽기 연습을 해보세요. 모르는 단어가 나오면 탭 한 번으로 바로 뜻을 확인할 수 있어요."
      },
      "save": {
        "title": "탭 한 번으로 저장, AI가 나머지를 채워요",
        "desc": "읽다가 발견했든 직접 입력했든, 저장하기만 하세요. AI가 즉시 품사·뜻·발음기호·예문·유의어·반의어까지 찾아드려요."
      },
      "organize": {
        "title": "나만의 방식으로 정리해요",
        "desc": "언어별, 혹은 직접 만든 카테고리별로 단어장을 정리하세요. 색상을 지정하고 검색하고, 필요하면 엑셀로 내보낼 수 있어요."
      },
      "review": {
        "title": "잊을 만할 때 복습해요",
        "desc": "Leitner 5단계 박스로 아는 단어는 간격을 두고, 모르는 단어는 자주 복습해요. 카드 뒤집기·빈칸 채우기·듣고 맞추기 세 모드 중 골라보세요."
      }
    },
    "featuresHeading": "더 편리하게",
    "features": {
      "reminder": {
        "title": "복습 알람",
        "desc": "원하는 시간에, 원하는 범위(언어/카테고리/모드)로 복습 알림을 받아보세요."
      },
      "quickAdd": {
        "title": "알림창 빠른 추가",
        "desc": "다른 앱에서 단어를 발견했다면 알림창에서 바로 추가할 수 있어요."
      },
      "export": {
        "title": "엑셀 내보내기",
        "desc": "저장한 단어장을 .xlsx 파일로 내보내 원하는 방식으로 활용하세요."
      },
      "darkMode": {
        "title": "다크 모드",
        "desc": "라이트/다크/시스템 테마를 지원해요."
      }
    },
    "languagesHeading": "14개 언어 지원",
    "languagesSubtitle": "원하는 언어로 학습하세요.",
    "languages": {
      "ko": "한국어",
      "en": "영어",
      "ja": "일본어",
      "zh": "중국어",
      "de": "독일어",
      "fr": "프랑스어",
      "es": "스페인어",
      "pt": "포르투갈어",
      "ar": "아랍어",
      "la": "라틴어",
      "hi": "힌디어",
      "bn": "벵골어",
      "ru": "러시아어",
      "id": "인도네시아어"
    },
    "ctaHeading": "지금 바로 시작해보세요",
    "footer": {
      "copyright": "© 2026 Talaria. All rights reserved.",
      "privacyLink": "개인정보처리방침"
    }
  },
  "Privacy": {
    "title": "개인정보처리방침",
    "lastUpdated": "최종 수정일: 2025년 6월",
    "sections": {
      "collect": {
        "heading": "수집하는 정보",
        "intro": "Word Bank 앱은 다음 정보를 수집합니다:",
        "items": [
          "사용자가 직접 입력한 단어 데이터 (Firebase Firestore에 저장)",
          "앱 오류 및 성능 정보 (Sentry를 통한 익명 수집)",
          "광고 서비스 제공을 위한 광고 식별자 (Google AdMob)"
        ]
      },
      "purpose": {
        "heading": "정보 이용 목적",
        "items": [
          "단어장 동기화 및 서비스 제공",
          "앱 안정성 개선",
          "무료 서비스 운영을 위한 광고 표시"
        ]
      },
      "thirdParty": {
        "heading": "제3자 서비스",
        "items": [
          "Google Firebase (데이터 저장 및 인증)",
          "Google AdMob (광고)",
          "Sentry (오류 수집)"
        ]
      },
      "retention": {
        "heading": "정보 보관 및 삭제",
        "body": "사용자 데이터는 앱 삭제 또는 계정 삭제 시 함께 삭제됩니다. 설정 화면에서 계정 삭제를 요청할 수 있습니다."
      },
      "contact": {
        "heading": "문의",
        "prefix": "개인정보 관련 문의:"
      }
    },
    "backHome": "← 홈으로"
  }
}
```

- [ ] **Step 7: Create `messages/en.json`**

```json
{
  "Metadata": {
    "title": "Word Bank — AI Vocabulary & Reading",
    "description": "AI instantly fills in word meanings and example sentences, and reading content plus Leitner review help you master them completely. Supports 14 languages.",
    "ogDescription": "AI instantly fills in word meanings and example sentences, and reading content plus Leitner review help you master them completely."
  },
  "Home": {
    "hero": {
      "tagline": "Save your curiosity.",
      "subtitleLine1": "Found a word you don't know? Just save it.",
      "subtitleLine2": "AI instantly finds the meaning, examples, and synonyms for you.",
      "iosNote": "iOS version is coming soon."
    },
    "downloadLabel": "Get it on Google Play",
    "journey": {
      "read": {
        "title": "Meet words as you read",
        "desc": "Practice reading with AI-generated stories in 10 languages across 6 levels. Tap any unfamiliar word to see its meaning instantly."
      },
      "save": {
        "title": "Save with one tap, AI fills in the rest",
        "desc": "Whether you found it while reading or typed it yourself, just save it. AI instantly finds the part of speech, meaning, pronunciation, example sentences, synonyms, and antonyms."
      },
      "organize": {
        "title": "Organize it your way",
        "desc": "Organize your vocabulary by language or by categories you create. Assign colors, search freely, and export to Excel whenever you need."
      },
      "review": {
        "title": "Review right before you forget",
        "desc": "The 5-box Leitner system spaces out words you know and reviews unfamiliar ones more often. Choose from three modes: flip cards, fill in the blank, or listen and answer."
      }
    },
    "featuresHeading": "More convenience",
    "features": {
      "reminder": {
        "title": "Review reminders",
        "desc": "Get review reminders at the time you want, scoped to the language, category, or mode you choose."
      },
      "quickAdd": {
        "title": "Quick add from notifications",
        "desc": "Found a word in another app? Add it right from the notification shade."
      },
      "export": {
        "title": "Excel export",
        "desc": "Export your saved vocabulary to an .xlsx file and use it however you like."
      },
      "darkMode": {
        "title": "Dark mode",
        "desc": "Supports light, dark, and system themes."
      }
    },
    "languagesHeading": "14 languages supported",
    "languagesSubtitle": "Learn in the language you want.",
    "languages": {
      "ko": "Korean",
      "en": "English",
      "ja": "Japanese",
      "zh": "Chinese",
      "de": "German",
      "fr": "French",
      "es": "Spanish",
      "pt": "Portuguese",
      "ar": "Arabic",
      "la": "Latin",
      "hi": "Hindi",
      "bn": "Bengali",
      "ru": "Russian",
      "id": "Indonesian"
    },
    "ctaHeading": "Get started now",
    "footer": {
      "copyright": "© 2026 Talaria. All rights reserved.",
      "privacyLink": "Privacy Policy"
    }
  },
  "Privacy": {
    "title": "Privacy Policy",
    "lastUpdated": "Last updated: June 2025",
    "sections": {
      "collect": {
        "heading": "Information We Collect",
        "intro": "The Word Bank app collects the following information:",
        "items": [
          "Word data you enter directly (stored in Firebase Firestore)",
          "App error and performance data (collected anonymously via Sentry)",
          "Advertising identifier for ad services (Google AdMob)"
        ]
      },
      "purpose": {
        "heading": "Purpose of Use",
        "items": [
          "Vocabulary sync and service delivery",
          "Improving app stability",
          "Displaying ads to support the free service"
        ]
      },
      "thirdParty": {
        "heading": "Third-Party Services",
        "items": [
          "Google Firebase (data storage and authentication)",
          "Google AdMob (advertising)",
          "Sentry (error reporting)"
        ]
      },
      "retention": {
        "heading": "Data Retention and Deletion",
        "body": "Your data is deleted when you delete the app or your account. You can request account deletion from the settings screen."
      },
      "contact": {
        "heading": "Contact",
        "prefix": "For privacy-related inquiries:"
      }
    },
    "backHome": "← Back home"
  }
}
```

- [ ] **Step 8: Wire the next-intl plugin into `next.config.ts`**

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
```

`createNextIntlPlugin()` with no argument looks for `./i18n/request.ts` by default, which matches the file created in Step 5.

- [ ] **Step 9: Verify the project still builds**

Run: `npm run build`
Expected: build succeeds. The existing `app/page.tsx`, `app/layout.tsx`, `app/privacy/page.tsx` are untouched and don't use next-intl yet, so output should be identical to before this task except for the new `next-intl` module being bundled.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json next.config.ts i18n messages
git commit -m "feat: next-intl 설정 및 한국어/영어 번역 카탈로그 추가"
```

---

## Task 2: Migrate routes under app/[locale]/ and add locale-detection proxy

**Files:**
- Create: `app/[locale]/layout.tsx` (replaces `app/layout.tsx`)
- Create: `app/[locale]/page.tsx` (replaces `app/page.tsx`)
- Create: `app/[locale]/privacy/page.tsx` (replaces `app/privacy/page.tsx`)
- Delete: `app/layout.tsx`, `app/page.tsx`, `app/privacy/page.tsx`, `app/privacy/` (now empty)
- Create: `proxy.ts` (project root — **not** `middleware.ts`, see Global Constraints)

**Interfaces:**
- Consumes: `routing` from `i18n/routing.ts`, `Link` from `i18n/navigation.ts` (Task 1).
- Consumes message keys `Metadata.*`, `Home.*`, `Privacy.*` from `messages/ko.json` / `messages/en.json` (Task 1) by exact path.
- Produces: working routes `/ko`, `/en`, `/ko/privacy`, `/en/privacy`, and `/` → redirect — consumed by Task 3 (adds `LocaleSwitcher` into these same page files) and Task 4 (end-to-end verification).

- [ ] **Step 1: Create `app/[locale]/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("ogDescription"),
      type: "website",
    },
  };
}

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create `app/[locale]/page.tsx`**

```tsx
import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.taejinahn.wordbank";

const journeySteps = [
  { id: "read", icon: "📖" },
  { id: "save", icon: "✨" },
  { id: "organize", icon: "🗂️" },
  { id: "review", icon: "🃏" },
] as const;

const features = [
  { id: "reminder", icon: "🔔" },
  { id: "quickAdd", icon: "⚡" },
  { id: "export", icon: "📊" },
  { id: "darkMode", icon: "🌙" },
] as const;

const languageIds = [
  "ko", "en", "ja", "zh", "de", "fr", "es",
  "pt", "ar", "la", "hi", "bn", "ru", "id",
] as const;

function DownloadButton({ label, className = "" }: { label: string; className?: string }) {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3 rounded-xl font-semibold text-sm hover:opacity-80 transition-opacity ${className}`}
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
        <path d="M3.18 23.76c.3.17.64.24.99.19l13.12-11.95L13.65 8.4 3.18 23.76zm17.3-10.7-3.3-1.9-3.73 3.4 3.73 3.38 3.32-1.92a1.55 1.55 0 0 0 0-2.96zM3 .27a1.55 1.55 0 0 0-.82 1.37v20.72c0 .58.3 1.08.82 1.36L13.3 12 3 .27zm10.65 3.33-9.47 8.64 3.64 3.62 5.83-12.26z" />
      </svg>
      {label}
    </a>
  );
}

type Props = { params: Promise<{ locale: string }> };

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = useTranslations("Home");

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-20">
        <div className="text-7xl mb-6">📚</div>
        <h1 className="text-5xl font-bold tracking-tight mb-4">Word Bank</h1>
        <p className="text-xl text-zinc-500 dark:text-zinc-400 max-w-md mb-2">
          {t("hero.tagline")}
        </p>
        <p className="text-base text-zinc-400 dark:text-zinc-500 max-w-sm mb-10">
          {t("hero.subtitleLine1")}
          <br />
          {t("hero.subtitleLine2")}
        </p>
        <DownloadButton label={t("downloadLabel")} />
        <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-3">
          {t("hero.iosNote")}
        </p>
      </section>

      {/* Journey */}
      <section className="px-6 pb-24 max-w-3xl mx-auto">
        <div className="flex flex-col gap-16">
          {journeySteps.map((step, i) => (
            <div
              key={step.id}
              className={`flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left ${
                i % 2 === 1 ? "sm:flex-row-reverse sm:text-right" : ""
              }`}
            >
              <div className="text-6xl shrink-0">{step.icon}</div>
              <div>
                <h2 className="text-xl font-bold mb-2">{t(`journey.${step.id}.title`)}</h2>
                <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {t(`journey.${step.id}.desc`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 pb-24 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12 text-zinc-800 dark:text-zinc-200">
          {t("featuresHeading")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div
              key={f.id}
              className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-6"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-base mb-1">{t(`features.${f.id}.title`)}</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {t(`features.${f.id}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Languages */}
      <section className="px-6 pb-24 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4 text-zinc-800 dark:text-zinc-200">
          {t("languagesHeading")}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
          {t("languagesSubtitle")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {languageIds.map((id) => (
            <span
              key={id}
              className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-1.5 text-sm text-zinc-600 dark:text-zinc-300"
            >
              {t(`languages.${id}`)}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center text-center px-6 pb-24">
        <h2 className="text-2xl font-bold mb-6 text-zinc-800 dark:text-zinc-200">
          {t("ctaHeading")}
        </h2>
        <DownloadButton label={t("downloadLabel")} />
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 dark:border-zinc-800 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
        <p className="mb-2">{t("footer.copyright")}</p>
        <Link
          href="/privacy"
          className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          {t("footer.privacyLink")}
        </Link>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Create `app/[locale]/privacy/page.tsx`**

```tsx
import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Props = { params: Promise<{ locale: string }> };

export default async function PrivacyPolicy({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = useTranslations("Privacy");

  const collectItems = t.raw("sections.collect.items") as string[];
  const purposeItems = t.raw("sections.purpose.items") as string[];
  const thirdPartyItems = t.raw("sections.thirdParty.items") as string[];

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
        <p className="text-sm text-zinc-400 mb-10">{t("lastUpdated")}</p>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.collect.heading")}</h2>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-sm">
            {t("sections.collect.intro")}
          </p>
          <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
            {collectItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.purpose.heading")}</h2>
          <ul className="text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
            {purposeItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.thirdParty.heading")}</h2>
          <ul className="text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
            {thirdPartyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.retention.heading")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t("sections.retention.body")}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.contact.heading")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("sections.contact.prefix")}{" "}
            <a
              href="mailto:ahntaejin4816@gmail.com"
              className="text-zinc-900 dark:text-zinc-100 underline"
            >
              ahntaejin4816@gmail.com
            </a>
          </p>
        </section>

        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete the old root routes**

```bash
git rm app/layout.tsx app/page.tsx app/privacy/page.tsx
```

(`app/globals.css` and `app/favicon.ico` stay at `app/` — they are locale-independent and Next.js resolves `favicon.ico` at the app root regardless of the `[locale]` segment below it.)

- [ ] **Step 5: Create `proxy.ts` at the project root**

```ts
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
```

The matcher excludes `_next/*` internals and any path containing a dot (static files like `favicon.ico`, `app-ads.txt`), so it runs on `/`, `/ko`, `/en`, `/privacy`, `/ko/privacy`, etc.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: build succeeds; the route list in the build output shows `/[locale]` and `/[locale]/privacy` as static (`●` or `○`) routes generated for both `ko` and `en`.

- [ ] **Step 7: Verify locale redirect and content with the dev server**

```bash
npm run dev &
DEV_PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/ko && break; sleep 1; done

curl -sI http://localhost:3000/ -H "Accept-Language: en-US,en;q=0.9" | grep -i "^location"
# Expected: location: /en

curl -sI http://localhost:3000/ -H "Accept-Language: ko-KR,ko;q=0.9" | grep -i "^location"
# Expected: location: /ko

curl -s http://localhost:3000/ko | grep -o "호기심을 저축하세요"
# Expected: match found

curl -s http://localhost:3000/en | grep -o "Save your curiosity"
# Expected: match found

curl -s http://localhost:3000/ko/privacy | grep -o "개인정보처리방침"
# Expected: match found

curl -s http://localhost:3000/en/privacy | grep -o "Privacy Policy"
# Expected: match found

curl -sI -L http://localhost:3000/fr | grep -i "^HTTP"
# Expected: final status line is "HTTP/1.1 404 Not Found" (after an intermediate redirect to /ko/fr)

kill $DEV_PID
```

- [ ] **Step 8: Commit**

```bash
git add app proxy.ts
git commit -m "feat: 랜딩페이지/개인정보처리방침을 app/[locale] 라우팅 구조로 이관"
```

---

## Task 3: Add the locale switcher UI

**Files:**
- Create: `components/LocaleSwitcher.tsx`
- Modify: `app/[locale]/page.tsx` (add switcher header)
- Modify: `app/[locale]/privacy/page.tsx` (add switcher header)

**Interfaces:**
- Consumes: `routing` from `i18n/routing.ts`, `Link`/`usePathname` from `i18n/navigation.ts` (Task 1).
- Produces: `LocaleSwitcher` default-exported component, no props — consumed by both page files in this task.

- [ ] **Step 1: Create `components/LocaleSwitcher.tsx`**

```tsx
"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const localeLabels: Record<(typeof routing.locales)[number], string> = {
  ko: "한국어",
  en: "English",
};

export default function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-2 text-sm">
      {routing.locales.map((loc, i) => (
        <span key={loc} className="flex items-center gap-2">
          {i > 0 && <span className="text-zinc-300 dark:text-zinc-700">/</span>}
          {loc === locale ? (
            <span className="text-zinc-900 dark:text-zinc-100 font-medium">
              {localeLabels[loc]}
            </span>
          ) : (
            <Link
              href={pathname}
              locale={loc}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {localeLabels[loc]}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Add the switcher to `app/[locale]/page.tsx`**

Add the import alongside the other imports:

```tsx
import LocaleSwitcher from "@/components/LocaleSwitcher";
```

Add a header as the first child inside the returned `<div className="min-h-screen ...">`, immediately before the `{/* Hero */}` section comment:

```tsx
      <header className="flex justify-end px-6 pt-6">
        <LocaleSwitcher />
      </header>

      {/* Hero */}
```

- [ ] **Step 3: Add the switcher to `app/[locale]/privacy/page.tsx`**

Add the import:

```tsx
import LocaleSwitcher from "@/components/LocaleSwitcher";
```

Add a header as the first child inside `<div className="max-w-2xl mx-auto">`, immediately before the `<h1>`:

```tsx
        <header className="flex justify-end mb-6">
          <LocaleSwitcher />
        </header>

        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Verify the toggle preserves the current path**

```bash
npm run dev &
DEV_PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/ko && break; sleep 1; done

curl -s http://localhost:3000/ko | grep -o 'href="/en"'
# Expected: match found (home page toggle links to /en, not /en/privacy)

curl -s http://localhost:3000/ko/privacy | grep -o 'href="/en/privacy"'
# Expected: match found (privacy page toggle links to /en/privacy, not /en)

kill $DEV_PID
```

- [ ] **Step 6: Commit**

```bash
git add components app
git commit -m "feat: 언어 전환 토글 컴포넌트 추가"
```

---

## Task 4: End-to-end verification against the spec's test plan

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: success; build output lists static pages for `/ko`, `/en`, `/ko/privacy`, `/en/privacy`.

- [ ] **Step 3: Manual spec checklist via dev server**

```bash
npm run dev &
DEV_PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/ko && break; sleep 1; done
```

Then confirm each item from the spec's Test section:

```bash
# / redirects per Accept-Language
curl -sI http://localhost:3000/ -H "Accept-Language: en-US,en;q=0.9" | grep -i "^location"
curl -sI http://localhost:3000/ -H "Accept-Language: ko-KR,ko;q=0.9" | grep -i "^location"

# no Accept-Language header -> falls back to default locale (ko)
curl -sI http://localhost:3000/ -H "Accept-Language:" | grep -i "^location"
# Expected: location: /ko

# /ko and /en render the correct language
curl -s http://localhost:3000/ko | grep -o "호기심을 저축하세요"
curl -s http://localhost:3000/en | grep -o "Save your curiosity"

# toggle preserves page (already verified in Task 3, re-check here for the full flow)
curl -s http://localhost:3000/ko | grep -o 'href="/en"'
curl -s http://localhost:3000/ko/privacy | grep -o 'href="/en/privacy"'

# /ko/privacy and /en/privacy render
curl -s http://localhost:3000/ko/privacy | grep -o "개인정보처리방침"
curl -s http://localhost:3000/en/privacy | grep -o "Privacy Policy"

# unsupported locale 404s
curl -sI -L http://localhost:3000/fr | grep -i "^HTTP"
```

Expected: every command above produces the match noted in its comment, and the last one ends on a `404` status line.

```bash
kill $DEV_PID
```

- [ ] **Step 4: Manual browser smoke test**

Open `http://localhost:3000` in a browser (via `npm run dev`) and confirm visually: hero, journey, features, languages, and CTA sections render with correct spacing/styling in both `/ko` and `/en`, dark mode still works, and the language toggle is visible top-right on both the landing page and `/privacy`.

- [ ] **Step 5: Note remaining manual follow-up for the user**

No commit for this task (verification only). Tell the user: English copy, especially `messages/en.json`'s `Privacy` section, is a first-pass translation and needs their review before deploying, per the spec's scope note.
