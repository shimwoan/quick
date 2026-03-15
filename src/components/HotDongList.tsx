import type { DongScore } from '../types';

interface HotDongListProps {
  dongs: DongScore[];
}

function getBarColor(score: number, maxScore: number): string {
  const ratio = score / Math.max(maxScore, 1);
  if (ratio >= 0.8) return '#dc2626';
  if (ratio >= 0.6) return '#ea580c';
  if (ratio >= 0.4) return '#f59e0b';
  if (ratio >= 0.2) return '#fb923c';
  return '#fdba74';
}

export default function HotDongList({ dongs }: HotDongListProps) {
  if (!dongs || dongs.length === 0) return null;

  const sorted = [...dongs].sort(
    (a, b) => b.call_expectation - a.call_expectation
  );
  const maxScore = sorted[0]?.call_expectation ?? 1;

  return (
    <div className="hot-dong-list">
      <h3 className="section-title">인근 핫 지역</h3>

      {sorted.map((dong) => {
        const pct = Math.round((dong.call_expectation / maxScore) * 100);
        const color = getBarColor(dong.call_expectation, maxScore);

        return (
          <div key={dong.dong_code} className="hot-dong-item">
            <div className="hot-dong-info">
              <span className="hot-dong-name">{dong.dong_name}</span>
              {dong.extra_time_min !== undefined && (
                <span className="badge badge--time">
                  +{dong.extra_time_min}분
                </span>
              )}
            </div>
            <div className="hot-dong-bar-container">
              <div
                className="hot-dong-bar"
                style={{ width: `${pct}%`, background: color }}
              />
              <span className="hot-dong-score">{dong.call_expectation >= 70 ? '1~2건' : dong.call_expectation >= 40 ? '0~1건' : '-'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
