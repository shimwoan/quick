import { create } from 'zustand';
import type { RouteRecommendation } from '../types';

interface RouteState {
  recommendation: RouteRecommendation | null;
  selectedRouteIndex: number | null; // -1 = shortest, 0+ = recommendation index
  isLoading: boolean;
  setRecommendation: (rec: RouteRecommendation) => void;
  selectRoute: (index: number | null) => void;
  clearRoute: () => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  recommendation: null,
  selectedRouteIndex: null,
  isLoading: false,

  setRecommendation: (rec) =>
    set({ recommendation: rec, selectedRouteIndex: rec.recommendations.length > 0 ? 0 : -1, isLoading: false }),

  selectRoute: (index) => set({ selectedRouteIndex: index }),

  clearRoute: () =>
    set({ recommendation: null, selectedRouteIndex: null, isLoading: false }),
}));
