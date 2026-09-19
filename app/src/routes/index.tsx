import { createFileRoute } from "@tanstack/react-router";
import { AppProvider, useApp } from "../lib/store";
import { Header } from "../components/Header";
import { HeroIngest } from "../components/HeroIngest";
import { FleetOverview } from "../components/FleetOverview";
import { Explorer } from "../components/Explorer";
import { AnomaliesView } from "../components/AnomaliesView";
import { MethodologyView } from "../components/MethodologyView";
import { DataView } from "../components/DataView";
import { AnomalyDrawer } from "../components/AnomalyDrawer";
import { ProgressOverlay } from "../components/ProgressOverlay";

export const Route = createFileRoute("/")({
  // Page metadata (title, description, OG, favicon) lives in app-meta.json and
  // is applied by the root route; this page adds nothing on top.
  component: Index,
});

function Page() {
  const { state } = useApp();
  const hasResult = Boolean(state.result);
  return (
    <div className="ts-app">
      <Header />
      {!hasResult && state.tab === "data" && <DataView />}
      {!hasResult && state.tab === "methodology" && <MethodologyView />}
      {!hasResult && state.tab !== "data" && state.tab !== "methodology" && <HeroIngest />}
      {hasResult && state.tab === "overview" && <FleetOverview />}
      {hasResult && state.tab === "explorer" && <Explorer />}
      {hasResult && state.tab === "anomalies" && <AnomaliesView />}
      {hasResult && state.tab === "methodology" && <MethodologyView />}
      {hasResult && state.tab === "data" && <DataView />}
      <ProgressOverlay />
      <AnomalyDrawer />
      <footer className="ts-footer">
        <span>ThermaSight</span>
        <span className="ts-footer-mid">built for YUKTHI 2026 · intelligent energy and equipment monitoring</span>
        <span className="mono ts-footer-mut">unsupervised contextual anomaly detection on chiller telemetry</span>
      </footer>
    </div>
  );
}

function Index() {
  return (
    <AppProvider>
      <Page />
    </AppProvider>
  );
}