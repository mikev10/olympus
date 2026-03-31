import { useState } from "react";


const C = {
  bg: "#0b0d13", surface: "#13151e", elevated: "#1b1e2b", hover: "#242838",
  border: "#282c3c", borderLight: "#353a50",
  text: "#e4e6ee", textSec: "#878da6", textMuted: "#4a5070",
  done: "#34d399", active: "#5b9cf5", pending: "#3e4362",
  blocked: "#f87171", warning: "#fbbf24", design: "#c084fc",
};

const SQUADS = {
  alpha: { name: "Alpha", color: "#a78bfa", bg: "rgba(167,139,250,0.08)" },
  bravo: { name: "Bravo", color: "#2dd4bf", bg: "rgba(45,212,191,0.08)" },
};

const PHASES = {
  queued: { label: "Queued", color: C.textMuted, bg: "transparent" },
  design: { label: "Designing", color: C.design, bg: "rgba(192,132,252,0.10)" },
  build: { label: "Building", color: C.active, bg: "rgba(91,156,245,0.10)" },
  complete: { label: "Complete", color: C.done, bg: "rgba(52,211,153,0.10)" },
};

const WORKFLOW = {
  intent: { name: "Iframe Migration", desc: "Migrate legacy iframe pages to native Angular components" },
  units: [
    {
      id: "UNIT-001", name: "Location Setup", squad: "alpha", phase: "build",
      design: { status: "approved", files: 3, total: 3 },
      gates: { g2: "passed", g3: "pending" },
      bolts: [
        { id: "BOLT-001", name: "API Endpoints", status: "done", life: { plan: "done", code: "done", review: "done" }, qa: "passed", stories: 3 },
        { id: "BOLT-002", name: "Page Shell", status: "active", life: { plan: "done", code: "active", review: "pending" }, qa: "pending", stories: 2 },
        { id: "BOLT-003", name: "Settings Form", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 3 },
      ],
    },
    {
      id: "UNIT-002", name: "Online Registration", squad: "bravo", phase: "design",
      design: { status: "in_progress", files: 1, total: 3 },
      gates: { g2: "pending", g3: "pending" },
      bolts: [
        { id: "BOLT-001", name: "API Service", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 4, dep: "UNIT-001 BOLT-001" },
        { id: "BOLT-002", name: "Page Layout", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 2 },
        { id: "BOLT-003", name: "Section Components", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 3 },
        { id: "BOLT-004", name: "Integration", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 2 },
      ],
    },
    {
      id: "UNIT-003", name: "Coupons Page", squad: "alpha", phase: "queued",
      design: { status: "pending", files: 0, total: 3 },
      gates: { g2: "pending", g3: "pending" },
      bolts: [
        { id: "BOLT-001", name: "API Endpoints", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 2 },
        { id: "BOLT-002", name: "Page & Table", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 3 },
        { id: "BOLT-003", name: "CRUD Operations", status: "pending", life: { plan: "pending", code: "pending", review: "pending" }, qa: "pending", stories: 2 },
      ],
    },
  ],
};

function statusColor(s) {
  return s === "done" || s === "passed" || s === "approved" ? C.done
    : s === "active" || s === "in_progress" ? C.active
    : s === "blocked" ? C.blocked
    : C.pending;
}

function progress() {
  let done = 0, total = 0;
  WORKFLOW.units.forEach(u => u.bolts.forEach(b => { total++; if (b.status === "done") done++; }));
  return Math.round((done / total) * 100);
}

function lifeSteps(life) {
  return ["plan", "code", "review"].map(s => ({ key: s, status: life[s] }));
}

function Gate({ num, status }) {
  const passed = status === "passed";
  const color = passed ? C.done : C.textMuted;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      padding: "0 6px", alignSelf: "stretch", justifyContent: "center", minWidth: 36,
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: "50%",
        border: `2px solid ${color}`,
        background: passed ? `${C.done}20` : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color, fontWeight: 700,
      }}>
        {passed ? "✓" : num}
      </div>
      <span style={{ fontSize: 9, color: C.textMuted, fontFamily: "var(--mono)", letterSpacing: "0.04em" }}>
        G{num}
      </span>
    </div>
  );
}

