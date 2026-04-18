import { useState } from "react";
import { SegmentKindsHook } from "../hooks/useSegmentKinds";
import { AppConfigHook } from "../hooks/useAppConfig";
import AnalysisSection from "./settings/AnalysisSection";
import BehaviorSection from "./settings/BehaviorSection";
import ExportSection from "./settings/ExportSection";
import SegmentKindSection from "./settings/SegmentKindSection";
import ShortcutsSection from "./settings/ShortcutsSection";
import StorageSection from "./settings/StorageSection";

interface SettingsDialogProps {
  kinds: SegmentKindsHook;
  appConfig: AppConfigHook;
  onClose: () => void;
}

type SectionId = "segment-kinds" | "analysis" | "export" | "shortcuts" | "behavior" | "storage";

interface Section {
  id: SectionId;
  label: string;
}

const SECTIONS: Section[] = [
  { id: "segment-kinds", label: "Segmenttyper" },
  { id: "analysis",      label: "Analys" },
  { id: "export",        label: "Export" },
  { id: "shortcuts",     label: "Snabbkommandon" },
  { id: "behavior",      label: "Beteende" },
  { id: "storage",       label: "Lagring" },
];

export default function SettingsDialog({ kinds, appConfig, onClose }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SectionId>("segment-kinds");

  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <div
        className="settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-sidebar">
          <div className="settings-sidebar-title">Inställningar</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item${activeSection === s.id ? " active" : ""}`}
              onClick={() => setActiveSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="settings-content">
          <div className="settings-content-header">
            <h3>{SECTIONS.find((s) => s.id === activeSection)?.label}</h3>
            <button className="secondary" onClick={onClose}>Stäng</button>
          </div>

          <div className="settings-body">
            {activeSection === "segment-kinds" && <SegmentKindSection kinds={kinds} appConfig={appConfig} />}
            {activeSection === "analysis"      && <AnalysisSection appConfig={appConfig} />}
            {activeSection === "export"        && <ExportSection appConfig={appConfig} />}
            {activeSection === "shortcuts"     && <ShortcutsSection appConfig={appConfig} />}
            {activeSection === "behavior"      && <BehaviorSection appConfig={appConfig} />}
            {activeSection === "storage"       && <StorageSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
