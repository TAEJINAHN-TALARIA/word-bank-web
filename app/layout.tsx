import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Word Bank — AI 단어장 & 리딩",
  description: "AI가 단어 뜻과 예문을 자동으로 채워주고, 읽기 콘텐츠와 Leitner 복습으로 완벽하게 익혀요. 14개 언어 지원.",
  openGraph: {
    title: "Word Bank — AI 단어장 & 리딩",
    description: "AI가 단어 뜻과 예문을 자동으로 채워주고, 읽기 콘텐츠와 Leitner 복습으로 완벽하게 익혀요.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