function DesignBadge({ design }) {
  const s = design.status;
  const color = s === "approved" ? C.done : s === "in_progress" ? C.design : C.textMuted;
  const label = s === "approved" ? "Design ✓" : s === "in_progress" ? "Designing..." : "Design";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderRadius: 6,
      background: s === "in_progress" ? "rgba(192,132,252,0.08)" : s === "approved" ? "rgba(52,211,153,0.06)" : "transparent",
      border: `1px solid ${s === "pending" ? C.border : color}30`,
      minWidth: 110,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color,
        boxShadow: s === "in_progress" ? `0 0 8px ${C.design}60` : "none",
      }} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color, fontFamily: "var(--sans)" }}>{label}</div>
        <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "var(--mono)" }}>
          {design.files}/{design.total} files
        </div>
      </div>
    </div>
  );
}

function BoltCard({ bolt, isSelected, onClick }) {
  const [hovered, setHovered] = useState(false);
  const isDone = bolt.status === "done";
  const isActive = bolt.status === "active";
  const isPending = bolt.status === "pending";
  const borderColor = isDone ? C.done : isActive ? C.active : "transparent";

  return (
    <div
      onClick={() => onClick(bolt)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        background: isSelected ? C.hover : hovered ? C.elevated : C.surface,
        border: `1px solid ${isActive ? `${C.active}50` : isSelected ? C.borderLight : C.border}`,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 8,
        padding: isActive ? "12px 14px" : "10px 12px",
        minWidth: isActive ? 160 : 130,
        maxWidth: 180,
        cursor: "pointer",
        transition: "all 0.15s ease",
        opacity: isPending ? 0.5 : 1,
        boxShadow: isActive
          ? `0 0 20px ${C.active}15, 0 4px 12px rgba(0,0,0,0.3)`
          : hovered ? "0 4px 12px rgba(0,0,0,0.25)" : "0 2px 4px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.textMuted, letterSpacing: "0.04em" }}>
          {bolt.id}
        </span>
        {isDone && <span style={{ fontSize: 12, color: C.done }}>✓</span>}
        {bolt.dep && (
          <span title={`Depends on: ${bolt.dep}`} style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 3,
            background: `${C.warning}20`, color: C.warning,
            fontFamily: "var(--mono)", fontWeight: 600,
          }}>DEP</span>
        )}
      </div>

      <div style={{
        fontSize: 13, fontWeight: 600, color: isPending ? C.textMuted : C.text,
        fontFamily: "var(--sans)", lineHeight: 1.3, marginBottom: isActive ? 10 : 4,
      }}>
        {bolt.name}
      </div>

      {(isActive || isDone) && (
        <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
          {lifeSteps(bolt.life).map(step => (
            <div key={step.key} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            }}>
              <div style={{
                width: "100%", height: 3, borderRadius: 2,
                background: step.status === "done" ? C.done
                  : step.status === "active" ? C.active
                  : `${C.textMuted}40`,
              }} />
              <span style={{
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                fontFamily: "var(--mono)",
                color: step.status === "active" ? C.active : step.status === "done" ? C.textSec : C.textMuted,
                fontWeight: step.status === "active" ? 700 : 400,
              }}>
                {step.key}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: "var(--mono)" }}>
          {bolt.stories} {bolt.stories === 1 ? "story" : "stories"}
        </span>
        {(isDone || isActive) && (
          <span style={{
            fontSize: 9, padding: "1px 6px", borderRadius: 3,
            background: bolt.qa === "passed" ? `${C.done}15` : "transparent",
            border: `1px solid ${bolt.qa === "passed" ? `${C.done}40` : C.border}`,
            color: bolt.qa === "passed" ? C.done : C.textMuted,
            fontFamily: "var(--mono)", fontWeight: 500,
          }}>
            QA {bolt.qa === "passed" ? "✓" : "..."}
          </span>
        )}
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div style={{
      display: "flex", alignItems: "center", width: 24, justifyContent: "center",
      flexShrink: 0,
    }}>
      <div style={{ width: 16, height: 1, background: C.border }} />
      <div style={{
        width: 0, height: 0,
        borderTop: "3px solid transparent",
        borderBottom: "3px solid transparent",
        borderLeft: `4px solid ${C.border}`,
      }} />
    </div>
  );
}

