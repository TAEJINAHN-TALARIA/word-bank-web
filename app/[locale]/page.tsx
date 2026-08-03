import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LocaleSwitcher from "@/components/LocaleSwitcher";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.taejinahn.wordbank";

const journeySteps = [
  { id: "read", icon: "📖" },
  { id: "save", icon: "✨" },
  { id: "organize", icon: "🗂️" },
  { id: "review", icon: "🃏" },
] as const;

const features = [
  { id: "reminder", icon: "🔔" },
  { id: "quickAdd", icon: "⚡" },
  { id: "export", icon: "📊" },
  { id: "darkMode", icon: "🌙" },
] as const;

const languageIds = [
  "ko", "en", "ja", "zh", "de", "fr", "es",
  "pt", "ar", "la", "hi", "bn", "ru", "id",
] as const;

function DownloadButton({ label, className = "" }: { label: string; className?: string }) {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3 rounded-xl font-semibold text-sm hover:opacity-80 transition-opacity ${className}`}
    >
      <svg viewBox="30 336.7 120.9 129.2" className="w-5 h-5" aria-hidden="true">
        <path
          fill="#FFD400"
          d="M119.2,421.2c15.3-8.4,27-14.8,28-15.3c3.2-1.7,6.5-6.2,0-9.7c-2.1-1.1-13.4-7.3-28-15.3l-20.1,20.2L119.2,421.2z"
        />
        <path
          fill="#FF3333"
          d="M99.1,401.1l-64.2,64.7c1.5,0.2,3.2-0.2,5.2-1.3c4.2-2.3,48.8-26.7,79.1-43.3L99.1,401.1L99.1,401.1z"
        />
        <path
          fill="#48FF48"
          d="M99.1,401.1l20.1-20.2c0,0-74.6-40.7-79.1-43.1c-1.7-1-3.6-1.3-5.3-1L99.1,401.1z"
        />
        <path
          fill="#3BCCFF"
          d="M99.1,401.1l-64.3-64.3c-2.6,0.6-4.8,2.9-4.8,7.6c0,7.5,0,107.5,0,113.8c0,4.3,1.7,7.4,4.9,7.7L99.1,401.1z"
        />
      </svg>
      {label}
    </a>
  );
}

type Props = { params: Promise<{ locale: string }> };

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      <header className="flex justify-end px-6 pt-6">
        <LocaleSwitcher />
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-20">
        <div className="text-7xl mb-6">📚</div>
        <h1 className="text-5xl font-bold tracking-tight mb-4">Word Bank</h1>
        <p className="text-xl text-zinc-500 dark:text-zinc-400 max-w-md mb-2">
          {t("hero.tagline")}
        </p>
        <p className="text-base text-zinc-400 dark:text-zinc-500 max-w-sm mb-10">
          {t("hero.subtitleLine1")}
          <br />
          {t("hero.subtitleLine2")}
        </p>
        <DownloadButton label={t("downloadLabel")} />
        <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-3">
          {t("hero.iosNote")}
        </p>
      </section>

      {/* Journey */}
      <section className="px-6 pb-24 max-w-3xl mx-auto">
        <div className="flex flex-col gap-16">
          {journeySteps.map((step, i) => (
            <div
              key={step.id}
              className={`flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left ${
                i % 2 === 1 ? "sm:flex-row-reverse sm:text-right" : ""
              }`}
            >
              <div className="text-6xl shrink-0">{step.icon}</div>
              <div>
                <h2 className="text-xl font-bold mb-2">{t(`journey.${step.id}.title`)}</h2>
                <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {t(`journey.${step.id}.desc`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 pb-24 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12 text-zinc-800 dark:text-zinc-200">
          {t("featuresHeading")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div
              key={f.id}
              className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-6"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-base mb-1">{t(`features.${f.id}.title`)}</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {t(`features.${f.id}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Languages */}
      <section className="px-6 pb-24 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4 text-zinc-800 dark:text-zinc-200">
          {t("languagesHeading")}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
          {t("languagesSubtitle")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {languageIds.map((id) => (
            <span
              key={id}
              className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-1.5 text-sm text-zinc-600 dark:text-zinc-300"
            >
              {t(`languages.${id}`)}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center text-center px-6 pb-24">
        <h2 className="text-2xl font-bold mb-6 text-zinc-800 dark:text-zinc-200">
          {t("ctaHeading")}
        </h2>
        <DownloadButton label={t("downloadLabel")} />
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 dark:border-zinc-800 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
        <p className="mb-2">{t("footer.copyright")}</p>
        <Link
          href="/privacy"
          className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          {t("footer.privacyLink")}
        </Link>
      </footer>
    </div>
  );
}
