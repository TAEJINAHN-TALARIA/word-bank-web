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