function UnitLane({ unit, selectedBolt, onBoltClick }) {
  const squad = SQUADS[unit.squad];
  const phase = PHASES[unit.phase];
  const doneBolts = unit.bolts.filter(b => b.status === "done").length;

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${squad.color}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 20px",
        borderBottom: `1px solid ${C.border}`,
        background: squad.bg,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: C.textMuted, letterSpacing: "0.04em" }}>
                {unit.id}
              </span>
              <span style={{
                fontSize: 10, padding: "1px 8px", borderRadius: 10,
                background: phase.bg, color: phase.color,
                fontWeight: 600, fontFamily: "var(--sans)",
                border: `1px solid ${phase.color}30`,
              }}>
                {phase.label}
              </span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: "var(--display)" }}>
              {unit.name}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "var(--mono)", marginBottom: 4 }}>
              {doneBolts}/{unit.bolts.length} bolts
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {unit.bolts.map((b, i) => (
                <div key={i} style={{
                  width: 20, height: 4, borderRadius: 2,
                  background: b.status === "done" ? C.done : b.status === "active" ? C.active : `${C.textMuted}50`,
                }} />
              ))}
            </div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 6,
            background: `${squad.color}12`, border: `1px solid ${squad.color}25`,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: squad.color }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: squad.color, fontFamily: "var(--sans)" }}>
              {squad.name}
            </span>
          </div>
        </div>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        padding: "16px 20px",
        overflowX: "auto",
      }}>
        <Gate num={2} status={unit.gates.g2} />
        <Connector />

        {unit.bolts.map((bolt, i) => (
          <div key={bolt.id} style={{ display: "flex", alignItems: "center" }}>
            <BoltCard
              bolt={bolt}
              isSelected={selectedBolt?.id === bolt.id && selectedBolt?._unitId === unit.id}
              onClick={(b) => onBoltClick({ ...b, _unitId: unit.id, _unitName: unit.name, _squad: squad.name })}
            />
            {i < unit.bolts.length - 1 && <Connector />}
          </div>
        ))}

        <Connector />
        <Gate num={3} status={unit.gates.g3} />
      </div>
    </div>
  );
}

function DetailPanel({ bolt, onClose }) {
  if (!bolt) return null;
  const steps = lifeSteps(bolt.life);

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 380,
      background: C.elevated, borderLeft: `1px solid ${C.border}`,
      boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
      zIndex: 100, overflowY: "auto",
      animation: "slideIn 0.2s ease",
    }}>
      <div style={{
        padding: "20px 24px", borderBottom: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: C.textMuted, marginBottom: 4 }}>
            {bolt._unitId} / {bolt.id}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "var(--display)" }}>
            {bolt.name}
          </div>
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 4 }}>
            {bolt._unitName} &middot; {bolt._squad}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.textSec, cursor: "pointer", padding: "4px 10px", fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontFamily: "var(--mono)" }}>
          Lifecycle
        </div>
        {steps.map((step, i) => {
          const isStepDone = step.status === "done";
          const isStepActive = step.status === "active";
          const color = isStepDone ? C.done : isStepActive ? C.active : C.textMuted;
          const labels = { plan: "AI creates implementation approach. Dev reviews.", code: "AI generates code + tests. Tests run automatically.", review: "Dev reviews code. QA validates acceptance criteria." };
          return (
            <div key={step.key} style={{ display: "flex", gap: 12, marginBottom: i < 2 ? 0 : 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  border: `2px solid ${color}`,
                  background: isStepDone ? `${C.done}20` : isStepActive ? `${C.active}20` : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, color, fontWeight: 700,
                }}>
                  {isStepDone ? "✓" : isStepActive ? "▶" : ""}
                </div>
                {i < 2 && <div style={{ width: 1, height: 32, background: C.border }} />}
              </div>
              <div style={{ paddingBottom: i < 2 ? 16 : 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color,
                  textTransform: "capitalize", fontFamily: "var(--sans)", marginBottom: 2,
                }}>
                  {step.key}
                  {isStepActive && (
                    <span style={{
                      marginLeft: 8, fontSize: 10, padding: "1px 6px", borderRadius: 3,
                      background: `${C.active}20`, color: C.active, fontWeight: 600,
                    }}>IN PROGRESS</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.4 }}>
                  {labels[step.key]}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontFamily: "var(--mono)" }}>
          Details
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <DetailItem label="Stories" value={bolt.stories} />
          <DetailItem label="QA Status" value={bolt.qa === "passed" ? "Passed ✓" : bolt.qa === "pending" ? "Awaiting" : bolt.qa} color={bolt.qa === "passed" ? C.done : C.textMuted} />
          <DetailItem label="Status" value={bolt.status} color={statusColor(bolt.status)} />
          {bolt.dep && <DetailItem label="Dependency" value={bolt.dep} color={C.warning} />}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, fontFamily: "var(--mono)" }}>
          Acceptance Criteria
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>
          Loaded from spec.md at runtime
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "var(--mono)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: color || C.text, fontWeight: 500, fontFamily: "var(--sans)", textTransform: "capitalize" }}>{value}</div>
    </div>
  );
}

