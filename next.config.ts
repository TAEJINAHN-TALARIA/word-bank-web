import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // 게시본 전문 보기·다운로드가 "게시본 관리"(/admin/published)로 옮겨 갔다 — 북마크와 옛 링크를 살린다.
  async redirects() {
    return [
      { source: "/admin/review/:docId", destination: "/admin/published/:docId", permanent: false },
      { source: "/admin/review/:docId/download", destination: "/admin/published/:docId/download", permanent: false },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
