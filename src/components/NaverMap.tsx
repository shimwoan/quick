import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { Route, DongScore, LatLng } from '../types';
import type { DongHeatData } from '../hooks/useDongScores';

export interface NaverMapHandle {
  fitToRoutes: () => void;
}

declare global {
  interface Window {
    naver: any;
  }
}

interface NaverMapProps {
  routes: Route[];
  selectedRouteIndex: number | null;
  hotDongs: DongScore[];
  currentLocation: LatLng | null;
  heatmapDongs?: DongHeatData[];
}

const NAVER_MAP_CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string;
const SEOUL_CENTER = { lat: 37.5665, lng: 126.978 };

function loadNaverMapScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.naver?.maps) {
      resolve();
      return;
    }

    const existing = document.getElementById('naver-map-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      return;
    }

    const script = document.createElement('script');
    script.id = 'naver-map-script';
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_MAP_CLIENT_ID}&submodules=geocoder`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('네이버 지도 스크립트 로드 실패'));
    document.head.appendChild(script);
  });
}

// 콜 기대지수에 따른 색상 (0~100)
function getHeatColor(score: number): string {
  if (score >= 80) return '#dc2626';
  if (score >= 60) return '#ea580c';
  if (score >= 40) return '#f59e0b';
  if (score >= 20) return '#fb923c';
  return '#fdba74';
}

function getHeatOpacity(score: number): number {
  if (score >= 80) return 0.55;
  if (score >= 60) return 0.45;
  if (score >= 40) return 0.35;
  if (score >= 20) return 0.25;
  return 0.15;
}

const NaverMap = forwardRef<NaverMapHandle, NaverMapProps>(function NaverMap({
  routes,
  selectedRouteIndex,
  hotDongs,
  currentLocation,
  heatmapDongs,
}, ref) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);
  const heatmapMarkersRef = useRef<any[]>([]);

  // 외부에서 호출: 경로 전체가 보이도록 지도 bounds 맞춤 (하단 패널 고려하여 위로 오프셋)
  useImperativeHandle(ref, () => ({
    fitToRoutes: () => {
      const map = mapInstanceRef.current;
      if (!map || !window.naver?.maps || routes.length === 0) return;

      const nMaps = window.naver.maps;
      const bounds = new nMaps.LatLngBounds();

      for (const route of routes) {
        // path(실제 도로 경로)가 있으면 사용
        const points = route.path && route.path.length > 0 ? route.path : route.waypoints;
        for (const p of points) {
          bounds.extend(new nMaps.LatLng(p.lat, p.lng));
        }
      }

      if (bounds.isEmpty()) return;

      // 하단 패널이 화면의 약 40%를 차지하므로, bounds 아래쪽을 확장하여 경로가 위로 올라오게 함
      const sw = bounds.getSW();
      const ne = bounds.getNE();
      const latSpan = ne.lat() - sw.lat();
      const paddedSW = new nMaps.LatLng(sw.lat() - latSpan * 0.5, sw.lng());
      bounds.extend(paddedSW);

      map.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 });
    },
  }), [routes]);

  // 지도 초기화
  useEffect(() => {
    let cancelled = false;

    loadNaverMapScript().then(() => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;

      const center = currentLocation
        ? new window.naver.maps.LatLng(currentLocation.lat, currentLocation.lng)
        : new window.naver.maps.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng);

      mapInstanceRef.current = new window.naver.maps.Map(mapRef.current, {
        center,
        zoom: 14,
        zoomControl: true,
        zoomControlOptions: {
          position: window.naver.maps.Position.RIGHT_CENTER,
          style: window.naver.maps.ZoomControlStyle.SMALL,
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 오버레이 정리
  const clearOverlays = useCallback(() => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
  }, []);

  // 현재 위치 변경 시 마커만 업데이트 (지도 자동 이동 없음)

  // 마커 + 폴리라인 그리기
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.naver?.maps) return;

    clearOverlays();
    const nMaps = window.naver.maps;

    // 현재 위치 마커
    if (currentLocation) {
      const marker = new nMaps.Marker({
        position: new nMaps.LatLng(currentLocation.lat, currentLocation.lng),
        map,
        icon: {
          content: `<div style="
            width:18px;height:18px;
            background:#3b82f6;
            border:3px solid #fff;
            border-radius:50%;
            box-shadow:0 0 8px rgba(59,130,246,0.5);
          "></div>`,
          anchor: new nMaps.Point(9, 9),
        },
        zIndex: 100,
      });
      markersRef.current.push(marker);
    }

    // 경로 폴리라인
    routes.forEach((route, idx) => {
      // path(실제 도로 경로)가 있으면 사용, 없으면 waypoints fallback
      const pathPoints = route.path && route.path.length > 0
        ? route.path.map((p) => new nMaps.LatLng(p.lat, p.lng))
        : route.waypoints.map((wp) => new nMaps.LatLng(wp.lat, wp.lng));

      if (pathPoints.length < 2) return;
      const path = pathPoints;

      let strokeColor = '#d1d5db'; // 기본: 연한 회색
      let strokeOpacity = 0.5;
      let strokeWeight = 3;
      let zIndex = 1;

      if (selectedRouteIndex === -1 && idx === 0) {
        // 최단경로 선택
        strokeColor = '#6b7280';
        strokeOpacity = 0.9;
        strokeWeight = 5;
        zIndex = 10;
      } else if (
        selectedRouteIndex !== null &&
        selectedRouteIndex >= 0 &&
        idx === selectedRouteIndex + 1
      ) {
        // 추천경로 선택
        strokeColor = '#3b82f6';
        strokeOpacity = 0.9;
        strokeWeight = 5;
        zIndex = 10;
      }

      const polyline = new nMaps.Polyline({
        map,
        path,
        strokeColor,
        strokeOpacity,
        strokeWeight,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        zIndex,
      });
      polylinesRef.current.push(polyline);

      // 웨이포인트 마커 (pickup / dropoff)
      route.waypoints.forEach((wp) => {
        if (wp.type === 'pickup' || wp.type === 'dropoff') {
          const isPickup = wp.type === 'pickup';
          const marker = new nMaps.Marker({
            position: new nMaps.LatLng(wp.lat, wp.lng),
            map,
            icon: {
              content: `<div style="
                display:flex;align-items:center;justify-content:center;
                width:28px;height:28px;
                background:${isPickup ? '#22c55e' : '#ef4444'};
                color:#fff;font-size:13px;font-weight:700;
                border-radius:50%;border:2px solid #fff;
                box-shadow:0 2px 6px rgba(0,0,0,0.3);
              ">${isPickup ? 'P' : 'D'}</div>`,
              anchor: new nMaps.Point(14, 14),
            },
            zIndex: 50,
          });
          markersRef.current.push(marker);
        }
      });
    });

    // 핫동 마커: heatmapDongs에서 좌표를 찾아 nearby_hot_dongs 전체 표시
    if (heatmapDongs && heatmapDongs.length > 0) {
      hotDongs.forEach((dong) => {
        const heatDong = heatmapDongs.find((h) => h.dong_code === dong.dong_code);
        if (!heatDong) return;

        const color = getHeatColor(dong.call_expectation);
        const marker = new nMaps.Marker({
          position: new nMaps.LatLng(heatDong.lat, heatDong.lng),
          map,
          icon: {
            content: `<div style="
              display:flex;flex-direction:column;align-items:center;
              gap:2px;
            ">
              <div style="
                padding:3px 8px;
                background:${color};color:#fff;
                border-radius:12px;
                font-size:11px;font-weight:700;
                white-space:nowrap;
                box-shadow:0 2px 6px rgba(0,0,0,0.25);
              ">${dong.dong_name}</div>
              <div style="
                width:10px;height:10px;
                background:${color};
                border-radius:50%;
                border:2px solid #fff;
                box-shadow:0 1px 4px rgba(0,0,0,0.2);
              "></div>
            </div>`,
            anchor: new nMaps.Point(40, 36),
          },
          zIndex: 30,
        });
        markersRef.current.push(marker);
      });
    }
  }, [routes, selectedRouteIndex, hotDongs, currentLocation, heatmapDongs, clearOverlays]);

  // 히트맵: 행정동 폴리곤 오버레이
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.naver?.maps || !heatmapDongs || heatmapDongs.length === 0) return;

    // 기존 히트맵 오버레이 정리
    heatmapMarkersRef.current.forEach((m) => m.setMap(null));
    heatmapMarkersRef.current = [];

    const nMaps = window.naver.maps;

    // GeoJSON 로드
    fetch('/seoul-dong.geojson')
      .then((res) => res.json())
      .then((geojson) => {
        // gu_name + dong_name으로 매칭 (GeoJSON은 "서울특별시 종로구 사직동" 형식)
        const scoreMap = new Map<string, { score: number; dong_name: string; gu_name: string }>();
        for (const dong of heatmapDongs) {
          // 정확한 이름 매칭
          scoreMap.set(`${dong.gu_name} ${dong.dong_name}`, {
            score: dong.call_expectation,
            dong_name: dong.dong_name,
            gu_name: dong.gu_name,
          });
        }

        for (const feature of geojson.features) {
          const admNm = feature.properties.adm_nm as string; // "서울특별시 종로구 사직동"
          const parts = admNm.split(' ');
          const guName = parts[1]; // "종로구"
          const dongName = parts.slice(2).join(' '); // "사직동"
          const key = `${guName} ${dongName}`;

          // 정확 매칭 시도, 없으면 부분 매칭
          let dongInfo = scoreMap.get(key);
          if (!dongInfo) {
            // 부분 매칭: "여의동" ↔ "여의도동" 등
            for (const [k, v] of scoreMap) {
              const seedDong = k.split(' ')[1];
              if (k.startsWith(guName) && (
                dongName.includes(seedDong.replace(/동$/, '')) ||
                seedDong.includes(dongName.replace(/동$/, ''))
              )) {
                dongInfo = v;
                break;
              }
            }
          }
          if (!dongInfo || dongInfo.score < 30) continue;

          const color = getHeatColor(dongInfo.score);
          const opacity = getHeatOpacity(dongInfo.score);

          // MultiPolygon → Naver Polygon paths
          const geom = feature.geometry;
          const polygons = geom.type === 'MultiPolygon'
            ? geom.coordinates
            : [geom.coordinates];

          for (const polygon of polygons) {
            const outerRing = polygon[0];
            const path = outerRing.map(
              (coord: number[]) => new nMaps.LatLng(coord[1], coord[0])
            );

            const poly = new nMaps.Polygon({
              map,
              paths: [path],
              fillColor: color,
              fillOpacity: opacity,
              strokeColor: color,
              strokeOpacity: 0.4,
              strokeWeight: 1,
              zIndex: 5,
              clickable: false,
            });

            heatmapMarkersRef.current.push(poly);
          }
        }
      })
      .catch((err) => console.error('GeoJSON 로드 실패:', err));
  }, [heatmapDongs]);

  return <div ref={mapRef} className="naver-map" />;
});

export default NaverMap;