const INCEPTION = {
  intentBrief: {
    author: "Mike V.",
    role: "Product Owner",
    status: "ready",
    duration: "~30 min",
    sections: [
      { name: "Business objective & motivation", done: true },
      { name: "Success criteria", done: true },
      { name: "Scope boundaries", done: true },
      { name: "User personas affected", done: true },
      { name: "Business constraints", done: true },
    ],
  },
  technicalBrief: {
    author: "Eric C.",
    role: "Senior Developer",
    status: "ready",
    duration: "~15 min",
    sections: [
      { name: "Known constraints & dependencies", done: true },
      { name: "Reference patterns", done: true },
      { name: "Gotchas & landmines", done: true },
      { name: "Reusable components", done: true },
      { name: "Infrastructure notes", done: false },
    ],
  },
  projectContext: [
    { file: "project-context.md", desc: "Architecture, tech stack, key patterns", updated: "2 weeks ago", status: "current" },
    { file: "coding-standards.md", desc: "Naming, file org, style rules", updated: "1 month ago", status: "current" },
    { file: "legacy-notes.md", desc: "Gotchas, tech debt, warnings", updated: "3 days ago", status: "current" },
  ],
  mobSession: {
    status: "complete",
    attendees: ["Mike V. (PO)", "Eric C. (Tech Lead)", "Sarah L.", "Alex K.", "Matt L. (BA)"],
    duration: "1h 45m",
    steps: [
      { name: "Validate briefs", status: "done" },
      { name: "Scoped discovery", status: "done" },
      { name: "Draft requirements", status: "done" },
      { name: "Decompose units", status: "done" },
      { name: "Outline bolt specs", status: "done" },
    ],
  },
  scopedDiscovery: {
    files: ["workspace-scan.json", "scope-analysis.md"],
    depth: "minimal",
    reason: "Team has deep familiarity with affected code",
  },
  gate1: { status: "passed" },
};

function BriefStatusBadge({ status }) {
  const map = {
    ready: { label: "Ready", color: C.done, bg: `${C.done}15` },
    draft: { label: "Draft", color: C.warning, bg: `${C.warning}15` },
    not_started: { label: "Not Started", color: C.textMuted, bg: "transparent" },
    skipped: { label: "Skipped", color: C.textMuted, bg: "transparent" },
  };
  const s = map[status] || map.not_started;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, fontFamily: "var(--sans)",
      padding: "2px 8px", borderRadius: 10,
      color: s.color, background: s.bg,
      border: `1px solid ${s.color}30`,
      fontStyle: status === "skipped" ? "italic" : "normal",
    }}>{s.label}</span>
  );
}

