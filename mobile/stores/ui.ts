import { create } from "zustand";

/**
 * Transient navigation UI state — which bottom sheet is open, and nothing
 * more.
 *
 * Kept out of the component tree because the sheets are opened from the tab
 * bar and rendered by the layout, so a shared, tiny store beats threading
 * callbacks through both. Deliberately holds no server data: if a value
 * comes from the API, TanStack Query owns it.
 */
export type SheetId = "career" | "aiSearch" | "hiring" | "more" | null;

interface UiState {
  openSheet: SheetId;
  setOpenSheet: (sheet: SheetId) => void;
  closeSheet: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  openSheet: null,
  setOpenSheet: (openSheet) => set({ openSheet }),
  closeSheet: () => set({ openSheet: null }),
}));
