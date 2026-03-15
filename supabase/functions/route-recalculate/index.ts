import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildRouteRecommendation,
  type LatLng,
  type TypedWaypoint,
} from "../_shared/route-engine.ts";

interface OrderInput {
  id: string;
  pickup_location: LatLng;
  dropoff_location: LatLng;
  status: string;
}

interface HotDongInput {
  dong_code: string;
  dong_name: string;
  call_expectation: number;
  lat: number;
  lng: number;
}

interface RequestBody {
  current_location: LatLng;
  heading: number;
  existing_orders: OrderInput[];
  new_order: OrderInput;
  hot_dongs: HotDongInput[];
  max_recommendations?: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const {
      current_location,
      heading,
      existing_orders,
      new_order,
      hot_dongs,
      max_recommendations = 3,
    } = body;

    if (!current_location || !existing_orders || !new_order) {
      return new Response(
        JSON.stringify({
          error: "current_location, existing_orders, and new_order are required",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const activeOrders = existing_orders.filter(
      (o) => o.status !== "completed" && o.status !== "cancelled",
    );
    const allOrders = [...activeOrders, new_order];

    const typedWaypoints: TypedWaypoint[] = [];
    for (const order of allOrders) {
      if (order.status === "picked_up" || order.status === "in_transit") {
        typedWaypoints.push({
          location: order.dropoff_location,
          type: "dropoff",
          order_id: order.id,
        });
      } else {
        typedWaypoints.push({
          location: order.pickup_location,
          type: "pickup",
          order_id: order.id,
        });
        typedWaypoints.push({
          location: order.dropoff_location,
          type: "dropoff",
          order_id: order.id,
        });
      }
    }

    if (typedWaypoints.length === 0) {
      return new Response(
        JSON.stringify({ error: "No waypoints to route" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 프론트에서 전달받은 히트맵 데이터를 engine 형식으로 변환
    const hotDongsForEngine = (hot_dongs ?? []).map((d) => ({
      dong_code: d.dong_code,
      dong_name: d.dong_name,
      call_expectation: d.call_expectation,
      center_point: { lat: d.lat, lng: d.lng },
      extra_time_min: 0,
    }));

    const recommendation = await buildRouteRecommendation(
      current_location,
      heading ?? 0,
      typedWaypoints,
      hotDongsForEngine,
      Math.min(max_recommendations, 3),
    );

    return new Response(JSON.stringify(recommendation), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("route-recalculate error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