function BriefCard({ brief, accentColor, icon }) {
  const doneSections = brief.sections.filter(s => s.done).length;
  return (
    <div style={{
      flex: 1, minWidth: 280,
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderTop: `3px solid ${accentColor}`,
      borderRadius: 10,
      padding: "20px 22px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${accentColor}15`, border: `1px solid ${accentColor}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14,
          }}>{icon}</div>
          <div>
            <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {brief.role}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: accentColor, fontFamily: "var(--sans)" }}>
              {brief.author}
            </div>
          </div>
        </div>
        <BriefStatusBadge status={brief.status} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.textMuted }}>
          {doneSections}/{brief.sections.length} sections
        </span>
        <span style={{ fontSize: 10, color: C.textMuted }}>|</span>
        <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.textMuted }}>{brief.duration}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {brief.sections.map((sec, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 14, height: 14, borderRadius: 3,
              border: `1.5px solid ${sec.done ? C.done : C.border}`,
              background: sec.done ? `${C.done}20` : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 8, color: C.done, flexShrink: 0,
            }}>
              {sec.done ? "✓" : ""}
            </div>
            <span style={{
              fontSize: 12, color: sec.done ? C.textSec : C.textMuted,
              fontFamily: "var(--sans)", lineHeight: 1.3,
            }}>{sec.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowNode({ children, accent, width, glow }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? C.hover : C.elevated,
        border: `1px solid ${accent ? `${accent}40` : C.border}`,
        borderRadius: 8,
        padding: "14px 16px",
        width: width || "auto",
        transition: "all 0.15s ease",
        boxShadow: glow && hovered ? `0 0 20px ${accent}20` : hovered ? "0 4px 12px rgba(0,0,0,0.25)" : "0 2px 4px rgba(0,0,0,0.15)",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function FlowArrow({ merging }) {
  if (merging) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40, flexShrink: 0, alignSelf: "stretch", justifyContent: "center" }}>
        <div style={{ width: 1, height: 10, background: C.border }} />
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 14, height: 1, background: C.border }} />
          <div style={{ width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `5px solid ${C.border}` }} />
        </div>
        <div style={{ width: 1, height: 10, background: C.border }} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", width: 32, justifyContent: "center", flexShrink: 0 }}>
      <div style={{ width: 20, height: 1, background: C.border }} />
      <div style={{ width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `5px solid ${C.border}` }} />
    </div>
  );
}

