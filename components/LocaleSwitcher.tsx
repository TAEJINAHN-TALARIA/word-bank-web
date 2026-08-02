"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("LocaleSwitcher");

  return (
    <nav className="flex items-center gap-2 text-sm">
      {routing.locales.map((loc, i) => (
        <span key={loc} className="flex items-center gap-2">
          {i > 0 && <span className="text-zinc-300 dark:text-zinc-700">/</span>}
          {loc === locale ? (
            <span className="text-zinc-900 dark:text-zinc-100 font-medium">
              {t(loc)}
            </span>
          ) : (
            <Link
              href={pathname}
              locale={loc}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {t(loc)}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
