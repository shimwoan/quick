import { create } from 'zustand';
import type { Order } from '../types';

interface OrderState {
  orders: Order[];
  addOrder: (order: Order) => void;
  removeOrder: (id: string) => void;
  updateOrderStatus: (id: string, status: Order['status']) => void;
  clearOrders: () => void;
}

export const useOrderStore = create<OrderState>((set) => ({
  orders: [],

  addOrder: (order) =>
    set((state) => {
      if (state.orders.length >= 3) return state;
      return { orders: [...state.orders, order] };
    }),

  removeOrder: (id) =>
    set((state) => ({ orders: state.orders.filter((o) => o.id !== id) })),

  updateOrderStatus: (id, status) =>
    set((state) => ({
      orders: state.orders.map((o) => (o.id === id ? { ...o, status } : o)),
    })),

  clearOrders: () => set({ orders: [] }),
}));