function InceptionView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--display)", color: C.text, marginBottom: 4 }}>
          Pre-Inception Preparation
        </div>
        <div style={{ fontSize: 13, color: C.textSec }}>
          Async inputs and persistent context that feed the mob inception session
        </div>
      </div>

      <div>
        <div style={{
          fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 12, fontFamily: "var(--mono)",
        }}>
          Async Inputs
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <BriefCard brief={INCEPTION.intentBrief} accentColor={C.warning} icon="I" />
          <BriefCard brief={INCEPTION.technicalBrief} accentColor="#38bdf8" icon="T" />
        </div>
      </div>

      <div style={{
        background: `${C.surface}cc`,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "18px 22px",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, fontFamily: "var(--mono)", color: C.textMuted,
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            Persistent Project Context
          </div>
          <div style={{
            fontSize: 9, fontFamily: "var(--mono)", color: C.textMuted,
            padding: "2px 6px", borderRadius: 4,
            background: `${C.textMuted}15`, border: `1px solid ${C.textMuted}20`,
          }}>
            .aidlc/
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          {INCEPTION.projectContext.map((ctx, i) => (
            <div key={i} style={{
              flex: "1 1 200px",
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "10px 14px", borderRadius: 6,
              background: C.bg,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: C.done, marginTop: 5, flexShrink: 0,
              }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "var(--mono)", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ctx.file}
                </div>
                <div style={{ fontSize: 11, color: C.textSec, marginBottom: 3, lineHeight: 1.3 }}>
                  {ctx.desc}
                </div>
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "var(--mono)" }}>
                  Updated {ctx.updated}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic", lineHeight: 1.4 }}>
          Created once, maintained over time. AI reads these instead of re-discovering.
        </div>
      </div>

      <div>
        <div style={{
          fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 14, fontFamily: "var(--mono)",
        }}>
          Inception Session Flow
        </div>

        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "24px",
          overflowX: "auto",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0, minWidth: 900 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
              <FlowNode accent={C.warning} width={140}>
                <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.warning, fontWeight: 600, marginBottom: 2 }}>INPUT</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "var(--sans)" }}>Intent Brief</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>{INCEPTION.intentBrief.author}</div>
              </FlowNode>
              <FlowNode accent="#38bdf8" width={140}>
                <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "#38bdf8", fontWeight: 600, marginBottom: 2 }}>INPUT</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "var(--sans)" }}>Technical Brief</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>{INCEPTION.technicalBrief.author}</div>
              </FlowNode>
            </div>

            <FlowArrow merging />

            <FlowNode accent={C.active} glow width={200}>
              <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.active, fontWeight: 600, marginBottom: 6 }}>MOB SESSION</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "var(--sans)", marginBottom: 6 }}>
                Mob Inception
              </div>
              <div style={{ fontSize: 10, color: C.textSec, marginBottom: 8 }}>
                {INCEPTION.mobSession.attendees.length} attendees | {INCEPTION.mobSession.duration}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {INCEPTION.mobSession.steps.map((step, i) => {
                  const stepColor = step.status === "done" ? C.done : step.status === "active" ? C.active : C.textMuted;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{
                        width: 12, height: 12, borderRadius: "50%",
                        border: `1.5px solid ${stepColor}`,
                        background: step.status === "done" ? `${C.done}20` : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 7, color: stepColor, flexShrink: 0,
                      }}>
                        {step.status === "done" ? "✓" : i + 1}
                      </div>
                      <span style={{ fontSize: 10, color: step.status === "done" ? C.textSec : C.textMuted, fontFamily: "var(--sans)" }}>
                        {step.name}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{
                marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.border}`,
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <span style={{ fontSize: 9, color: C.textMuted, fontFamily: "var(--mono)" }}>reads .aidlc/</span>
              </div>
            </FlowNode>

            <FlowArrow />

            <FlowNode accent={C.design} width={170}>
              <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.design, fontWeight: 600, marginBottom: 6 }}>LAYER 2</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "var(--sans)", marginBottom: 6 }}>
                Scoped Discovery
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                {INCEPTION.scopedDiscovery.files.map((f, i) => (
                  <div key={i} style={{
                    fontSize: 10, fontFamily: "var(--mono)", color: C.textSec,
                    padding: "2px 6px", borderRadius: 3,
                    background: `${C.design}10`, border: `1px solid ${C.design}20`,
                  }}>{f}</div>
                ))}
              </div>
              <div style={{
                fontSize: 9, color: C.textMuted, fontStyle: "italic",
              }}>Scoped to THIS intent only</div>
            </FlowNode>

            <FlowArrow />

            <FlowNode accent={C.textSec} width={120}>
              <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.textSec, fontWeight: 600, marginBottom: 4 }}>OUTPUT</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "var(--sans)" }}>Requirements</div>
            </FlowNode>

            <FlowArrow />

            <FlowNode accent={C.textSec} width={130}>
              <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: C.textSec, fontWeight: 600, marginBottom: 4 }}>OUTPUT</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "var(--sans)", marginBottom: 2 }}>Units + Bolts</div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "var(--mono)" }}>outlined</div>
            </FlowNode>

            <FlowArrow />

            <Gate num={1} status={INCEPTION.gate1.status} />
          </div>
        </div>
      </div>

      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "18px 22px",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 14, fontFamily: "var(--mono)",
        }}>
          Adaptive Discovery Depth
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { familiarity: "Deep", sub: "\"we built this\"", depth: "Minimal scan, AI confirms", example: "Migrating Eric's iframe page", color: C.done },
            { familiarity: "Moderate", sub: "\"touched it recently\"", depth: "Standard scoped discovery", example: "Feature in a familiar module", color: C.active },
            { familiarity: "Low", sub: "\"nobody remembers this\"", depth: "Full discovery, AWS-style", example: "Integrating with legacy code", color: C.warning },
          ].map((row, i, arr) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "200px 220px 1fr",
              gap: 20,
              padding: "12px 14px",
              borderLeft: `3px solid ${row.color}`,
              borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none",
              background: i === 0 && INCEPTION.scopedDiscovery.depth === "minimal" ? `${row.color}08`
                : i === 1 && INCEPTION.scopedDiscovery.depth === "standard" ? `${row.color}08`
                : i === 2 && INCEPTION.scopedDiscovery.depth === "full" ? `${row.color}08`
                : "transparent",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "var(--sans)" }}>{row.familiarity}</div>
                <div style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic" }}>{row.sub}</div>
              </div>
              <div style={{ fontSize: 12, color: C.textSec, fontFamily: "var(--sans)", alignSelf: "center" }}>{row.depth}</div>
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: "var(--mono)", alignSelf: "center" }}>{row.example}</div>
            </div>
          ))}
        </div>
        {INCEPTION.scopedDiscovery.reason && (
          <div style={{
            marginTop: 12, padding: "8px 12px", borderRadius: 6,
            background: `${C.done}08`, border: `1px solid ${C.done}20`,
            fontSize: 11, color: C.done, fontFamily: "var(--sans)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontWeight: 600 }}>Active:</span> {INCEPTION.scopedDiscovery.reason}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIDLCDashboard() {
  const [selectedBolt, setSelectedBolt] = useState(null);
  const [view, setView] = useState("pipeline");
  const pct = progress();
  const totalBolts = WORKFLOW.units.reduce((s, u) => s + u.bolts.length, 0);
  const doneBolts = WORKFLOW.units.reduce((s, u) => s + u.bolts.filter(b => b.status === "done").length, 0);

  return (
    <div style={{
      fontFamily: "var(--sans)",
      background: C.bg,
      minHeight: "100vh",
      color: C.text,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,500;0,9..40,700&family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        :root {
          --sans: 'DM Sans', system-ui, sans-serif;
          --mono: 'JetBrains Mono', monospace;
          --display: 'Syne', system-ui, sans-serif;
        }
        * { box-sizing: border-box; margin: 0; }
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 40px" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: C.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Active Workflow
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 800, fontFamily: "var(--display)", color: C.text, marginBottom: 4, letterSpacing: "-0.01em" }}>
                {WORKFLOW.intent.name}
              </h1>
              <p style={{ fontSize: 14, color: C.textSec }}>{WORKFLOW.intent.desc}</p>
            </div>

            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <Stat label="Units" value={WORKFLOW.units.length} />
              <Stat label="Bolts" value={`${doneBolts}/${totalBolts}`} />
              <Stat label="Squads" value={Object.keys(SQUADS).length} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--mono)", color: C.text }}>{pct}%</span>
                <div style={{ width: 120, height: 6, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${C.done}, ${C.active})`, transition: "width 0.5s ease" }} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 0, background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            {[
              { id: "pipeline", label: "Pipeline View" },
              { id: "board", label: "Board View" },
              { id: "inception", label: "Inception" },
            ].map(tab => (
              <button key={tab.id} onClick={() => setView(tab.id)} style={{
                padding: "10px 20px", border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: view === tab.id ? 700 : 400,
                fontFamily: "var(--sans)",
                color: view === tab.id ? C.text : C.textMuted,
                background: view === tab.id ? C.elevated : "transparent",
                borderRight: `1px solid ${C.border}`,
                transition: "all 0.15s ease",
              }}>{tab.label}</button>
            ))}
            <div style={{ flex: 1, display: "flex", gap: 16, padding: "0 16px", justifyContent: "flex-end", alignItems: "center" }}>
              <LegendItem color={C.done} label="Done" />
              <LegendItem color={C.active} label="Active" />
              <LegendItem color={C.pending} label="Pending" />
              <LegendItem color={C.blocked} label="Blocked" />
            </div>
          </div>
        </div>

        {view === "pipeline" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {WORKFLOW.units.map(unit => (
              <UnitLane
                key={unit.id}
                unit={unit}
                selectedBolt={selectedBolt}
                onBoltClick={setSelectedBolt}
              />
            ))}
          </div>
        )}

        {view === "inception" && (
          <InceptionView />
        )}
      </div>

      {selectedBolt && (
        <>
          <div
            onClick={() => setSelectedBolt(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 99 }}
          />
          <DetailPanel bolt={selectedBolt} onClose={() => setSelectedBolt(null)} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--mono)", color: C.text }}>{value}</div>
      <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 11, color: C.textSec }}>{label}</span>
    </div>
  );
}
