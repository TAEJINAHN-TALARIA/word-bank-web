import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LocaleSwitcher from "@/components/LocaleSwitcher";

type Props = { params: Promise<{ locale: string }> };

const THIRD_PARTY_POLICY_URLS: Record<string, string> = {
  "Google Gemini API": "https://policies.google.com/privacy",
  "Google Firebase": "https://firebase.google.com/support/privacy",
  "Google AdMob": "https://policies.google.com/technologies/ads",
  Sentry: "https://sentry.io/privacy/",
};

export default async function PrivacyPolicy({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Privacy");

  const collectItems = t.raw("sections.collect.items") as string[];
  const permissionItems = t.raw("sections.permissions.items") as string[];
  const thirdPartyServices = t.raw("sections.thirdParty.services") as {
    name: string;
    purpose: string;
  }[];

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

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.collect.heading")}</h2>
          <p className="text-sm bg-amber-50 dark:bg-amber-950/40 border-l-2 border-amber-400 dark:border-amber-600 rounded px-4 py-3 mb-3 text-zinc-700 dark:text-zinc-200">
            {t("sections.collect.highlight")}
          </p>
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
          <h2 className="text-lg font-semibold mb-3">{t("sections.permissions.heading")}</h2>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-sm">
            {t("sections.permissions.intro")}
          </p>
          <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
            {permissionItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.thirdParty.heading")}</h2>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-sm mb-3">
            {t("sections.thirdParty.intro")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("sections.thirdParty.tableHeaders.service")}
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("sections.thirdParty.tableHeaders.purpose")}
                  </th>
                  <th className="text-left py-2 font-medium text-zinc-500 dark:text-zinc-400">
                    {t("sections.thirdParty.tableHeaders.policy")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {thirdPartyServices.map((service) => (
                  <tr
                    key={service.name}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                      {service.name}
                    </td>
                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                      {service.purpose}
                    </td>
                    <td className="py-2">
                      <a
                        href={THIRD_PARTY_POLICY_URLS[service.name]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-900 dark:text-zinc-100 underline"
                      >
                        {t("sections.thirdParty.viewLink")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.ads.heading")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t("sections.ads.body")}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mt-2">
            {t("sections.ads.androidNote")}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.children.heading")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t("sections.children.body")}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.retention.heading")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t("sections.retention.body")}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t("sections.changes.heading")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t("sections.changes.body")}
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
