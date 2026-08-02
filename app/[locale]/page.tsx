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
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
        <path d="M3.18 23.76c.3.17.64.24.99.19l13.12-11.95L13.65 8.4 3.18 23.76zm17.3-10.7-3.3-1.9-3.73 3.4 3.73 3.38 3.32-1.92a1.55 1.55 0 0 0 0-2.96zM3 .27a1.55 1.55 0 0 0-.82 1.37v20.72c0 .58.3 1.08.82 1.36L13.3 12 3 .27zm10.65 3.33-9.47 8.64 3.64 3.62 5.83-12.26z" />
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
