import { useState, useEffect } from 'react';
import { useRouteStore } from '../stores/useRouteStore';
import type { Route } from '../types';
import type { DongHeatData } from '../hooks/useDongScores';
import { findDongsAlongPath } from '../utils/dongLookup';

/** 0~100 스코어를 현실적 콜 예상 범위로 변환 */
function toCallRange(score: number): string {
  if (score >= 70) return '1~2';
  if (score >= 40) return '0~1';
  return '0';
}

interface RouteListProps {
  heatmapDongs: DongHeatData[];
}

export default function RouteList({ heatmapDongs }: RouteListProps) {
  const { recommendation, selectedRouteIndex, selectRoute } = useRouteStore();

  if (!recommendation) return null;

  const { shortest_route, recommendations } = recommendation;

  return (
    <div className="route-list">
      <h3 className="section-title">경로 추천 결과</h3>

      <RouteCard
        route={shortest_route}
        selected={selectedRouteIndex === -1}
        onSelect={() => selectRoute(-1)}
        heatmapDongs={heatmapDongs}
        label={<span className="route-label route-label--shortest">최단경로</span>}
        labelPrefix="인근 핫 지역:"
      />

      {recommendations.map((rec, idx) => (
        <RouteCard
          key={rec.rank}
          route={rec}
          selected={selectedRouteIndex === idx}
          onSelect={() => selectRoute(idx)}
          heatmapDongs={heatmapDongs}
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
          labelPrefix="핫 지역 경유:"
        />
      ))}
    </div>
  );
}

function RouteCard({
  route,
  selected,
  onSelect,
  heatmapDongs,
  label,
  labelPrefix,
}: {
  route: Route;
  selected: boolean;
  onSelect: () => void;
  heatmapDongs: DongHeatData[];
  label: React.ReactNode;
  labelPrefix: string;
}) {
  // GeoJSON 폴리곤으로 경로가 실제로 통과하는 핫동 체크
  const [passedDongs, setPassedDongs] = useState<DongHeatData[]>([]);

  useEffect(() => {
    if (!route.path || route.path.length === 0) {
      setPassedDongs([]);
      return;
    }
    findDongsAlongPath(route.path, heatmapDongs).then(setPassedDongs);
  }, [route.path, heatmapDongs]);

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
      {passedDongs.length > 0 && (
        <div className="route-via-dongs">
          <span className="via-label">{labelPrefix}</span>
          {passedDongs.map((d) => (
            <span key={d.dong_code} className="via-dong-chip">{d.dong_name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
