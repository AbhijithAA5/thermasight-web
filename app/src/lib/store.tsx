// ThermaSight — app state. One context: pipeline state + navigation view state.
// All pipeline execution happens inside user event handlers (SSR-safe).
"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { TARGET_COL, type NumericCol, type PipelineResult } from "./pipeline/types";
import { runPipeline, type Progress } from "./pipeline/engine";
import { DEMO_FILE_NAME, generateDemoCsv } from "./pipeline/demo";

export type Tab = "overview" | "explorer" | "anomalies" | "methodology" | "data";

export interface AppState {
  result: PipelineResult | null;
  running: boolean;
  progress: Progress | null;
  error: string | null;
  sourceLabel: string | null;
  tab: Tab;
  equipmentId: string | null;
  variable: NumericCol;
  selectedEpisodeId: string | null;
  timeRange: [number, number] | null;
}

const DEFAULTS: AppState = {
  result: null,
  running: false,
  progress: null,
  error: null,
  sourceLabel: null,
  tab: "overview",
  equipmentId: null,
  variable: TARGET_COL,
  selectedEpisodeId: null,
  timeRange: null,
};

interface Store {
  state: AppState;
  setTab: (t: Tab) => void;
  setEquipment: (id: string) => void;
  setVariable: (c: NumericCol) => void;
  selectEpisode: (id: string | null) => void;
  setTimeRange: (r: [number, number] | null) => void;
  loadDemo: () => Promise<void>;
  loadReal: () => Promise<void>;
  runFile: (f: File) => Promise<void>;
  clear: () => void;
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(DEFAULTS);
  const lastFrac = useRef(0);

  const pushProgress = (p: Progress) => {
    if (p.fraction - lastFrac.current < 0.02 && p.fraction < 1) return;
    lastFrac.current = p.fraction;
    setState((s) => ({ ...s, progress: p }));
  };

  const execute = async (csvText: string, sourceLabel: string) => {
    lastFrac.current = 0;
    setState((s) => ({
      ...s,
      running: true,
      progress: { stage: "Starting", fraction: 0 },
      error: null,
      sourceLabel,
      // a new analysis must never keep the previous dataset's results on screen
      result: null,
      equipmentId: null,
      selectedEpisodeId: null,
      timeRange: null,
    }));
    // Let the progress UI render before the heavy work starts.
    await new Promise((r) => setTimeout(r, 50));
    try {
      const result = await runPipeline(csvText, sourceLabel, pushProgress);
      setState((s) => ({
        ...s,
        result,
        running: false,
        progress: { stage: "Done", fraction: 1 },
        equipmentId: s.equipmentId ?? result.quality.equipmentIds[0] ?? null,
        selectedEpisodeId: null,
        timeRange: null,
        tab: "overview",
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        running: false,
        progress: null,
        error: e instanceof Error ? e.message : "Analysis failed. Check that the file matches the data specification.",
      }));
    }
  };

  const loadDemo = async () => {
    const csv = generateDemoCsv();
    await execute(csv, DEMO_FILE_NAME);
  };

  const REAL_FILE_NAME = "yukthi-development-dataset.csv";

  const loadReal = async () => {
    const res = await fetch("./yukthi_development.csv");
    if (!res.ok) throw new Error("The bundled YUKTHI development dataset failed to load.");
    const csv = await res.text();
    await execute(csv, REAL_FILE_NAME);
  };

  const runFile = async (file: File) => {
    const text = await file.text();
    await execute(text, file.name);
  };

  const clear = () => setState({ ...DEFAULTS });

  const value: Store = {
    state,
    setTab: (t) => setState((s) => ({ ...s, tab: t })),
    setEquipment: (id) => {
      setState((s) => ({ ...s, equipmentId: id, timeRange: null, selectedEpisodeId: null, tab: "explorer" }));
    },
    setVariable: (c) => setState((s) => ({ ...s, variable: c })),
    selectEpisode: (id) => setState((s) => ({ ...s, selectedEpisodeId: id })),
    setTimeRange: (r) => setState((s) => ({ ...s, timeRange: r })),
    loadDemo,
    loadReal,
    runFile,
    clear,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}