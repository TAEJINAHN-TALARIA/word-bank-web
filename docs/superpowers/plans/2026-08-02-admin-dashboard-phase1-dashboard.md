# word-bank-web Admin Dashboard (Phase 0+1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Google-login-gated `/admin` section to word-bank-web showing story
generation progress and a publish/recall review workflow, reusing story-generator's
existing publish logic via its new admin Cloud Functions.

**Architecture:** A second, locale-independent root layout tree (`app/admin/**`) sits
alongside the existing `app/(site)/[locale]/**` marketing site. A Firebase session cookie
(issued after Google sign-in + a custom-claim check) gates everything under
`app/admin/(dashboard)/**`. Reads of `pipelineSessions`/`stories` go straight to Firestore
via the Admin SDK; the pending-review list and all publish/recall writes go through
story-generator's admin Cloud Functions (Phase 1 of the `story-generator` plan), called
server-side with a shared-secret header.

**Tech Stack:** Next.js 16.2.7 (App Router), React 19.2.4, TypeScript, Tailwind 4,
`firebase`/`firebase-admin`, shadcn/ui, the `frontend-design` skill for the visual pass.

## Global Constraints

- Repo root is `C:\Users\TAEJIN\Documents\word-bank-web`, default branch **`master`**
  (not `main` — this repo's Vercel deploy auto-triggers on push to `master`).
- This site is **already** a standard server-rendered Next.js/Vercel deployment — no
  `output: 'export'` exists to remove (confirmed: it was dropped in an earlier commit
  during the GitHub Pages → Vercel migration).
- Next.js 16 renames `middleware.ts` to **`proxy.ts`** — creating a `middleware.ts` file
  does nothing. All middleware logic goes in the existing `proxy.ts`.
- No root `app/layout.tsx` exists today — `app/[locale]/layout.tsx` currently owns the
  `<html>/<body>` shell as the de facto root layout. Adding `/admin` outside the locale
  segment requires Next.js's "multiple root layouts" pattern via route groups.
- Tailwind 4 is CSS-first here — there is no `tailwind.config.*` file, only
  `app/globals.css`'s `@import "tailwindcss"` + `@theme` block. shadcn/ui's `init` will add
  `components.json` and work directly with this setup.
- No test framework exists in this repo (no jest/vitest/playwright). Verification for every
  task is `npm run build` (must succeed) plus a manual `npm run dev` check described in each
  task — this matches what the approved spec's Testing Plan already commits to.
- Path alias: `@/*` → repo root (already configured in `tsconfig.json`).
- No `.env.example` or `.env*` file exists yet in this repo; `.env*` is already gitignored.
  This plan introduces the first env template.
- Never commit real secrets. `.env.local` (with real values) is filled in manually as a
  deployment step, not by any task in this plan.

---

### Task 1: Routing restructure — locale route group, `/admin` skeleton, proxy update

**Files:**
- Move: `app/[locale]/**` → `app/(site)/[locale]/**` (route group, URLs unchanged)
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx` (placeholder, replaced in Task 4)
- Modify: `proxy.ts`

**Interfaces:**
- Produces: `/admin/**` paths no longer go through next-intl's locale redirect, and get an
  `x-pathname` request header set — Task 4's dashboard guard layout reads that header to
  build the post-login redirect target.

- [ ] **Step 1: Move the locale route group**

```bash
mkdir "app/(site)"
git mv "app/[locale]" "app/(site)/[locale]"
```

- [ ] **Step 2: Create the admin root layout**

```tsx
// app/admin/layout.tsx
import "../globals.css";

export const metadata = {
  title: "Word Bank Admin",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create a placeholder admin page**

```tsx
// app/admin/page.tsx
export default function AdminHomePage() {
  return <main className="p-8">관리자 대시보드 (준비 중)</main>;
}
```

- [ ] **Step 4: Update `proxy.ts`**

Current:

```ts
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
```

New:

```ts
import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    const response = NextResponse.next();
    response.headers.set("x-pathname", pathname);
    return response;
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
```

This keeps next-intl's locale redirect for marketing pages untouched, skips it entirely for
`/admin/**` and `/api/**`, and stamps the request path onto a header so a later Server
Component (Task 4) can read it without Next.js needing an experimental Node-runtime
middleware.

- [ ] **Step 5: Verify the build and both route trees**

Run: `npm run build`

Expected: build succeeds; the route list includes both the `/[locale]` marketing routes and
`/admin` as a separate route.

Run: `npm run dev`, then manually check:
- `http://localhost:3000/` → redirects to `/ko` (unchanged behavior).
- `http://localhost:3000/ko` → marketing page loads normally.
- `http://localhost:3000/admin` → shows "관리자 대시보드 (준비 중)" with **no** locale
  redirect (URL stays `/admin`, not `/ko/admin`).

- [ ] **Step 6: Commit**

```bash
git add app proxy.ts
git commit -m "feat: restructure routing for a locale-independent /admin route tree"
```

---

### Task 2: Firebase client + Admin SDK modules, env template

**Files:**
- Create: `lib/firebase/client.ts`
- Create: `lib/firebase/admin.ts`
- Create: `.env.example`
- Modify: `package.json` (add `firebase`, `firebase-admin`)

**Interfaces:**
- Produces: `getFirebaseClientApp()`, `getFirebaseAuth()`, `googleAuthProvider` (client.ts);
  `getAdminAuth()`, `getAdminFirestore()` (admin.ts) — consumed by Task 3 (login flow) and
  every later data-fetching/auth task.

- [ ] **Step 1: Install dependencies**

Run: `npm install firebase firebase-admin`

- [ ] **Step 2: Create `.env.example`**

```
# Firebase Web SDK config (Firebase Console > Project settings > General > Your apps > Web app)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin SDK service account, base64-encoded JSON key
FIREBASE_ADMIN_KEY_BASE64=

# Shared secret with story-generator's admin Cloud Functions
# (set there via: firebase functions:secrets:set ADMIN_API_SHARED_SECRET)
ADMIN_API_SHARED_SECRET=

# Base URL for story-generator's deployed Cloud Functions
# e.g. https://us-central1-wordbank-6284f.cloudfunctions.net
STORY_GENERATOR_FUNCTIONS_BASE_URL=
```

- [ ] **Step 3: Create `lib/firebase/client.ts`**

```ts
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function getFirebaseClientApp(): FirebaseApp {
  const apps = getApps();
  return apps.length ? apps[0] : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseClientApp());
}

export const googleAuthProvider = new GoogleAuthProvider();
```

- [ ] **Step 4: Create `lib/firebase/admin.ts`**

```ts
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function getAdminApp(): App {
  const apps = getApps();
  if (apps.length) return apps[0];

  const encoded = process.env.FIREBASE_ADMIN_KEY_BASE64;
  if (!encoded) {
    throw new Error("FIREBASE_ADMIN_KEY_BASE64 환경변수가 설정되지 않았습니다");
  }
  const serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
  return initializeApp({ credential: cert(serviceAccount) });
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build`

Expected: build succeeds (these modules aren't called by anything yet, so the missing-env
throw path is never hit at build time).

- [ ] **Step 6: Commit**

```bash
git add lib/firebase package.json package-lock.json .env.example
git commit -m "feat: add Firebase client and Admin SDK initialization modules"
```

---

### Task 3: Session Route Handler + login page

**Files:**
- Create: `app/api/auth/session/route.ts`
- Create: `lib/auth/session.ts`
- Create: `app/admin/login/page.tsx`

**Interfaces:**
- Consumes: `getAdminAuth()` (Task 2), `getFirebaseAuth()`/`googleAuthProvider` (Task 2).
- Produces: `getAdminSession(): Promise<{ uid: string } | null>` — consumed by Task 4's
  dashboard guard layout and by Task 7's server actions. `POST /api/auth/session` sets the
  `__session` cookie; `DELETE /api/auth/session` clears it.

- [ ] **Step 1: Create `app/api/auth/session/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";
const SESSION_EXPIRES_IN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export async function POST(request: NextRequest) {
  const { idToken } = await request.json();
  if (!idToken) {
    return NextResponse.json({ error: "idToken이 필요합니다" }, { status: 400 });
  }

  const adminAuth = getAdminAuth();
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "유효하지 않은 토큰입니다" }, { status: 401 });
  }

  if (decoded.admin !== true) {
    return NextResponse.json({ error: "관리자 권한이 없습니다" }, { status: 401 });
  }

  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_EXPIRES_IN_MS,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/admin",
    maxAge: SESSION_EXPIRES_IN_MS / 1000,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete({ name: SESSION_COOKIE_NAME, path: "/admin" });
  return response;
}
```

- [ ] **Step 2: Create `lib/auth/session.ts`**

```ts
import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";

export async function getAdminSession(): Promise<{ uid: string } | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    if (decoded.admin !== true) return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Create `app/admin/login/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithPopup, signOut } from "firebase/auth";
import { getFirebaseAuth, googleAuthProvider } from "@/lib/firebase/client";

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    const auth = getFirebaseAuth();
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        await signOut(auth);
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "로그인에 실패했습니다");
        return;
      }

      const redirectTo = searchParams.get("redirect") || "/admin";
      router.push(redirectTo);
    } catch {
      setError("로그인 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-xl font-semibold">Word Bank Admin</h1>
        <button
          type="button"
          onClick={handleSignIn}
          disabled={loading}
          className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? "로그인 중..." : "Google 계정으로 로그인"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 5: Manual verification**

Requires real values in `.env.local` (copy from `.env.example`) and the admin custom claim
already applied (word-bank plan's Task 1).

Run: `npm run dev`, visit `http://localhost:3000/admin/login`:
- Click "Google 계정으로 로그인" with the admin Google account → redirects to `/admin`, and
  DevTools → Application → Cookies shows a `__session` cookie (httpOnly, so its value isn't
  readable from the console, but its presence/attributes are visible).
- Repeat with a non-admin Google account → stays on the login page, shows
  "관리자 권한이 없습니다".

- [ ] **Step 6: Commit**

```bash
git add app/api/auth/session/route.ts lib/auth/session.ts app/admin/login
git commit -m "feat: add Firebase session cookie issuance and admin login page"
```

---

### Task 4: Dashboard guard layout + nav shell

**Files:**
- Move: `app/admin/page.tsx` → `app/admin/(dashboard)/page.tsx`
- Create: `app/admin/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `getAdminSession()` (Task 3), the `x-pathname` header set by `proxy.ts` (Task 1).
- Produces: every route placed under `app/admin/(dashboard)/**` is guarded — unauthenticated
  requests redirect to `/admin/login?redirect=<path>`. `/admin/login` itself lives outside
  this route group and is never guarded.

- [ ] **Step 1: Move the placeholder home page into the guarded group**

```bash
git mv app/admin/page.tsx "app/admin/(dashboard)/page.tsx"
```

- [ ] **Step 2: Create the guard + nav layout**

```tsx
// app/admin/(dashboard)/layout.tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) {
    const pathname = (await headers()).get("x-pathname") ?? "/admin";
    redirect(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 shrink-0 border-r border-neutral-200 p-4">
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/admin">홈</Link>
          </li>
          <li>
            <Link href="/admin/generation">생성 진행상황</Link>
          </li>
          <li>
            <Link href="/admin/review">검토/게시</Link>
          </li>
        </ul>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: build succeeds; route list shows `/admin` still resolving through the new group.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`.
- Without a session cookie (clear cookies or use an incognito window), visit
  `http://localhost:3000/admin` → redirects to `http://localhost:3000/admin/login?redirect=%2Fadmin`.
- Log in (as in Task 3) → lands back on `/admin`, now showing the nav shell + "관리자 대시보드
  (준비 중)".

- [ ] **Step 5: Commit**

```bash
git add app/admin
git commit -m "feat: add session-guarded dashboard layout with nav shell"
```

---

### Task 5: shadcn/ui setup

**Files:**
- Create: `components.json` (generated by shadcn CLI)
- Create: `lib/utils.ts` (generated by shadcn CLI)
- Create: `components/ui/button.tsx`, `components/ui/table.tsx`, `components/ui/tabs.tsx`,
  `components/ui/badge.tsx`, `components/ui/card.tsx` (generated by shadcn CLI)
- Modify: `app/globals.css` (shadcn CLI appends its CSS variables)

**Interfaces:**
- Produces: `Button`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableCell`, `Tabs`,
  `Badge`, `Card` components under `@/components/ui/*` — consumed by Task 6, 7, and 8.

- [ ] **Step 1: Run the shadcn init CLI**

Run: `npx shadcn@latest init`

When prompted, accept the defaults that match this repo's existing setup (TypeScript, the
existing `app/globals.css`, the `@/*` path alias). This generates `components.json` and
`lib/utils.ts`, and appends CSS variables to `app/globals.css`.

- [ ] **Step 2: Add the components used by Tasks 6-8**

Run: `npx shadcn@latest add button table tabs badge card`

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: build succeeds with the new `components/ui/*` files present but unused so far.

- [ ] **Step 4: Commit**

```bash
git add components.json lib/utils.ts components/ui app/globals.css package.json package-lock.json
git commit -m "chore: set up shadcn/ui"
```

---

### Task 6: Generation progress pages (list + detail)

**Files:**
- Create: `lib/data/pipelineSessions.ts`
- Create: `app/admin/(dashboard)/generation/page.tsx`
- Create: `app/admin/(dashboard)/generation/[sessionId]/page.tsx`

**Interfaces:**
- Consumes: `getAdminFirestore()` (Task 2).
- Produces: `listPipelineSessions(): Promise<PipelineSessionSummary[]>`,
  `getPipelineSessionDetail(sessionId): Promise<PipelineSessionDetail | null>`.

Firestore schema consumed here (`pipelineSessions/{id}` and its `layer6Gates/{target}`
subcollection) was confirmed against story-generator's `src/pipeline/firestoreSessionStore.js`:
fields `status`, `runId`, `targetLevel`, `combo`, `targetLanguages`, `createdAt` on the
session doc; `latestStatus`, `ruleBaseWarnings`, `llmEvalReasons`, `retryCount` on each
`layer6Gates/{target}` doc.

- [ ] **Step 1: Create `lib/data/pipelineSessions.ts`**

```ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type PipelineSessionSummary = {
  id: string;
  status: string;
  runId: string;
  targetLevel: string;
  combo: string;
  targetLanguages: string[];
  createdAt: string;
};

export async function listPipelineSessions(): Promise<PipelineSessionSummary[]> {
  const db = getAdminFirestore();
  const snapshot = await db
    .collection("pipelineSessions")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      status: data.status,
      runId: data.runId,
      targetLevel: data.targetLevel,
      combo: data.combo,
      targetLanguages: data.targetLanguages ?? [],
      createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    };
  });
}

export type LayerGateResult = {
  target: string;
  latestStatus: string;
  ruleBaseWarnings: string[];
  llmEvalReasons: string[];
  retryCount: number;
};

export type PipelineSessionDetail = PipelineSessionSummary & {
  layer6Gates: LayerGateResult[];
};

export async function getPipelineSessionDetail(
  sessionId: string,
): Promise<PipelineSessionDetail | null> {
  const db = getAdminFirestore();
  const doc = await db.collection("pipelineSessions").doc(sessionId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;

  const gatesSnapshot = await db
    .collection("pipelineSessions")
    .doc(sessionId)
    .collection("layer6Gates")
    .get();

  const layer6Gates: LayerGateResult[] = gatesSnapshot.docs.map((gateDoc) => {
    const gateData = gateDoc.data();
    return {
      target: gateDoc.id,
      latestStatus: gateData.latestStatus,
      ruleBaseWarnings: gateData.ruleBaseWarnings ?? [],
      llmEvalReasons: gateData.llmEvalReasons ?? [],
      retryCount: gateData.retryCount ?? 0,
    };
  });

  return {
    id: doc.id,
    status: data.status,
    runId: data.runId,
    targetLevel: data.targetLevel,
    combo: data.combo,
    targetLanguages: data.targetLanguages ?? [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    layer6Gates,
  };
}
```

- [ ] **Step 2: Create the list page**

```tsx
// app/admin/(dashboard)/generation/page.tsx
import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";

export default async function GenerationPage() {
  const sessions = await listPipelineSessions();

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">소설 생성 진행상황</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">세션 ID</th>
            <th>상태</th>
            <th>레벨</th>
            <th>Combo</th>
            <th>대상 언어</th>
            <th>생성일</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id} className="border-b">
              <td className="py-2">
                <Link href={`/admin/generation/${session.id}`} className="underline">
                  {session.id}
                </Link>
              </td>
              <td>{session.status}</td>
              <td>{session.targetLevel}</td>
              <td>{session.combo}</td>
              <td>{session.targetLanguages.join(", ")}</td>
              <td>{session.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create the detail page**

```tsx
// app/admin/(dashboard)/generation/[sessionId]/page.tsx
import { notFound } from "next/navigation";
import { getPipelineSessionDetail } from "@/lib/data/pipelineSessions";

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await getPipelineSessionDetail(sessionId);
  if (!session) notFound();

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">{session.id}</h1>
      <dl className="mb-6 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-neutral-500">상태</dt>
        <dd>{session.status}</dd>
        <dt className="text-neutral-500">레벨</dt>
        <dd>{session.targetLevel}</dd>
        <dt className="text-neutral-500">Combo</dt>
        <dd>{session.combo}</dd>
        <dt className="text-neutral-500">대상 언어</dt>
        <dd>{session.targetLanguages.join(", ")}</dd>
      </dl>
      <h2 className="mb-2 font-medium">Layer 6 게이트 결과</h2>
      <ul className="space-y-3">
        {session.layer6Gates.map((gate) => (
          <li key={gate.target} className="rounded border border-neutral-200 p-3 text-sm">
            <div className="font-medium">
              {gate.target} — {gate.latestStatus} (재시도 {gate.retryCount}회)
            </div>
            {gate.ruleBaseWarnings.length > 0 && (
              <p className="mt-1 text-amber-700">경고: {gate.ruleBaseWarnings.join(", ")}</p>
            )}
            {gate.llmEvalReasons.length > 0 && (
              <p className="mt-1 text-neutral-600">
                판정 사유: {gate.llmEvalReasons.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 5: Manual verification**

Requires at least one real `pipelineSessions` document in Firestore (from story-generator's
existing pipeline runs). Visit `http://localhost:3000/admin/generation` → list renders;
click a session ID → detail page renders its `layer6Gates` entries. Visit
`/admin/generation/does-not-exist` → renders the Next.js 404 page (via `notFound()`).

- [ ] **Step 6: Commit**

```bash
git add lib/data/pipelineSessions.ts app/admin
git commit -m "feat: add generation progress list and detail pages"
```

---

### Task 7: Review page — pending list, publish/recall actions, published list

**Files:**
- Create: `lib/data/stories.ts`
- Create: `lib/admin-functions/storyGenerator.ts`
- Create: `lib/actions/adminStoryActions.ts`
- Create: `components/admin/ReviewTabs.tsx`
- Create: `app/admin/(dashboard)/review/page.tsx`

**Interfaces:**
- Consumes: `getAdminFirestore()` (Task 2), `getAdminSession()` (Task 3),
  `STORY_GENERATOR_FUNCTIONS_BASE_URL`/`ADMIN_API_SHARED_SECRET` env vars.
- Produces: `listPublishedStories()`; `fetchPendingReviews()`, `publishStory(sessionId,
  target)`, `recallStory(sessionId, target)` (calling story-generator's Cloud Functions);
  Server Actions `publishStoryAction`/`recallStoryAction` for the client UI to call.

`stories/{id}` schema consumed here (`lang`, `level`, `title`, `chapterCount`, `sessionId`,
`target`) and the `adminListPendingReviews` response shape were confirmed against
story-generator's `src/publishService.js`.

- [ ] **Step 1: Create `lib/data/stories.ts`**

```ts
import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type PublishedStory = {
  id: string;
  lang: string;
  level: string;
  title: string | null;
  chapterCount: number;
  sessionId: string;
  target: string;
};

export async function listPublishedStories(): Promise<PublishedStory[]> {
  const db = getAdminFirestore();
  const snapshot = await db.collection("stories").orderBy("createdAt", "desc").limit(100).get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      lang: data.lang,
      level: data.level,
      title: data.title ?? null,
      chapterCount: data.chapterCount,
      sessionId: data.sessionId,
      target: data.target,
    };
  });
}
```

- [ ] **Step 2: Create `lib/admin-functions/storyGenerator.ts`**

```ts
import "server-only";

const BASE_URL = process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL;
const SHARED_SECRET = process.env.ADMIN_API_SHARED_SECRET;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다`);
  return value;
}

export type PendingReviewItem = {
  sessionId: string;
  target: string;
  lang: string;
  level: string;
  title: string | null;
  gateStatus: string;
  ruleBaseWarnings: string[];
  llmEvalReasons: string[];
};

export async function fetchPendingReviews(): Promise<PendingReviewItem[]> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminListPendingReviews`, {
    method: "GET",
    headers: { "x-admin-api-key": secret },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `검토 대기 목록 조회 실패 (${response.status})`);
  }
  return response.json();
}

export async function publishStory(sessionId: string, target: string): Promise<void> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminPublishStory`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, target }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `게시 실패 (${response.status})`);
  }
}

export async function recallStory(sessionId: string, target: string): Promise<void> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminRecallStory`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, target }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `철회 실패 (${response.status})`);
  }
}
```

- [ ] **Step 3: Create `lib/actions/adminStoryActions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import {
  publishStory as callPublishStory,
  recallStory as callRecallStory,
} from "@/lib/admin-functions/storyGenerator";

export async function publishStoryAction(
  sessionId: string,
  target: string,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await callPublishStory(sessionId, target);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "게시 실패" };
  }
  revalidatePath("/admin/review");
  return {};
}

export async function recallStoryAction(
  sessionId: string,
  target: string,
): Promise<{ error?: string }> {
  const session = await getAdminSession();
  if (!session) return { error: "관리자 로그인이 필요합니다" };

  try {
    await callRecallStory(sessionId, target);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "철회 실패" };
  }
  revalidatePath("/admin/review");
  return {};
}
```

This re-checks `getAdminSession()` inside the action itself — the dashboard layout's guard
(Task 4) only protects page navigation, not Server Action invocations, so a mutating action
must verify authorization on its own.

- [ ] **Step 4: Create `components/admin/ReviewTabs.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { PendingReviewItem } from "@/lib/admin-functions/storyGenerator";
import type { PublishedStory } from "@/lib/data/stories";
import { publishStoryAction, recallStoryAction } from "@/lib/actions/adminStoryActions";

export function ReviewTabs({
  pending,
  published,
}: {
  pending: PendingReviewItem[];
  published: PublishedStory[];
}) {
  const [tab, setTab] = useState<"pending" | "published">("pending");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePublish(sessionId: string, target: string) {
    setError(null);
    startTransition(async () => {
      const result = await publishStoryAction(sessionId, target);
      if (result.error) setError(result.error);
    });
  }

  function handleRecall(sessionId: string, target: string) {
    setError(null);
    startTransition(async () => {
      const result = await recallStoryAction(sessionId, target);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div>
      <div className="mb-4 flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`px-3 py-2 text-sm ${
            tab === "pending" ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"
          }`}
        >
          대기중 ({pending.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("published")}
          className={`px-3 py-2 text-sm ${
            tab === "published" ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"
          }`}
        >
          게시됨 ({published.length})
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {tab === "pending" && (
        <ul className="space-y-3">
          {pending.map((item) => (
            <li
              key={`${item.sessionId}_${item.target}`}
              className="rounded border border-neutral-200 p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {item.title ?? "(제목 없음)"} — {item.lang} / {item.level}
                  </div>
                  <div className="text-neutral-500">게이트: {item.gateStatus}</div>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handlePublish(item.sessionId, item.target)}
                  className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
                >
                  게시
                </button>
              </div>
              {item.ruleBaseWarnings.length > 0 && (
                <p className="mt-1 text-amber-700">경고: {item.ruleBaseWarnings.join(", ")}</p>
              )}
            </li>
          ))}
          {pending.length === 0 && (
            <p className="text-neutral-500">검토 대기 중인 콘텐츠가 없습니다.</p>
          )}
        </ul>
      )}

      {tab === "published" && (
        <ul className="space-y-3">
          {published.map((story) => (
            <li
              key={story.id}
              className="flex items-center justify-between rounded border border-neutral-200 p-3 text-sm"
            >
              <div>
                <div className="font-medium">
                  {story.title ?? "(제목 없음)"} — {story.lang} / {story.level}
                </div>
                <div className="text-neutral-500">챕터 {story.chapterCount}개</div>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleRecall(story.sessionId, story.target)}
                className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-50"
              >
                게시 철회
              </button>
            </li>
          ))}
          {published.length === 0 && (
            <p className="text-neutral-500">게시된 콘텐츠가 없습니다.</p>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `app/admin/(dashboard)/review/page.tsx`**

```tsx
import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";
import { listPublishedStories } from "@/lib/data/stories";
import { ReviewTabs } from "@/components/admin/ReviewTabs";

export default async function ReviewPage() {
  const [pending, published] = await Promise.all([
    fetchPendingReviews(),
    listPublishedStories(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">소설 검토 / 게시 관리</h1>
      <ReviewTabs pending={pending} published={published} />
    </div>
  );
}
```

- [ ] **Step 6: Replace the `/admin` home placeholder with real summary cards**

The spec calls for `/admin` to show "진행 중인 생성 run 수, 승인 대기 건수 등 요약 카드"
(counts of in-progress generation runs and pending reviews). Both data sources
(`listPipelineSessions` from Task 6, `fetchPendingReviews` from Step 2 above) exist now, so
replace the Task 1 placeholder:

```tsx
// app/admin/(dashboard)/page.tsx
import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";
import { fetchPendingReviews } from "@/lib/admin-functions/storyGenerator";

export default async function AdminHomePage() {
  const [sessions, pending] = await Promise.all([listPipelineSessions(), fetchPendingReviews()]);
  const inProgressCount = sessions.filter((s) => s.status === "in_progress").length;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Word Bank Admin</h1>
      <div className="flex gap-4">
        <Link
          href="/admin/generation"
          className="rounded border border-neutral-200 p-4 hover:border-neutral-400"
        >
          <div className="text-2xl font-semibold">{inProgressCount}</div>
          <div className="text-sm text-neutral-500">진행 중인 생성 run</div>
        </Link>
        <Link
          href="/admin/review"
          className="rounded border border-neutral-200 p-4 hover:border-neutral-400"
        >
          <div className="text-2xl font-semibold">{pending.length}</div>
          <div className="text-sm text-neutral-500">검토 대기 중인 콘텐츠</div>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 8: Manual verification**

Requires the story-generator admin functions deployed (story-generator plan's Task 2) and
`STORY_GENERATOR_FUNCTIONS_BASE_URL`/`ADMIN_API_SHARED_SECRET` set in `.env.local` with
matching values on both sides. Requires at least one pending-review item (a session that
passed Layer 6 but isn't yet in `stories`) to fully exercise the publish flow.

Visit `http://localhost:3000/admin` → summary cards show the correct in-progress and
pending counts, and both link to the right pages.

Visit `http://localhost:3000/admin/review`:
- "대기중" tab shows pending items with gate status and warnings.
- Click "게시" on one → item disappears from "대기중" (page revalidates) and appears under
  "게시됨".
- Click "게시 철회" on a published item → it disappears from "게시됨" and reappears under
  "대기중" on next load.
- Temporarily set a wrong value for `ADMIN_API_SHARED_SECRET` in `.env.local`, restart
  `npm run dev`, and click "게시" → the error message from the 401 response shows inline
  (confirms the error path isn't silently swallowed). Restore the correct value afterward.

- [ ] **Step 9: Commit**

```bash
git add lib/data/stories.ts lib/admin-functions lib/actions components/admin app/admin
git commit -m "feat: add story review/publish/recall dashboard page and home summary cards"
```

---

### Task 8: Visual design pass

**Files (restyle only, no new behavior):**
- Modify: `app/admin/login/page.tsx`
- Modify: `app/admin/(dashboard)/layout.tsx`
- Modify: `app/admin/(dashboard)/page.tsx`
- Modify: `app/admin/(dashboard)/generation/page.tsx`
- Modify: `app/admin/(dashboard)/generation/[sessionId]/page.tsx`
- Modify: `components/admin/ReviewTabs.tsx`

**Interfaces:** none — this task only changes markup/styling inside the files above, not
their exported functions, props, or data flow.

- [ ] **Step 1: Invoke the `frontend-design` skill**

Use the Skill tool with `skill: "frontend-design"` before making any changes, to get
aesthetic direction (typography, spacing, color, layout choices) for an internal
operations dashboard rather than a marketing site.

- [ ] **Step 2: Apply the guidance to the five files listed above**

Replace the raw Tailwind utility styling written in Tasks 3, 4, 6, and 7 with the shadcn/ui
components installed in Task 5 (`Button`, `Table`/`TableHeader`/`TableBody`/`TableRow`/
`TableCell`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Badge`, `Card`) plus whatever
concrete typography/spacing/color choices the skill's guidance produces. Keep every existing
prop, data shape, `onClick`/action wiring, and route structure unchanged — this is a
restyle, not a rewrite of behavior.

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 4: Manual verification — re-run every check from Tasks 3, 4, 6, and 7**

Confirm after restyling that: login still redirects correctly on success/failure, the
dashboard guard still redirects unauthenticated visitors, the home page's summary cards
still show correct counts and link correctly, the generation list/detail pages still render
real data, and the review page's tab switching plus publish/recall actions still work
end-to-end. Visually confirm both light and dark OS color-scheme (if the `frontend-design`
guidance includes dark mode) render without unreadable contrast.

- [ ] **Step 5: Commit**

```bash
git add app/admin components/admin
git commit -m "style: apply frontend-design pass to admin dashboard"
```

---

## Deployment Notes (not a task — reference for whoever deploys this to Vercel)

- Set all four vars from `.env.example` in Vercel → Project Settings → Environment
  Variables: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`,
  `FIREBASE_ADMIN_KEY_BASE64`, `ADMIN_API_SHARED_SECRET`,
  `STORY_GENERATOR_FUNCTIONS_BASE_URL`.
- `FIREBASE_ADMIN_KEY_BASE64`: base64-encode the `wordbank-6284f` service account JSON key
  (Firebase Console → Project Settings → Service Accounts → Generate new private key), e.g.
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes('service-account.json'))` in
  PowerShell, or `base64 -w0 service-account.json` on Linux/macOS. Reuse the existing
  `wordbank-6284f` service account rather than creating a new one, unless there's a reason
  to scope permissions differently.
- `ADMIN_API_SHARED_SECRET` must exactly match the value set via
  `firebase functions:secrets:set ADMIN_API_SHARED_SECRET` in the story-generator plan's
  Task 2.
- This repo auto-deploys on push to `master` (not `main`) — confirm the branch before
  pushing.
