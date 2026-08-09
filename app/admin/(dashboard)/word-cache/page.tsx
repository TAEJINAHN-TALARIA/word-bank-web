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
  // cacheLoad/volumes 조회 실패는 null로 구분해서 남긴다. []로 뭉개버리면 아래
  // getSearchFailureRates가 "검색량 0"으로 오인해 모든 언어쌍의 무의미 비율을
  // 100%로 잘못 계산해버리기 때문 (실패와 "데이터 없음"은 다른 상태). cacheLoad가
  // 실패해도 getSearchVolumeByLanguagePair([])는 자체 early-return으로 []를 정상
  // 반환해버려 실패가 묻히므로, cacheLoad 실패 시에는 volumes 조회 자체를 건너뛰고
  // null을 전파한다.
  const cacheLoad = await getCacheLoadByLanguage().catch((error) => {
    console.error("[word-cache] getCacheLoadByLanguage failed", error);
    return null;
  });
  const volumes =
    cacheLoad === null
      ? null
      : await getSearchVolumeByLanguagePair(cacheLoad).catch((error) => {
          console.error("[word-cache] getSearchVolumeByLanguagePair failed", error);
          return null;
        });
  const volumesAvailable = volumes !== null;
  const safeCacheLoad = cacheLoad ?? [];
  const safeVolumes = volumes ?? [];

  const [failureRates, localeDistribution, initialTopWords] = await Promise.all([
    volumesAvailable
      ? getSearchFailureRates(safeVolumes).catch((error) => {
          console.error("[word-cache] getSearchFailureRates failed", error);
          return [];
        })
      : Promise.resolve([]),
    getLocaleDistribution().catch((error) => {
      console.error("[word-cache] getLocaleDistribution failed", error);
      return [];
    }),
    safeVolumes.length > 0
      ? getTopWordsForPair(safeVolumes[0].wordLanguage, safeVolumes[0].meaningLanguage).catch((error) => {
          console.error("[word-cache] getTopWordsForPair failed", error);
          return [];
        })
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
            <WordCacheVolumeTable volumes={safeVolumes} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어쌍별 인기 단어</h2>
        <Card>
          <CardContent>
            <TopWordsPanel pairs={safeVolumes} initialWords={initialTopWords} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">언어별 캐시 적재량</h2>
        <Card>
          <CardContent>
            <CacheLoadByLanguageTable loads={safeCacheLoad} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">무의미 검색 비율</h2>
        <Card>
          <CardContent>
            <SearchFailureRateTable rates={failureRates} volumesAvailable={volumesAvailable} />
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
