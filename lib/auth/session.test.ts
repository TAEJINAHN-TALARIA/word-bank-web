import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("@/lib/firebase/admin");

import { cookies } from "next/headers";
import { getAdminSession } from "./session";
import * as adminModule from "@/lib/firebase/admin";

const mockCookies = vi.mocked(cookies);
const mockGetAdminAuth = vi.mocked(adminModule.getAdminAuth);

function mockCookieValue(value: string | undefined) {
  mockCookies.mockResolvedValue({
    get: vi.fn(() => (value === undefined ? undefined : { value })),
  } as never);
}

describe("getAdminSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("세션 쿠키가 없으면 null을 반환하고 검증을 호출하지 않는다", async () => {
    mockCookieValue(undefined);
    const mockVerify = vi.fn();
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    const result = await getAdminSession();

    expect(result).toBeNull();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("TTL 이내 재요청은 캐시를 사용하고 verifySessionCookie를 다시 호출하지 않는다", async () => {
    mockCookieValue("cookie-ttl-hit");
    const mockVerify = vi.fn().mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    const first = await getAdminSession();
    vi.advanceTimersByTime(30_000);
    const second = await getAdminSession();

    expect(first).toEqual({ uid: "admin-1" });
    expect(second).toEqual({ uid: "admin-1" });
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });

  it("TTL 만료 후에는 verifySessionCookie를 다시 호출한다", async () => {
    mockCookieValue("cookie-ttl-miss");
    const mockVerify = vi.fn().mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    await getAdminSession();
    vi.advanceTimersByTime(61_000);
    await getAdminSession();

    expect(mockVerify).toHaveBeenCalledTimes(2);
  });

  it("admin 클레임이 없으면 null을 반환하고 캐시하지 않는다", async () => {
    mockCookieValue("cookie-no-admin");
    const mockVerify = vi.fn().mockResolvedValue({ uid: "user-1", admin: false });
    mockGetAdminAuth.mockReturnValue({ verifySessionCookie: mockVerify } as never);

    const first = await getAdminSession();
    const second = await getAdminSession();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });
});
