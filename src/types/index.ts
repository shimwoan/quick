export interface Location {
  lat: number;
  lng: number;
}

export interface DongScore {
  dong_code: string;
  dong_name: string;
  call_expectation: number;
  extra_time_min?: number;
}

export interface Order {
  id: string;
  pickup_address: string;
  pickup_location: Location;
  dropoff_address: string;
  dropoff_location: Location;
  status: 'pending' | 'picked_up' | 'in_transit' | 'completed' | 'cancelled';
}

export interface RouteWaypoint {
  lat: number;
  lng: number;
  type: 'current' | 'pickup' | 'dropoff' | 'hot_zone';
  order_id?: string;
  dong?: string;
}

export interface Route {
  distance_km: number;
  time_min: number;
  waypoints: RouteWaypoint[];
  path?: Location[]; // 실제 도로 경로 좌표
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
