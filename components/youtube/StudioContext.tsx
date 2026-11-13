"use client";

import { createContext, useContext } from "react";

/** What every part of the Studio may need without passing it down: who logs, and which parts Milan hid (fase 2). */
export type StudioContextValue = { studioId: string | null; hiddenFolds: string[]; onFoldOpen: (id: string) => void; onShowFold: (id: string) => void };
export const StudioContext = createContext<StudioContextValue>({ studioId: null, hiddenFolds: [], onFoldOpen: () => {}, onShowFold: () => {} });
export const useStudioContext = () => useContext(StudioContext);
