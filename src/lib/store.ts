import { create } from 'zustand';
import { BuyCartItem, SellCartItem, SortCartItem, TransferCartItem, PageTab } from './types';

interface AppState {
  // Navigation
  activeTab: PageTab;
  setActiveTab: (tab: PageTab) => void;

  // Buy cart
  buyCartItems: BuyCartItem[];
  addBuyCartItem: (item: BuyCartItem) => void;
  removeBuyCartItem: (index: number) => void;
  updateBuyCartItem: (index: number, item: Partial<BuyCartItem>) => void;
  clearBuyCart: () => void;

  // Sell cart
  sellCartItems: SellCartItem[];
  addSellCartItem: (item: SellCartItem) => void;
  removeSellCartItem: (index: number) => void;
  updateSellCartItem: (index: number, item: Partial<SellCartItem>) => void;
  clearSellCart: () => void;

  // Sorting cart
  sortSourceProductId: string;
  sortSourceWeight: number;
  sortSourcePricePerKg: number;
  sortWeighedTotal: number;
  sortCartItems: SortCartItem[];
  setSortSourceProduct: (productId: string) => void;
  setSortSourceWeight: (weight: number) => void;
  setSortSourcePricePerKg: (price: number) => void;
  setSortWeighedTotal: (weight: number) => void;
  addSortCartItem: (item: SortCartItem) => void;
  removeSortCartItem: (index: number) => void;
  updateSortCartItem: (index: number, item: Partial<SortCartItem>) => void;
  clearSortCart: () => void;

  // Transfer (แกะของ/ย้ายสต็อก) cart
  transferSourceProductId: string;
  transferSourceWeight: number;
  transferWeighedTotal: number;
  transferCartItems: TransferCartItem[];
  setTransferSourceProduct: (productId: string) => void;
  setTransferSourceWeight: (weight: number) => void;
  setTransferWeighedTotal: (weight: number) => void;
  addTransferCartItem: (item: TransferCartItem) => void;
  removeTransferCartItem: (index: number) => void;
  updateTransferCartItem: (index: number, item: Partial<TransferCartItem>) => void;
  clearTransferCart: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Navigation
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Buy cart
  buyCartItems: [],
  addBuyCartItem: (item) =>
    set((state) => ({ buyCartItems: [...state.buyCartItems, item] })),
  removeBuyCartItem: (index) =>
    set((state) => ({
      buyCartItems: state.buyCartItems.filter((_, i) => i !== index),
    })),
  updateBuyCartItem: (index, item) =>
    set((state) => ({
      buyCartItems: state.buyCartItems.map((existing, i) =>
        i === index ? { ...existing, ...item } : existing
      ),
    })),
  clearBuyCart: () => set({ buyCartItems: [] }),

  // Sell cart
  sellCartItems: [],
  addSellCartItem: (item) =>
    set((state) => ({ sellCartItems: [...state.sellCartItems, item] })),
  removeSellCartItem: (index) =>
    set((state) => ({
      sellCartItems: state.sellCartItems.filter((_, i) => i !== index),
    })),
  updateSellCartItem: (index, item) =>
    set((state) => ({
      sellCartItems: state.sellCartItems.map((existing, i) =>
        i === index ? { ...existing, ...item } : existing
      ),
    })),
  clearSellCart: () => set({ sellCartItems: [] }),

  // Sorting cart
  sortSourceProductId: '',
  sortSourceWeight: 0,
  sortSourcePricePerKg: 0,
  sortWeighedTotal: 0,
  sortCartItems: [],
  setSortSourceProduct: (productId) =>
    set({ sortSourceProductId: productId }),
  setSortSourceWeight: (weight) => set({ sortSourceWeight: weight }),
  setSortSourcePricePerKg: (price) => set({ sortSourcePricePerKg: price }),
  setSortWeighedTotal: (weight) => set({ sortWeighedTotal: weight }),
  addSortCartItem: (item) =>
    set((state) => ({ sortCartItems: [...state.sortCartItems, item] })),
  removeSortCartItem: (index) =>
    set((state) => ({
      sortCartItems: state.sortCartItems.filter((_, i) => i !== index),
    })),
  updateSortCartItem: (index, item) =>
    set((state) => ({
      sortCartItems: state.sortCartItems.map((existing, i) =>
        i === index ? { ...existing, ...item } : existing
      ),
    })),
  clearSortCart: () =>
    set({
      sortCartItems: [],
      sortSourceProductId: '',
      sortSourceWeight: 0,
      sortSourcePricePerKg: 0,
      sortWeighedTotal: 0,
    }),

  // Transfer (แกะของ/ย้ายสต็อก) cart
  transferSourceProductId: '',
  transferSourceWeight: 0,
  transferWeighedTotal: 0,
  transferCartItems: [],
  setTransferSourceProduct: (productId) =>
    set({ transferSourceProductId: productId }),
  setTransferSourceWeight: (weight) => set({ transferSourceWeight: weight }),
  setTransferWeighedTotal: (weight) => set({ transferWeighedTotal: weight }),
  addTransferCartItem: (item) =>
    set((state) => ({ transferCartItems: [...state.transferCartItems, item] })),
  removeTransferCartItem: (index) =>
    set((state) => ({
      transferCartItems: state.transferCartItems.filter((_, i) => i !== index),
    })),
  updateTransferCartItem: (index, item) =>
    set((state) => ({
      transferCartItems: state.transferCartItems.map((existing, i) =>
        i === index ? { ...existing, ...item } : existing
      ),
    })),
  clearTransferCart: () =>
    set({
      transferCartItems: [],
      transferSourceProductId: '',
      transferSourceWeight: 0,
      transferWeighedTotal: 0,
    }),
}));
