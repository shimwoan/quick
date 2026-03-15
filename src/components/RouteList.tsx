import { useRouteStore } from '../stores/useRouteStore';
import type { DongScore } from '../types';
import { MIN_HOT_DONG_SCORE } from '../constants';

/** 0~100 스코어를 현실적 콜 예상 범위로 변환 */
function toCallRange(score: number): string {
  if (score >= 70) return '1~2';
  if (score >= 40) return '0~1';
  return '0';
}

interface RouteListProps {
  hotDongs: DongScore[];
}

export default function RouteList({ hotDongs }: RouteListProps) {
  const { recommendation, selectedRouteIndex, selectRoute } = useRouteStore();

  if (!recommendation) return null;

  const { shortest_route, recommendations } = recommendation;
  const filteredDongs = hotDongs.filter((d) => d.call_expectation >= MIN_HOT_DONG_SCORE);

  return (
    <div className="route-list">
      <h3 className="section-title">경로 추천 결과</h3>

      {/* 최단 경로 */}
      <div
        className={`route-card ${selectedRouteIndex === -1 ? 'route-card--selected' : ''}`}
        onClick={() => selectRoute(-1)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && selectRoute(-1)}
      >
        <div className="route-card-header">
          <span className="route-label route-label--shortest">최단경로</span>
        </div>
        <div className="route-card-body">
          <div className="route-stat">
            <span className="route-stat-value">{shortest_route.distance_km.toFixed(1)}</span>
            <span className="route-stat-unit">km</span>
          </div>
          <div className="route-stat">
            <span className="route-stat-value">{Math.round(shortest_route.time_min)}</span>
            <span className="route-stat-unit">분</span>
          </div>
        </div>
        {filteredDongs.length > 0 && (
          <div className="route-via-dongs">
            <span className="via-label">핫 지역 경유:</span>
            {filteredDongs.map((d) => (
              <span key={d.dong_code} className="via-dong-chip">{d.dong_name}</span>
            ))}
          </div>
        )}
      </div>

      {/* 추천 경로들 */}
      {recommendations.map((rec, idx) => (
        <div
          key={rec.rank}
          className={`route-card ${selectedRouteIndex === idx ? 'route-card--selected' : ''}`}
          onClick={() => selectRoute(idx)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && selectRoute(idx)}
        >
          <div className="route-card-header">
            <span className="route-label route-label--rec">
              {rec.label || `추천 ${rec.rank}`}
            </span>
            <span className="badge badge--time">+{rec.extra_time_min}분</span>
            <span className="badge badge--calls">
              콜 기대 {toCallRange(rec.total_call_expectation)}건
            </span>
          </div>
          <div className="route-card-body">
            <div className="route-stat">
              <span className="route-stat-value">{rec.distance_km.toFixed(1)}</span>
              <span className="route-stat-unit">km</span>
            </div>
            <div className="route-stat">
              <span className="route-stat-value">{Math.round(rec.time_min)}</span>
              <span className="route-stat-unit">분</span>
            </div>
          </div>
          {filteredDongs.length > 0 && (
            <div className="route-via-dongs">
              <span className="via-label">핫 지역 경유:</span>
              {filteredDongs.map((d) => (
                <span key={d.dong_code} className="via-dong-chip">{d.dong_name}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
