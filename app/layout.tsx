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
  title: "Word Bank — AI 단어장",
  description: "단어를 저장하면 AI가 즉시 뜻, 예문, 유의어까지 찾아드려요. Leitner 시스템으로 효율적으로 복습하세요.",
  openGraph: {
    title: "Word Bank — AI 단어장",
    description: "단어를 저장하면 AI가 즉시 뜻, 예문, 유의어까지 찾아드려요.",
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
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
