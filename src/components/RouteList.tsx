import { useMemo } from 'react';
import { useRouteStore } from '../stores/useRouteStore';
import type { DongScore, Route, LatLng } from '../types';
import type { DongHeatData } from '../hooks/useDongScores';
import { MIN_HOT_DONG_SCORE, MAX_DONG_ROUTE_DIST_KM } from '../constants';

/** 0~100 스코어를 현실적 콜 예상 범위로 변환 */
function toCallRange(score: number): string {
  if (score >= 70) return '1~2';
  if (score >= 40) return '0~1';
  return '0';
}

/** 두 점 사이 거리(km) 근사 */
function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dlat = (a.lat - b.lat) * 111;
  const dlng = (a.lng - b.lng) * 88;
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

/** 경로 path에서 MAX_DONG_ROUTE_DIST_KM 이내인 동만 필터 */
function filterDongsNearPath(
  path: LatLng[] | undefined,
  hotDongs: DongScore[],
  heatmapDongs: DongHeatData[],
): DongScore[] {
  if (!path || path.length === 0) return hotDongs;

  // path를 샘플링 (매 10번째 점)
  const sampled: LatLng[] = [];
  for (let i = 0; i < path.length; i += 10) sampled.push(path[i]);
  if (sampled[sampled.length - 1] !== path[path.length - 1]) sampled.push(path[path.length - 1]);

  return hotDongs.filter((dong) => {
    if (dong.call_expectation < MIN_HOT_DONG_SCORE) return false;
    // heatmapDongs에서 좌표 찾기
    const heat = heatmapDongs.find((h) => h.dong_code === dong.dong_code);
    if (!heat) return false;

    for (const p of sampled) {
      if (distKm(p, heat) <= MAX_DONG_ROUTE_DIST_KM) return true;
    }
    return false;
  });
}

interface RouteListProps {
  hotDongs: DongScore[];
  heatmapDongs: DongHeatData[];
}

export default function RouteList({ hotDongs, heatmapDongs }: RouteListProps) {
  const { recommendation, selectedRouteIndex, selectRoute } = useRouteStore();

  if (!recommendation) return null;

  const { shortest_route, recommendations } = recommendation;

  return (
    <div className="route-list">
      <h3 className="section-title">경로 추천 결과</h3>

      {/* 최단 경로 */}
      <RouteCard
        route={shortest_route}
        selected={selectedRouteIndex === -1}
        onSelect={() => selectRoute(-1)}
        label={<span className="route-label route-label--shortest">최단경로</span>}
        hotDongs={hotDongs}
        heatmapDongs={heatmapDongs}
      />

      {/* 추천 경로들 */}
      {recommendations.map((rec, idx) => (
        <RouteCard
          key={rec.rank}
          route={rec}
          selected={selectedRouteIndex === idx}
          onSelect={() => selectRoute(idx)}
          label={
            <>
              <span className="route-label route-label--rec">
                {rec.label || `추천 ${rec.rank}`}
              </span>
              <span className="badge badge--time">+{rec.extra_time_min}분</span>
              <span className="badge badge--calls">
                콜 기대 {toCallRange(rec.total_call_expectation)}건
              </span>
            </>
          }
          hotDongs={hotDongs}
          heatmapDongs={heatmapDongs}
        />
      ))}
    </div>
  );
}

function RouteCard({
  route,
  selected,
  onSelect,
  label,
  hotDongs,
  heatmapDongs,
}: {
  route: Route;
  selected: boolean;
  onSelect: () => void;
  label: React.ReactNode;
  hotDongs: DongScore[];
  heatmapDongs: DongHeatData[];
}) {
  // 이 경로의 실제 path 기준으로 가까운 핫동만 필터
  const nearbyDongs = useMemo(
    () => filterDongsNearPath(route.path, hotDongs, heatmapDongs),
    [route.path, hotDongs, heatmapDongs],
  );

  return (
    <div
      className={`route-card ${selected ? 'route-card--selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <div className="route-card-header">{label}</div>
      <div className="route-card-body">
        <div className="route-stat">
          <span className="route-stat-value">{route.distance_km.toFixed(1)}</span>
          <span className="route-stat-unit">km</span>
        </div>
        <div className="route-stat">
          <span className="route-stat-value">{Math.round(route.time_min)}</span>
          <span className="route-stat-unit">분</span>
        </div>
      </div>
      {nearbyDongs.length > 0 && (
        <div className="route-via-dongs">
          <span className="via-label">핫 지역 경유:</span>
          {nearbyDongs.map((d) => (
            <span key={d.dong_code} className="via-dong-chip">
              {d.dong_name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
