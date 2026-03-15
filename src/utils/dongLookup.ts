import type { DongHeatData } from '../hooks/useDongScores';
import { MIN_HOT_DONG_SCORE } from '../constants';

interface DongPolygon {
  guName: string;
  dongName: string;
  rings: [number, number][][]; // [lng, lat][]
}

let cachedPolygons: DongPolygon[] | null = null;

/** GeoJSON 로드 + 파싱 (캐시됨) */
async function loadPolygons(): Promise<DongPolygon[]> {
  if (cachedPolygons) return cachedPolygons;

  try {
    const res = await fetch('/seoul-dong.geojson');
    const geojson = await res.json();

    cachedPolygons = [];
    for (const feature of geojson.features) {
      const admNm = feature.properties.adm_nm as string;
      const parts = admNm.split(' ');
      const guName = parts[1] ?? '';
      const dongName = parts.slice(2).join(' ');

      const geom = feature.geometry;
      const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

      for (const polygon of polygons) {
        cachedPolygons.push({
          guName,
          dongName,
          rings: polygon,
        });
      }
    }
    return cachedPolygons;
  } catch {
    return [];
  }
}

/** Point-in-polygon (ray casting) */
function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][0], ring[i][1]]; // lng, lat
    const [xj, yj] = [ring[j][0], ring[j][1]];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 경로 path가 통과하는 핫동 목록 반환
 * GeoJSON 폴리곤으로 실제 경계 체크 (중심점 거리 X)
 */
export async function findDongsAlongPath(
  path: { lat: number; lng: number }[],
  heatmapDongs: DongHeatData[],
): Promise<DongHeatData[]> {
  const polygons = await loadPolygons();
  if (polygons.length === 0 || path.length === 0) return [];

  // path 샘플링 (매 5번째 점)
  const sampled: { lat: number; lng: number }[] = [];
  for (let i = 0; i < path.length; i += 5) sampled.push(path[i]);
  if (sampled[sampled.length - 1] !== path[path.length - 1]) sampled.push(path[path.length - 1]);

  // 경로가 통과하는 동 이름 수집
  const passedDongs = new Set<string>();

  for (const point of sampled) {
    for (const poly of polygons) {
      // outer ring만 체크 (holes 무시)
      if (pointInRing(point.lat, point.lng, poly.rings[0])) {
        passedDongs.add(`${poly.guName} ${poly.dongName}`);
      }
    }
  }

  // heatmapDongs에서 매칭 (gu_name + dong_name)
  const result: DongHeatData[] = [];
  const seen = new Set<string>();

  for (const dong of heatmapDongs) {
    if (dong.call_expectation < MIN_HOT_DONG_SCORE) continue;
    if (seen.has(dong.dong_code)) continue;

    const key = `${dong.gu_name} ${dong.dong_name}`;
    // 정확 매칭
    if (passedDongs.has(key)) {
      seen.add(dong.dong_code);
      result.push(dong);
      continue;
    }
    // 부분 매칭 (숫자동 등)
    for (const passed of passedDongs) {
      if (passed.startsWith(dong.gu_name) && (
        passed.includes(dong.dong_name.replace(/\d+동$/, '')) ||
        dong.dong_name.includes(passed.split(' ')[1]?.replace(/동$/, '') ?? '___')
      )) {
        seen.add(dong.dong_code);
        result.push(dong);
        break;
      }
    }
  }

  return result.sort((a, b) => b.call_expectation - a.call_expectation);
}
