import {
  getCacheLoadByLanguage,
  getSearchVolumeByLanguagePair,
  getSearchFailureRates,
  getLocaleDistribution,
  getTopWordsForPair,
} from "@/lib/data/wordCacheStats";
import { WordCacheVolumeTable } from "@/components/admin/WordCacheVolumeTable";
import { CacheLoadByLanguageTable } from "@/components/admin/CacheLoadByLanguageTable";
import { SearchFailureRateTable } from "@/components/admin/SearchFailureRateTable";
import { LocaleDistributionChart } from "@/components/admin/LocaleDistributionChart";
import { TopWordsPanel } from "@/components/admin/TopWordsPanel";
import { Card, CardContent } from "@/components/ui/card";

// word_search_failures 카운터와 word_cache.locale 계측이 배포된 날짜.
// 이 날짜 이전에 캐시된 문서는 locale이 없고, 이 날짜 이전 무의미 검색은 집계되지 않았다.
const INSTRUMENTATION_START_DATE = "2026-08-08";

export default async function WordCacheStatsPage() {
  const cacheLoad = await getCacheLoadByLanguage().catch(() => []);
  const volumes = await getSearchVolumeByLanguagePair(cacheLoad).catch(() => []);
  const [failureRates, localeDistribution, initialTopWords] = await Promise.all([
    getSearchFailureRates(volumes).catch(() => []),
    getLocaleDistribution().catch(() => []),
    volumes.length > 0
      ? getTopWordsForPair(volumes[0].wordLanguage, volumes[0].meaningLanguage).catch(() => [])
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">단어캐시 현황</h1>
        <p className="text-sm text-muted-foreground">
          언어쌍별 검색 트렌드와 캐시 적재 현황을 확인하세요. 무의미 검색 비율과 locale 분포는{" "}
          {INSTRUMENTATION_START_DATE} 계측 시작 이후 데이터부터 반영됩니다.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어쌍별 검색량 랭킹</h2>
        <Card>
          <CardContent>
            <WordCacheVolumeTable volumes={volumes} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어쌍별 인기 단어</h2>
        <Card>
          <CardContent>
            <TopWordsPanel pairs={volumes} initialWords={initialTopWords} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어별 캐시 적재량</h2>
        <Card>
          <CardContent>
            <CacheLoadByLanguageTable loads={cacheLoad} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">무의미 검색 비율</h2>
        <Card>
          <CardContent>
            <SearchFailureRateTable rates={failureRates} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">locale 분포 (최근 검색 기준)</h2>
        <Card>
          <CardContent>
            <LocaleDistributionChart distribution={localeDistribution} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
