import { supabase } from '../lib/supabase';
import type { Order, Location, RouteRecommendation } from '../types';
import type { DongHeatData } from '../hooks/useDongScores';

export async function recommendRoute(
  currentLocation: Location,
  heading: number | null,
  orders: Order[],
  hotDongs: DongHeatData[],
  maxRecommendations: number = 3
): Promise<RouteRecommendation> {
  const { data, error } = await supabase.functions.invoke('route-recommend', {
    body: {
      current_location: currentLocation,
      heading: heading ?? 0,
      orders: orders.map((o) => ({
        id: o.id,
        pickup_location: o.pickup_location,
        dropoff_location: o.dropoff_location,
        status: o.status,
      })),
      hot_dongs: hotDongs.map((d) => ({
        dong_code: d.dong_code,
        dong_name: d.dong_name,
        call_expectation: d.call_expectation,
        lat: d.lat,
        lng: d.lng,
      })),
      max_recommendations: maxRecommendations,
    },
  });

  if (error) {
    throw new Error(`경로 추천 요청 실패: ${error.message}`);
  }

  return data as RouteRecommendation;
}

export async function recalculateRoute(
  currentLocation: Location,
  heading: number | null,
  existingOrders: Order[],
  newOrder: Order,
  hotDongs: DongHeatData[],
  maxRecommendations: number = 3
): Promise<RouteRecommendation> {
  const { data, error } = await supabase.functions.invoke('route-recalculate', {
    body: {
      current_location: currentLocation,
      heading: heading ?? 0,
      existing_orders: existingOrders.map((o) => ({
        id: o.id,
        pickup_location: o.pickup_location,
        dropoff_location: o.dropoff_location,
        status: o.status,
      })),
      new_order: {
        id: newOrder.id,
        pickup_location: newOrder.pickup_location,
        dropoff_location: newOrder.dropoff_location,
        status: newOrder.status,
      },
      hot_dongs: hotDongs.map((d) => ({
        dong_code: d.dong_code,
        dong_name: d.dong_name,
        call_expectation: d.call_expectation,
        lat: d.lat,
        lng: d.lng,
      })),
      max_recommendations: maxRecommendations,
    },
  });

  if (error) {
    throw new Error(`경로 재계산 요청 실패: ${error.message}`);
  }

  return data as RouteRecommendation;
}
