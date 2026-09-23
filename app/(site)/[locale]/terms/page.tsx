import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LocaleSwitcher from "@/components/LocaleSwitcher";

type Props = { params: Promise<{ locale: string }> };

type TermsSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

export default async function TermsOfService({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Terms");

  const sections = t.raw("sections") as TermsSection[];

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-end mb-6">
          <LocaleSwitcher />
        </header>

        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
        <p className="text-sm text-zinc-400 mb-6">{t("lastUpdated")}</p>
        <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-sm mb-10">
          {t("intro")}
        </p>

        {sections.map((section, index) => (
          <section key={section.heading} className="mb-8">
            <h2 className="text-lg font-semibold mb-3">
              {index + 1}. {section.heading}
            </h2>
            {section.paragraphs?.map((paragraph) => (
              <p
                key={paragraph}
                className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-2"
              >
                {paragraph}
              </p>
            ))}
            {section.items && (
              <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">
            {sections.length + 1}. {t("contact.heading")}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("contact.prefix")}{" "}
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
