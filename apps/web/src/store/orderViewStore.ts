import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The two ways to look at the SAME order set: grouped by product (workshop) or a flat paged table (classic). */
export type OrderView = 'grouped' | 'flat';

interface OrderViewStore {
  view: OrderView;
  setView: (view: OrderView) => void;
}

/**
 * Which order view the single "All orders" menu entry opens. Remembered per browser (so per person on
 * their own machine); both order pages write it on mount, so it always equals the view last used.
 */
export const useOrderViewStore = create<OrderViewStore>()(
  persist(
    (set) => ({
      view: 'grouped',
      setView: (view) => set({ view }),
    }),
    { name: 'onosfactory-order-view' },
  ),
);
