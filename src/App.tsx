import { useState, useRef, useCallback, useMemo } from 'react';
import WakeLockBanner from './components/WakeLockBanner';
import NaverMap, { type NaverMapHandle } from './components/NaverMap';
import OrderInput from './components/OrderInput';
import RouteList from './components/RouteList';
import { useDongScores } from './hooks/useDongScores';
import { useOrderStore } from './stores/useOrderStore';
import { useRouteStore } from './stores/useRouteStore';
import { recommendRoute, recalculateRoute } from './services/routeService';
import type { Route } from './types';

const PANEL_MIN = 340;     // 접힌 상태 최소 높이
const PANEL_MAX_VH = 85;   // 최대 높이 (vh)

export default function App() {
  // GPS 위치 추적 미사용 - 출발지/도착지는 오더 입력 기반
  const { dongs: heatmapDongs } = useDongScores();
  const { orders } = useOrderStore();
  const {
    recommendation,
    selectedRouteIndex,
    isLoading,
    setRecommendation,
  } = useRouteStore();

  const [panelHeight, setPanelHeight] = useState(PANEL_MIN);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const mapHandle = useRef<NaverMapHandle>(null);
  const panelContentRef = useRef<HTMLDivElement>(null);
  const routeListRef = useRef<HTMLDivElement>(null);

  // 터치 드래그 핸들러
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = {
      startY: e.touches[0].clientY,
      startH: panelHeight,
    };
  }, [panelHeight]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.touches[0].clientY;
    const maxPx = window.innerHeight * (PANEL_MAX_VH / 100);
    const newH = Math.max(PANEL_MIN, Math.min(maxPx, dragRef.current.startH + dy));
    setPanelHeight(newH);
  }, []);

  const onTouchEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleRecommend = async () => {
    if (orders.length === 0) {
      setErrorMsg('오더를 먼저 추가해주세요.');
      return;
    }

    useRouteStore.setState({ isLoading: true });
    setErrorMsg(null);

    try {
      const startLoc = orders[0].pickup_location;
      const rec = await recommendRoute(startLoc, 0, orders, heatmapDongs);
      setRecommendation(rec);
      // 패널 스크롤을 "경로 추천 결과"로 이동 + 지도 맞춤
      setTimeout(() => {
        routeListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        mapHandle.current?.fitToRoutes();
      }, 100);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '경로 추천에 실패했습니다.';
      setErrorMsg(message);
      useRouteStore.setState({ isLoading: false });
    }
  };

  const handleRecalculate = async () => {
    if (orders.length < 2) {
      setErrorMsg('기존 오더와 새 오더가 필요합니다.');
      return;
    }

    useRouteStore.setState({ isLoading: true });
    setErrorMsg(null);

    try {
      const existingOrders = orders.slice(0, -1);
      const newOrder = orders[orders.length - 1];
      const startLoc = orders[0].pickup_location;
      const rec = await recalculateRoute(startLoc, 0, existingOrders, newOrder, heatmapDongs);
      setRecommendation(rec);
      setTimeout(() => {
        routeListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        mapHandle.current?.fitToRoutes();
      }, 100);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '경로 재계산에 실패했습니다.';
      setErrorMsg(message);
      useRouteStore.setState({ isLoading: false });
    }
  };

  const allRoutes: Route[] = useMemo(() => {
    if (!recommendation) return [];
    return [recommendation.shortest_route, ...recommendation.recommendations];
  }, [recommendation]);

  const hotDongs = recommendation?.nearby_hot_dongs ?? [];

  return (
    <div className="app">
      <WakeLockBanner />


      <div className="map-container">
        <NaverMap
          ref={mapHandle}
          routes={allRoutes}
          selectedRouteIndex={selectedRouteIndex}
          hotDongs={hotDongs}
          currentLocation={null}
          heatmapDongs={heatmapDongs}
        />
      </div>

      <div
        className="bottom-panel"
        style={{ height: `${panelHeight}px` }}
      >
        <div
          className="panel-handle"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseDown={(e) => {
            dragRef.current = { startY: e.clientY, startH: panelHeight };
            const onMove = (ev: MouseEvent) => {
              if (!dragRef.current) return;
              const dy = dragRef.current.startY - ev.clientY;
              const maxPx = window.innerHeight * (PANEL_MAX_VH / 100);
              setPanelHeight(Math.max(PANEL_MIN, Math.min(maxPx, dragRef.current.startH + dy)));
            };
            const onUp = () => {
              dragRef.current = null;
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="panel-handle-bar" />
        </div>

        <div className="panel-content" ref={panelContentRef}>
          <OrderInput />

          <div className="action-buttons">
            <button
              type="button"
              className="btn btn-action"
              onClick={handleRecommend}
              disabled={isLoading || orders.length === 0}
            >
              {isLoading ? '계산 중...' : '경로 추천'}
            </button>

            {recommendation && orders.length >= 2 && (
              <button
                type="button"
                className="btn btn-action btn-action--secondary"
                onClick={handleRecalculate}
                disabled={isLoading}
              >
                {isLoading ? '계산 중...' : '오더 추가 & 재계산'}
              </button>
            )}
          </div>

          {errorMsg && <div className="error-message">{errorMsg}</div>}

          <div ref={routeListRef}>
            <RouteList hotDongs={hotDongs} heatmapDongs={heatmapDongs} />
          </div>
        </div>
      </div>
    </div>
  );
}
