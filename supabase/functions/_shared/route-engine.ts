// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteWaypoint {
  lat: number;
  lng: number;
  type: "current" | "pickup" | "dropoff" | "hot_zone";
  order_id?: string;
  dong?: string;
}

export interface DongScore {
  dong_code: string;
  dong_name: string;
  call_expectation: number;
  extra_time_min?: number;
}

interface HotDong extends DongScore {
  center_point: LatLng;
}

// 실제 경로 기준 필터된 핫동 (내부 사용)
interface RankedHotDong extends HotDong {
  routeIndex: number;     // base route path에서 가장 가까운 점의 인덱스 (경로 순서)
  distToRouteKm: number;  // 실제 경로까지의 거리(km)
}

export interface Route {
  distance_km: number;
  time_min: number;
  waypoints: RouteWaypoint[];
  path: LatLng[];
}

export interface RecommendedRoute extends Route {
  rank: number;
  label: string;
  extra_time_min: number;
  total_call_expectation: number;
  via_dongs: DongScore[];
}

export interface RouteRecommendation {
  shortest_route: Route;
  recommendations: RecommendedRoute[];
  nearby_hot_dongs: DongScore[];
}

export interface TypedWaypoint {
  location: LatLng;
  type: "pickup" | "dropoff";
  order_id: string;
}

// ---------------------------------------------------------------------------
// Naver Directions API (Directions 5 — 경유지 최대 5개)
// ---------------------------------------------------------------------------

const NAVER_DIRECTIONS_URL =
  "https://maps.apigw.ntruss.com/map-direction/v1/driving";

function latlngToNaverParam(p: LatLng): string {
  return `${p.lng},${p.lat}`;
}

interface NaverResult {
  duration_ms: number;
  distance_m: number;
  path: LatLng[];
}

