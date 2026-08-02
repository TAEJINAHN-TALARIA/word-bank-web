import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

type Props = { params: Promise<{ locale: string }> };

export default async function PrivacyPolicy({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Privacy");

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