async function callNaverDirections(
  start: LatLng,
  goal: LatLng,
  waypoints?: LatLng[],
): Promise<NaverResult> {
  const clientId = Deno.env.get("NAVER_MAP_CLIENT_ID")!;
  const clientSecret = Deno.env.get("NAVER_MAP_CLIENT_SECRET")!;

  const params = new URLSearchParams({
    start: latlngToNaverParam(start),
    goal: latlngToNaverParam(goal),
  });

  if (waypoints && waypoints.length > 0) {
    const limited = waypoints.slice(0, 5);
    params.set("waypoints", limited.map(latlngToNaverParam).join("|"));
  }

  const url = `${NAVER_DIRECTIONS_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver API error (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.code !== 0 || !data.route?.traoptimal?.[0]) {
    throw new Error(`Naver API returned no route: ${JSON.stringify(data)}`);
  }

  const route = data.route.traoptimal[0];
  return {
    duration_ms: route.summary.duration,
    distance_m: route.summary.distance,
    path: (route.path as [number, number][]).map(([lng, lat]) => ({ lat, lng })),
  };
}

// ---------------------------------------------------------------------------
// 실제 도로 경로(base path) 기준 핫동 필터링 + 정렬
//
// 핵심: 직선 축이 아닌 Naver가 반환한 실제 도로 경로를 기준으로
// 가까운 동만 선별하고, 경로 진행 순서대로 정렬한다.
// → 여의도동처럼 직선으로는 가깝지만 도로상 우회가 필요한 동이 자연스럽게 제외됨
// ---------------------------------------------------------------------------

function filterHotDongsAlongBasePath(
  basePath: LatLng[],
  start: LatLng,
  goal: LatLng,
  hotDongs: HotDong[],
): RankedHotDong[] {
  const MAX_DIST_TO_ROUTE_KM = 2.0; // 프론트 constants.ts의 MAX_DONG_ROUTE_DIST_KM과 동일하게 유지
  const MAX_DETOUR_RATIO = 1.3;

  const directKm = haversineKm(start, goal);
  if (directKm < 0.1) return [];

  const sampled = samplePath(basePath, 50);
  const result: RankedHotDong[] = [];

  for (const dong of hotDongs) {
    // 1. 실제 경로에서 가장 가까운 점 찾기
    let minDist = Infinity;
    let minIdx = 0;
    for (let i = 0; i < sampled.length; i++) {
      const d = haversineKm(dong.center_point, sampled[i]);
      if (d < minDist) {
        minDist = d;
        minIdx = i;
      }
    }

    // 필터 1: 실제 도로 경로에서 너무 먼 동 제외
    if (minDist > MAX_DIST_TO_ROUTE_KM) continue;

    // 필터 2: 출발지 근처(5% 이내)만 제외
    const progressRatio = minIdx / Math.max(sampled.length - 1, 1);
    if (progressRatio < 0.05) continue;

    // 필터 3: 우회 비율 체크
    const detourKm = haversineKm(start, dong.center_point) + haversineKm(dong.center_point, goal);
    if (detourKm / directKm > MAX_DETOUR_RATIO) continue;

    result.push({
      ...dong,
      routeIndex: minIdx,
      distToRouteKm: minDist,
    });
  }

  // 경로 진행 순서(routeIndex)로 정렬
  result.sort((a, b) => a.routeIndex - b.routeIndex);

  return result;
}

/**
 * 경유지들을 실제 base route path 기준으로 순서 정렬
 * 각 경유지에서 base path의 가장 가까운 점 인덱스를 구하고, 그 순서대로 정렬
 */
function sortWaypointsAlongBasePath(
  basePath: LatLng[],
  waypoints: LatLng[],
): LatLng[] {
  const sampled = samplePath(basePath, 50);

  const withIndex = waypoints.map((wp) => {
    let minIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < sampled.length; i++) {
      const d = haversineKm(wp, sampled[i]);
      if (d < minDist) {
        minDist = d;
        minIdx = i;
      }
    }
    return { wp, routeIdx: minIdx };
  });

  withIndex.sort((a, b) => a.routeIdx - b.routeIdx);
  return withIndex.map((w) => w.wp);
}

// ---------------------------------------------------------------------------
// Sort order waypoints: 최단 경로 순열 탐색 (인터리빙 허용)
//
// 제약: 각 오더의 pickup은 반드시 dropoff보다 먼저 방문
// 2~3개 오더(4~6 웨이포인트)는 모든 유효 순열을 평가해도 충분히 빠름
// 예) P1→P2→D1→D2 같은 교차 경로가 P1→D1→P2→D2보다 짧으면 채택
// ---------------------------------------------------------------------------

export function sortWaypointsForward(
  currentLocation: LatLng,
  _heading: number,
  waypoints: TypedWaypoint[],
): TypedWaypoint[] {
  if (waypoints.length <= 1) return waypoints;

  // pickup이 있는 order_id 목록 (dropoff만 있는 건 이미 픽업 완료)
  const pickupOrders = new Set<string>();
  for (const wp of waypoints) {
    if (wp.type === "pickup") pickupOrders.add(wp.order_id);
  }

  // 유효한 순열인지 체크: 각 오더의 pickup이 dropoff보다 먼저
  function isValid(perm: TypedWaypoint[]): boolean {
    const pickedUp = new Set<string>();
    for (const wp of perm) {
      if (wp.type === "pickup") {
        pickedUp.add(wp.order_id);
      } else if (wp.type === "dropoff") {
        // pickup이 있는 오더인데 아직 픽업 안 했으면 무효
        if (pickupOrders.has(wp.order_id) && !pickedUp.has(wp.order_id)) {
          return false;
        }
      }
    }
    return true;
  }

  // 총 이동 거리 계산
  function totalDistance(perm: TypedWaypoint[]): number {
    let dist = haversineKm(currentLocation, perm[0].location);
    for (let i = 1; i < perm.length; i++) {
      dist += haversineKm(perm[i - 1].location, perm[i].location);
    }
    return dist;
  }

  // 모든 순열 생성 (N이 작으므로 OK: 4!=24, 6!=720)
  function permutations(arr: TypedWaypoint[]): TypedWaypoint[][] {
    if (arr.length <= 1) return [arr];
    const result: TypedWaypoint[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const perm of permutations(rest)) {
        result.push([arr[i], ...perm]);
      }
    }
    return result;
  }

  // 웨이포인트가 너무 많으면 (7개+) 기존 방식 fallback
  if (waypoints.length > 6) {
    return fallbackSort(currentLocation, waypoints, pickupOrders);
  }

  // 모든 유효 순열 중 최단 거리 선택
  let bestPerm = waypoints;
  let bestDist = Infinity;

  for (const perm of permutations(waypoints)) {
    if (!isValid(perm)) continue;
    const dist = totalDistance(perm);
    if (dist < bestDist) {
      bestDist = dist;
      bestPerm = perm;
    }
  }

  return bestPerm;
}

/** 웨이포인트가 많을 때 fallback: nearest-neighbor + pickup 선행 제약 */
function fallbackSort(
  currentLocation: LatLng,
  waypoints: TypedWaypoint[],
  pickupOrders: Set<string>,
): TypedWaypoint[] {
  const remaining = [...waypoints];
  const result: TypedWaypoint[] = [];
  const pickedUp = new Set<string>();
  let current = currentLocation;

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const wp = remaining[i];
      // dropoff인데 아직 pickup 안 했으면 스킵
      if (wp.type === "dropoff" && pickupOrders.has(wp.order_id) && !pickedUp.has(wp.order_id)) {
        continue;
      }
      const d = haversineKm(current, wp.location);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break; // 불가능한 경우 방지
    const chosen = remaining.splice(bestIdx, 1)[0];
    if (chosen.type === "pickup") pickedUp.add(chosen.order_id);
    result.push(chosen);
    current = chosen.location;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Generate waypoint combinations
//
// 핵심 원칙: 각 핫동을 개별 추천으로 제공.
// 멀리 떨어진 동들을 한 추천에 묶으면 다리/강 횡단 왕복 등 역행이 발생하므로
// 인접한 동(center 간 거리 1.5km 이내)끼리만 묶는다.
// ---------------------------------------------------------------------------

function generateWaypointCombinations(
  rankedHotDongs: RankedHotDong[],
  maxCombinations: number,
): { dongs: RankedHotDong[] }[] {
  if (rankedHotDongs.length === 0) return [];

  const byScore = [...rankedHotDongs].sort((a, b) => b.call_expectation - a.call_expectation);
  const combos: { dongs: RankedHotDong[]; score: number }[] = [];

  // 1. 각 핫동을 개별 추천으로 (역행 위험 없음)
  for (const dong of byScore) {
    combos.push({ dongs: [dong], score: dong.call_expectation });
  }

  // 2. 인접한 동 쌍만 묶기 (center 간 1.5km 이내)
  const ADJACENT_KM = 1.5;
  for (let i = 0; i < byScore.length; i++) {
    for (let j = i + 1; j < byScore.length; j++) {
      const dist = haversineKm(byScore[i].center_point, byScore[j].center_point);
      if (dist <= ADJACENT_KM) {
        const pair = [byScore[i], byScore[j]].sort((a, b) => a.routeIndex - b.routeIndex);
        combos.push({
          dongs: pair,
          score: pair.reduce((s, d) => s + d.call_expectation, 0),
        });
      }
    }
  }

  // 점수 순 정렬 후 상위 N개 반환
  combos.sort((a, b) => b.score - a.score);

  // 중복 제거 (동일 dong_code 조합)
  const seen = new Set<string>();
  const unique: { dongs: RankedHotDong[] }[] = [];
  for (const combo of combos) {
    const key = combo.dongs.map((d) => d.dong_code).sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ dongs: combo.dongs });
    if (unique.length >= maxCombinations) break;
  }

  return unique;
}

// ---------------------------------------------------------------------------
// Build full route recommendation
// ---------------------------------------------------------------------------

export async function buildRouteRecommendation(
  currentLocation: LatLng,
  heading: number,
  typedWaypoints: TypedWaypoint[],
  allHotDongs: HotDong[],
  maxRecommendations: number = 3,
): Promise<RouteRecommendation> {
  // 1. Sort order waypoints (pickup → dropoff 순서 보장)
  const orderedWps = sortWaypointsForward(currentLocation, heading, typedWaypoints);

  const naverWaypoints = orderedWps
    .map((wp) => wp.location)
    .filter((loc) => haversineKm(currentLocation, loc) > 0.05);

  if (naverWaypoints.length === 0) {
    const dropoff = orderedWps.find((wp) => wp.type === "dropoff");
    if (dropoff) naverWaypoints.push(dropoff.location);
  }

  const goal = naverWaypoints[naverWaypoints.length - 1];
  const orderIntermediates = naverWaypoints.slice(0, -1);

  // 2. 최단경로 (base route) — 이 경로의 path를 핫동 필터링 기준으로 사용
  const baseResult = await callNaverDirections(
    currentLocation,
    goal,
    orderIntermediates.length > 0 ? orderIntermediates : undefined,
  );

  const baseTimeMin = Math.round(baseResult.duration_ms / 60000);
  const baseDistKm = Math.round(baseResult.distance_m / 1000 * 10) / 10;

  const shortestWaypoints: RouteWaypoint[] = [
    { lat: currentLocation.lat, lng: currentLocation.lng, type: "current" },
  ];
  for (const wp of orderedWps) {
    shortestWaypoints.push({
      lat: wp.location.lat,
      lng: wp.location.lng,
      type: wp.type,
      order_id: wp.order_id,
    });
  }

  const shortestRoute: Route = {
    distance_km: baseDistKm,
    time_min: baseTimeMin,
    waypoints: shortestWaypoints,
    path: baseResult.path,
  };

  // 3. 핵심: 실제 도로 경로(base path)를 기준으로 핫동 필터링 + 경로 순서 정렬
  //    직선 축이 아닌 Naver가 반환한 실제 도로 경로에서 가까운 동만 선별
  //    → 여의도동처럼 직선으로는 가깝지만 도로상 먼 동이 자연스럽게 제외됨
  const rankedHotDongs = filterHotDongsAlongBasePath(
    baseResult.path,
    currentLocation,
    goal,
    allHotDongs.filter((d) => d.call_expectation >= 40), // 프론트 constants.ts의 MIN_HOT_DONG_SCORE과 동일하게 유지
  );

  // 4. 추가 소요시간 추정
  for (const dong of rankedHotDongs) {
    const detourKm = estimateDetourKm(currentLocation, goal, dong.center_point);
    dong.extra_time_min = Math.round((detourKm / 30) * 60);
  }

  // 5. 경유지 조합 생성 (경로 순서 유지됨)
  const combos = generateWaypointCombinations(rankedHotDongs, maxRecommendations);
  const recommendations: RecommendedRoute[] = [];

  for (let i = 0; i < combos.length; i++) {
    const combo = combos[i];

    // 핵심: 동의 center_point를 그대로 경유지로 쓰지 않고,
    // base route에서 동 방향으로 살짝(30%)만 벗어난 "넛지 포인트"를 사용.
    // → 그 동 근처를 자연스럽게 지나가되, center까지 갈 필요 없음
    const nudgePoints = combo.dongs.map((dong) => {
      const nearest = findNearestPointOnPath(baseResult.path, dong.center_point);
      // base route의 가장 가까운 점에서 동 center 방향으로 30%만 이동
      const NUDGE_RATIO = 0.3;
      return {
        lat: nearest.lat + (dong.center_point.lat - nearest.lat) * NUDGE_RATIO,
        lng: nearest.lng + (dong.center_point.lng - nearest.lng) * NUDGE_RATIO,
      };
    });

    // 오더 경유지 + 넛지 포인트를 합쳐서 실제 경로 순서로 정렬
    const allIntermediates = sortWaypointsAlongBasePath(
      baseResult.path,
      [...orderIntermediates, ...nudgePoints],
    );

    const viaDongs: DongScore[] = combo.dongs.map((d) => ({
      dong_code: d.dong_code,
      dong_name: d.dong_name,
      call_expectation: d.call_expectation,
      extra_time_min: d.extra_time_min,
    }));

    const totalCallExpectation = combo.dongs.reduce(
      (sum, d) => sum + d.call_expectation, 0,
    );

    const recWaypoints: RouteWaypoint[] = [
      { lat: currentLocation.lat, lng: currentLocation.lng, type: "current" },
    ];
    for (const wp of orderedWps) {
      recWaypoints.push({
        lat: wp.location.lat,
        lng: wp.location.lng,
        type: wp.type,
        order_id: wp.order_id,
      });
    }
    for (const dong of combo.dongs) {
      recWaypoints.push({
        lat: dong.center_point.lat,
        lng: dong.center_point.lng,
        type: "hot_zone",
        dong: dong.dong_name,
      });
    }

    try {
      const recResult = await callNaverDirections(
        currentLocation,
        goal,
        allIntermediates.length > 0 ? allIntermediates : undefined,
      );

      const recTimeMin = Math.round(recResult.duration_ms / 60000);
      const recDistKm = Math.round(recResult.distance_m / 1000 * 10) / 10;

      recommendations.push({
        rank: i + 1,
        label: `추천 ${i + 1}`,
        distance_km: recDistKm,
        time_min: recTimeMin,
        extra_time_min: recTimeMin - baseTimeMin,
        total_call_expectation: totalCallExpectation,
        via_dongs: viaDongs,
        waypoints: recWaypoints,
        path: recResult.path,
      });
    } catch (err) {
      console.error(`Recommendation ${i + 1} failed:`, err);
    }
  }

  // 비정상 추천 제거: 최단경로보다 짧거나 추가시간이 0 이하인 경로
  const valid = recommendations.filter((r) =>
    r.distance_km > baseDistKm && r.extra_time_min > 0
  );

  // 가성비(콜기대/추가시간) 순 정렬
  valid.sort((a, b) => {
    const ratioA = a.total_call_expectation / a.extra_time_min;
    const ratioB = b.total_call_expectation / b.extra_time_min;
    return ratioB - ratioA;
  });

  // 추천1 기본 제공. 추천2는 경유 핫동이 다를 때만 (최대 2개)
  const filtered: RecommendedRoute[] = [];
  if (valid.length > 0) {
    filtered.push(valid[0]);

    const first = new Set(valid[0].via_dongs.map((d) => d.dong_code));
    for (let i = 1; i < valid.length; i++) {
      const hasDifferentDong = valid[i].via_dongs.some((d) => !first.has(d.dong_code));
      if (hasDifferentDong) {
        filtered.push(valid[i]);
        break;
      }
    }
  }

  filtered.forEach((r, idx) => {
    r.rank = idx + 1;
    r.label = `추천 ${idx + 1}`;
  });

  const nearbyHotDongs: DongScore[] = rankedHotDongs
    .sort((a, b) => b.call_expectation - a.call_expectation)
    .map((d) => ({
      dong_code: d.dong_code,
      dong_name: d.dong_name,
      call_expectation: d.call_expectation,
      extra_time_min: d.extra_time_min,
    }));

  return {
    shortest_route: shortestRoute,
    recommendations: filtered,
    nearby_hot_dongs: nearbyHotDongs,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** path에서 target에 가장 가까운 점을 찾아 반환 */
function findNearestPointOnPath(path: LatLng[], target: LatLng): LatLng {
  let minDist = Infinity;
  let nearest = path[0];
  for (const p of path) {
    const d = quickDist(p, target);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  }
  return nearest;
}

/** 빠른 거리 비교용 (정렬/비교에만 사용, 실제 km 아님) */
function quickDist(a: LatLng, b: LatLng): number {
  const dlat = a.lat - b.lat;
  const dlng = a.lng - b.lng;
  return dlat * dlat + dlng * dlng;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function estimateDetourKm(start: LatLng, end: LatLng, via: LatLng): number {
  const direct = haversineKm(start, end);
  const detour = haversineKm(start, via) + haversineKm(via, end);
  return Math.max(0, detour - direct);
}

function samplePath(path: LatLng[], maxPoints: number): LatLng[] {
  if (path.length <= maxPoints) return path;
  const step = Math.ceil(path.length / maxPoints);
  const sampled: LatLng[] = [];
  for (let i = 0; i < path.length; i += step) sampled.push(path[i]);
  if (sampled[sampled.length - 1] !== path[path.length - 1]) sampled.push(path[path.length - 1]);
  return sampled;
}
