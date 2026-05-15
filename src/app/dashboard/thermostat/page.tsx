'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = "HEAT" | "OFF" | "AUTO" | "COOL";

type SensorData = {
  temp: number;
  hum: number;
  co2: number;
  timestamp?: string;
};

type ScheduleItem = {
  id: string;
  at: number;
  end: number;
  temp: number;
};

type ControlPatch = Partial<{
  mode: Mode;
  setpoint: number;
  useSchedule: boolean;
  schedule: { at: number; end: number; temp: number }[];
  overrideMode: boolean;
  overrideSetpoint: number | null;
  humidifier: boolean;
  cooling_fan: number;
  heater: boolean;
}>;


function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function roundTo(n: number, step: number) {
  return Math.round(n / step) * step;
}
function minutesToTimeLabel(m: number) {
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h12 = ((hh + 11) % 12) + 1;
  const ampm = hh >= 12 ? "PM" : "AM";
  return `${h12}:${mm.toString().padStart(2, "0")} ${ampm}`;
}
function minutesToInput(m: number) {
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function createScheduleItem(at: number, end: number, temp: number): ScheduleItem {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    at, end, temp,
  };
}
function computeScheduledTemp(
  schedule: ScheduleItem[],
  fallback: number
): { temp: number; activeId: string | null } {
  if (!schedule.length) return { temp: fallback, activeId: null };
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const item of schedule) {
    const spansMidnight = item.end <= item.at;
    const active = spansMidnight
      ? minutes >= item.at || minutes < item.end
      : minutes >= item.at && minutes < item.end;
    if (active) return { temp: item.temp, activeId: item.id };
  }
  return { temp: fallback, activeId: null };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_TEMP = 10;
const MAX_TEMP = 40;
const HYSTERESIS = 0.5;

// ─── Mode palette ─────────────────────────────────────────────────────────────

const PALETTE = {
  HEAT: {
    ring: "#fb923c",
    glow: "rgba(251,146,60,0.18)",
    glowStrong: "rgba(251,146,60,0.35)",
    text: "text-orange-400",
    border: "border-orange-500/25",
    bg: "bg-orange-500/5",
    led: "bg-orange-400",
    accent: "#fb923c",
  },
  COOL: {
    ring: "#60a5fa",
    glow: "rgba(96,165,250,0.18)",
    glowStrong: "rgba(96,165,250,0.35)",
    text: "text-blue-400",
    border: "border-blue-500/25",
    bg: "bg-blue-500/5",
    led: "bg-blue-400",
    accent: "#60a5fa",
  },
  AUTO: {
    ring: "#38bdf8",
    glow: "rgba(56,189,248,0.15)",
    glowStrong: "rgba(56,189,248,0.3)",
    text: "text-sky-400",
    border: "border-sky-500/25",
    bg: "bg-sky-500/5",
    led: "bg-sky-400",
    accent: "#38bdf8",
  },
  OFF: {
    ring: "#3f3f46",
    glow: "transparent",
    glowStrong: "transparent",
    text: "text-zinc-500",
    border: "border-zinc-800",
    bg: "bg-zinc-900/20",
    led: "bg-zinc-600",
    accent: "#52525b",
  },
};

// ─── Custom temp slider ───────────────────────────────────────────────────────

function TempSlider({
  value,
  min = MIN_TEMP,
  max = MAX_TEMP,
  step = 0.5,
  color = "#38bdf8",
  onChange,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  color?: string;
  onChange: (v: number) => void;    // local state, instant
  onCommit: (v: number) => void;    // network call
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const pct = ((value - min) / (max - min)) * 100;

  const compute = useCallback((clientX: number): number => {
    if (!trackRef.current) return value;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return roundTo(min + ratio * (max - min), step);
  }, [min, max, step, value]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      onChange(compute(e.clientX));
    };
    const onUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const v = compute(e.clientX);
      onChange(v);
      onCommit(v);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [compute, onChange, onCommit]);

  return (
    <div className="relative flex items-center gap-3 select-none">
      <span className="text-[10px] tabular-nums text-zinc-600 w-6 text-right shrink-0">
        {min}°
      </span>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative flex-1 h-1.5 rounded-full bg-zinc-800 cursor-pointer"
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const v = compute(e.clientX);
          onChange(v);
        }}
      >
        {/* Fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-none"
          style={{ width: `${pct}%`, background: color }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 bg-zinc-950 shadow-lg transition-none"
          style={{ left: `${pct}%`, borderColor: color,
            boxShadow: `0 0 8px ${color}88` }}
        />
      </div>

      <span className="text-[10px] tabular-nums text-zinc-600 w-6 shrink-0">
        {max}°
      </span>

      {/* Live readout */}
      <span
        className="text-sm font-bold tabular-nums w-14 text-right shrink-0"
        style={{ color }}
      >
        {value.toFixed(1)}°C
      </span>
    </div>
  );
}

// ─── LED dot ──────────────────────────────────────────────────────────────────

function Led({ on, color, label }: { on: boolean; color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-3 h-3 flex items-center justify-center">
        {on && (
          <span className={`absolute inset-0 rounded-full ${color} opacity-50 animate-ping`} />
        )}
        <span className={`relative w-3 h-3 rounded-full ${on ? color : "bg-zinc-700"} transition-colors duration-500`} />
      </div>
      <span className="text-[9px] uppercase tracking-widest text-zinc-600">{label}</span>
    </div>
  );
}

// ─── Readout row ──────────────────────────────────────────────────────────────

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
      <span className="text-[10px] uppercase tracking-[0.15em] text-zinc-600">{label}</span>
      <span className={`font-mono text-xs font-semibold ${highlight ? "text-zinc-100" : "text-zinc-400"}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ThermostatPage() {
  const [sensorReadings, setSensorReadings] = useState<SensorData[]>([]);
  const lastReading = sensorReadings.at(-1);
  const prevReading = sensorReadings.at(-2);
  const lastTempNumber = lastReading?.temp ?? NaN;
  const lastTemp = Number.isFinite(lastTempNumber) ? lastTempNumber.toFixed(1) : "--";

  const [mode, setMode] = useState<Mode>("HEAT");
  const [targetTemp, setTargetTemp] = useState(23.0);
  const [useSchedule, setUseSchedule] = useState(true);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideSetpoint, setOverrideSetpoint] = useState<number | null>(null);
  const [coolingFan, setCoolingFan] = useState(0);
  const [humidifier, setHumidifier] = useState(false);
  const [heaterStatus, setHeaterStatus] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([
    createScheduleItem(6 * 60, 8 * 60, 22.0),
  ]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // ─── Derived ─────────────────────────────────────────────────────────────

  const { temp: scheduledTemp, activeId: activeScheduleId } = useMemo(
    () => computeScheduledTemp(schedule, targetTemp),
    [schedule, targetTemp]
  );
  const scheduleIsActive = activeScheduleId !== null;

  const effectiveSetpoint = useMemo(() => {
    if (mode === "OFF") return targetTemp;
    if (overrideMode && overrideSetpoint != null) return overrideSetpoint;
    if (useSchedule) return scheduledTemp;
    return targetTemp;
  }, [mode, overrideMode, overrideSetpoint, useSchedule, scheduledTemp, targetTemp]);

  const displayMode = useMemo<Mode>(() => {
    if (mode === "OFF") return "OFF";

    // Determine the setpoint we're actually comparing against
    const sp = overrideMode && overrideSetpoint != null
      ? overrideSetpoint
      : effectiveSetpoint;

    if (!Number.isFinite(lastTempNumber)) return mode; // no sensor data yet

    const needsHeat = lastTempNumber < sp - HYSTERESIS;
    const needsCool = lastTempNumber > sp + HYSTERESIS;

    if (mode === "HEAT") {
      // Heater-only: show Heating when below setpoint, Holding when at/above
      return needsHeat ? "HEAT" : "AUTO";
    }
    if (mode === "COOL") {
      // Cooler-only: show Cooling when above setpoint, Holding when at/below
      return needsCool ? "COOL" : "AUTO";
    }
    // AUTO: show whichever direction is needed
    if (needsHeat) return "HEAT";
    if (needsCool) return "COOL";
    return "AUTO";
  }, [mode, overrideMode, overrideSetpoint, effectiveSetpoint, lastTempNumber]);

  const coolCall = useMemo(() => {
    if (displayMode === "OFF") return false;
    if (mode === "HEAT") return false; // heater-only mode never cools
    return lastTempNumber > effectiveSetpoint + HYSTERESIS;
  }, [displayMode, mode, lastTempNumber, effectiveSetpoint]);

  const pal = PALETTE[displayMode];

  // ─── Dial arc ─────────────────────────────────────────────────────────────

  const R = 88;
  const circumference = 2 * Math.PI * R;
  const ringRatio = clamp((effectiveSetpoint - MIN_TEMP) / (MAX_TEMP - MIN_TEMP), 0, 1);
  const dash = circumference * ringRatio;
  const gap = circumference - dash;

  // Tick marks
  const ticks = Array.from({ length: 31 }, (_, i) => {
    const angleDeg = -210 + (240 / 30) * i;
    const rad = (angleDeg * Math.PI) / 180;
    const major = i % 5 === 0;
    const outer = major ? 80 : 83;
    const inner = major ? 73 : 79;
    return { x1: 100 + outer * Math.cos(rad), y1: 100 + outer * Math.sin(rad),
             x2: 100 + inner * Math.cos(rad), y2: 100 + inner * Math.sin(rad), major };
  });

  // ─── API ──────────────────────────────────────────────────────────────────

  function applyServerData(data: any) {
    setMode(data.mode);
    setTargetTemp(data.setpoint);
    setUseSchedule(data.useSchedule);
    setSchedule(
      Array.isArray(data.schedule)
        ? data.schedule.map((item: any) =>
            createScheduleItem(item.at ?? 0, item.end ?? item.at + 60, item.temp ?? 0))
        : []
    );
    setOverrideMode(data.overrideMode ?? false);
    setOverrideSetpoint(data.overrideSetpoint ?? null);
    setCoolingFan(data.cooling_fan ?? 0);
    setHumidifier(data.humidifier ?? false);
    setHeaterStatus(data.heater ?? false);
  }

  async function syncControlState() {
    try { applyServerData(await (await fetch("/api/control")).json()); }
    catch (err) { console.error("Sync failed", err); }
  }

  async function sendControlPatch(patch: ControlPatch) {
    setIsSyncing(true);
    try { applyServerData(await (await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })).json()); }
    catch (err) { console.error("Patch failed", err); }
    finally { setIsSyncing(false); }
  }

  useEffect(() => {
    async function loadSensors() {
      try {
        const json = await (await fetch("/api/readings")).json();
        if (Array.isArray(json)) setSensorReadings(json.map((row) => ({
          temp: row.bme_temp, hum: row.scd_hum, co2: row.scd_co2, timestamp: row.timestamp,
        })));
      } catch {}
    }
    loadSensors();
    const id = setInterval(loadSensors, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    syncControlState();
    const id = setInterval(syncControlState, 10000);
    return () => clearInterval(id);
  }, []);

  // ─── Dial drag ────────────────────────────────────────────────────────────

  function handleDialPointer(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const start = (-210 * Math.PI) / 180;
    const end   = (30  * Math.PI) / 180;
    let a = angle;
    while (a < start) a += 2 * Math.PI;
    while (a > start + 2 * Math.PI) a -= 2 * Math.PI;
    const snapped = roundTo(MIN_TEMP + clamp((a - start) / (end - start), 0, 1) * (MAX_TEMP - MIN_TEMP), 0.5);
    setUseSchedule(false);
    setTargetTemp(snapped);
  }

  // ─── Schedule helpers ─────────────────────────────────────────────────────

  function patchSchedule(next: ScheduleItem[]) {
    setSchedule(next);
    sendControlPatch({ schedule: next.map(({ at, end, temp }) => ({ at, end, temp })) });
  }

  function addScheduleItem() {
    const now = new Date();
    const at = (now.getHours() + 1) * 60;
    patchSchedule([...schedule, createScheduleItem(at, at + 60, 22.0)]);
  }

  // LOCAL-only update — instant, no network call
  function localUpdateTemp(id: string, temp: number) {
    setSchedule((prev) => prev.map((e) => e.id === id ? { ...e, temp } : e));
  }

  // COMMIT — fires on pointer-up, sends to server
  function commitTemp(id: string, temp: number) {
    const next = schedule.map((e) => e.id === id ? { ...e, temp } : e);
    setSchedule(next);
    sendControlPatch({ schedule: next.map(({ at, end, temp }) => ({ at, end, temp })) });
  }

  function updateTimeField(id: string, field: "at" | "end", value: number) {
    const next = schedule.map((e) => e.id === id ? { ...e, [field]: value } : e);
    patchSchedule(next);
  }

  function removeScheduleItem(id: string) {
    patchSchedule(schedule.filter((e) => e.id !== id));
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const dialLabel = mode === "OFF" ? "System Off"
    : overrideMode ? "Override Active"
    : displayMode === "HEAT" ? "Heating"
    : displayMode === "COOL" ? "Cooling"
    : "Holding";

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 font-mono">

      {/* Override banner */}
      {overrideMode && overrideSetpoint != null && (
        <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-semibold">
              Physical Override — {overrideSetpoint}°C
            </span>
          </div>
          <button
            onClick={() => sendControlPatch({ overrideMode: false, overrideSetpoint: null })}
            className="text-[10px] uppercase tracking-widest text-amber-500 border border-amber-500/40 rounded-lg px-3 py-1 hover:bg-amber-500/10 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-600 mb-0.5">Climate Control</p>
          <h1 className="text-base font-semibold text-zinc-200 tracking-tight">Thermostat</h1>
        </div>

        <div className="flex items-center gap-1.5">
          {isSyncing && <span className="text-[10px] text-zinc-600 uppercase tracking-widest animate-pulse mr-2">Syncing</span>}
          {(["HEAT", "COOL", "AUTO", "OFF"] as Mode[]).map((m) => {
            const active = mode === m;
            const p = PALETTE[m];
            return (
              <button
                key={m}
                onClick={() => sendControlPatch(
                  m === "OFF"
                    ? { mode: "OFF", overrideMode: false, overrideSetpoint: null }
                    : { mode: m }
                )}
                className={`px-3 py-1.5 text-[10px] uppercase tracking-widest rounded-lg border transition-all duration-200 ${
                  active
                    ? `${p.bg} ${p.border} ${p.text}`
                    : "bg-transparent border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">

        {/* ── LEFT: Dial ───────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Dial card */}
          <div
            className={`rounded-2xl border ${pal.border} p-6 transition-all duration-700`}
            style={{ background: `radial-gradient(ellipse at 50% 0%, ${pal.glow} 0%, #09090b 60%)` }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                {overrideMode ? "Override" : useSchedule ? scheduleIsActive ? "Schedule Active" : "Schedule (manual fallback)" : "Manual"}
              </span>
              <button
                onClick={() => sendControlPatch({ useSchedule: !useSchedule })}
                className={`text-[10px] uppercase tracking-widest border rounded-lg px-2.5 py-1 transition-colors ${
                  useSchedule
                    ? "border-sky-500/40 text-sky-400 bg-sky-500/10"
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
                }`}
              >
                {useSchedule ? "Schedule" : "Manual"}
              </button>
            </div>

            {/* Dial */}
            <div className="flex justify-center">
              <div
                className="relative w-[256px] h-[256px] select-none cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                  setDragging(true);
                  handleDialPointer(e);
                }}
                onPointerMove={(e) => dragging && handleDialPointer(e)}
                onPointerUp={() => {
                  setDragging(false);
                  sendControlPatch({ setpoint: targetTemp, useSchedule: false });
                }}
              >
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                  {/* Background glow */}
                  <defs>
                    <radialGradient id="dialGlow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={pal.ring} stopOpacity="0.06" />
                      <stop offset="100%" stopColor={pal.ring} stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <circle cx="100" cy="100" r="95" fill="url(#dialGlow)" />

                  {/* Tick marks */}
                  {ticks.map((t, i) => (
                    <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                      stroke={t.major ? "#3f3f46" : "#27272a"} strokeWidth={t.major ? 1.5 : 1} />
                  ))}

                  {/* Track (240° arc) */}
                  <circle cx="100" cy="100" r={R}
                    fill="none" stroke="#1c1c1e" strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={`${circumference * 0.667} ${circumference * 0.333}`}
                    transform="rotate(-210 100 100)" />

                  {/* Active arc */}
                  <circle cx="100" cy="100" r={R}
                    fill="none" strokeWidth="7" strokeLinecap="round"
                    stroke={pal.ring}
                    strokeDasharray={`${dash} ${gap}`}
                    transform="rotate(-210 100 100)"
                    style={{ filter: `drop-shadow(0 0 4px ${pal.ring}88)`, transition: "stroke-dasharray 0.15s ease" }}
                  />

                  {/* Inner plate */}
                  <circle cx="100" cy="100" r="68" fill="#0a0a0b" />
                </svg>

                {/* Center readout */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <span className={`text-[9px] uppercase tracking-[0.3em] ${pal.text}`}>
                    {dialLabel}
                  </span>
                  <span className={`text-5xl font-bold tabular-nums leading-none ${pal.text}`}>
                    {effectiveSetpoint.toFixed(1)}
                  </span>
                  <span className="text-[10px] text-zinc-700">°C setpoint</span>

                  {useSchedule && !overrideMode && mode !== "OFF" && (
                    <span className="text-[9px] text-zinc-600 mt-0.5">
                      {scheduleIsActive ? "from schedule" : "from manual"}
                    </span>
                  )}

                  <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                    <span className="text-zinc-600">now</span>
                    <span className="text-zinc-200 font-semibold tabular-nums">{lastTemp}°C</span>
                    {prevReading && Number.isFinite(lastTempNumber) && (
                      lastTempNumber > prevReading.temp
                        ? <span className="text-orange-400 text-[10px]">▲</span>
                        : lastTempNumber < prevReading.temp
                        ? <span className="text-blue-400 text-[10px]">▼</span>
                        : <span className="text-zinc-700 text-[10px]">▬</span>
                    )}
                  </div>

                  {/* +/- — swallow pointer events so they don't reach the drag handler */}
                  <div
                    className="mt-3 flex items-center gap-2"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerMove={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                  >
                    {[["−", -0.5], ["+", 0.5]].map(([label, delta]) => (
                      <button
                        key={label as string}
                        className="w-8 h-8 rounded-full border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 text-sm flex items-center justify-center transition-colors"
                        onClick={() => {
                          const next = clamp(targetTemp + (delta as number), MIN_TEMP, MAX_TEMP);
                          sendControlPatch({ setpoint: next, useSchedule: false });
                        }}
                      >{label}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* LED row */}
            <div className="mt-5 pt-4 border-t border-zinc-800/50 flex items-center justify-around">
              <Led on={heaterStatus} color={PALETTE.HEAT.led} label="Heater" />
              <Led on={coolCall} color={PALETTE.COOL.led} label="Fan" />
              <Led on={humidifier} color="bg-teal-400" label="Humid" />
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-sm font-bold tabular-nums text-zinc-300">{coolingFan}%</span>
                <span className="text-[9px] uppercase tracking-widest text-zinc-600">PWM</span>
              </div>
            </div>
          </div>

          {/* Readout strip */}
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 px-5 py-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 mb-2">Readout</p>
            <Row label="Effective Setpoint" value={`${effectiveSetpoint.toFixed(1)} °C`} highlight />
            <Row label="Scheduled Setpoint" value={scheduleIsActive ? `${scheduledTemp.toFixed(1)} °C` : "—"} />
            <Row label="Manual Setpoint"    value={`${targetTemp.toFixed(1)} °C`} />
            <Row label="Sensor Temp"        value={`${lastTemp} °C`} highlight />
            <Row label="Humidity"           value={lastReading ? `${lastReading.hum.toFixed(0)} %` : "--"} />
            <Row label="CO₂"               value={lastReading ? `${lastReading.co2} ppm` : "--"} />
            <Row label="Setpoint Source"
              value={mode === "OFF" ? "OFF" : overrideMode ? "OVERRIDE" : useSchedule && scheduleIsActive ? "SCHEDULE" : "MANUAL"}
              highlight />
          </div>

          {/* Fan + Humidifier */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 mb-1">Cooling Fan</p>
              <p className="text-2xl font-bold tabular-nums text-zinc-200 mb-3">
                {coolingFan}<span className="text-sm text-zinc-600 ml-1">%</span>
              </p>
              <TempSlider
                value={coolingFan}
                min={0} max={100} step={1}
                color={PALETTE.COOL.accent}
                onChange={(v) => setCoolingFan(v)}
                onCommit={(v) => sendControlPatch({ cooling_fan: v })}
              />
            </div>

            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 mb-1">Humidifier</p>
              <p className="text-2xl font-bold tabular-nums text-zinc-200 mb-3">
                {humidifier ? "ON" : "OFF"}
              </p>
              <button
                onClick={() => sendControlPatch({ humidifier: !humidifier })}
                className={`w-full py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest border transition-all duration-200 ${
                  humidifier
                    ? "bg-teal-500/15 border-teal-500/40 text-teal-400"
                    : "bg-transparent border-zinc-700 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400"
                }`}
              >
                {humidifier ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Schedule ──────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">Daily Schedule</p>
              <p className="text-sm text-zinc-300 mt-0.5">Time ranges · falls back to manual</p>
            </div>
            <button
              onClick={addScheduleItem}
              className="text-[10px] uppercase tracking-widest border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              + Add
            </button>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto pr-1">
            {schedule.length === 0 && (
              <div className="rounded-xl border border-zinc-800/50 border-dashed p-8 text-center text-[11px] text-zinc-600">
                No ranges — all times use the manual setpoint
              </div>
            )}

            {[...schedule].sort((a, b) => a.at - b.at).map((item) => {
              const isActive = item.id === activeScheduleId;
              const spansMidnight = item.end <= item.at;
              const dur = spansMidnight ? 24 * 60 - item.at + item.end : item.end - item.at;
              const h = Math.floor(dur / 60);
              const m = dur % 60;
              const p = isActive ? pal : PALETTE.OFF;

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 transition-colors duration-300 ${
                    isActive ? `${p.border} ${p.bg}` : "border-zinc-800/50 bg-zinc-900/30"
                  }`}
                >
                  {/* Top row */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {isActive && (
                        <span className={`h-2 w-2 rounded-full ${pal.led} animate-pulse`} />
                      )}
                      <span className={`text-[10px] uppercase tracking-widest font-semibold ${isActive ? pal.text : "text-zinc-600"}`}>
                        {isActive ? "Active" : "Inactive"}
                        {spansMidnight && <span className="ml-2 text-amber-500/70">↻ midnight</span>}
                      </span>
                    </div>
                    <button
                      onClick={() => removeScheduleItem(item.id)}
                      className="text-[10px] text-zinc-700 hover:text-red-400 border border-zinc-800 hover:border-red-500/30 rounded-lg px-2 py-0.5 transition-colors"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Time pickers */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Start</p>
                      <input
                        type="time"
                        value={minutesToInput(item.at)}
                        onChange={(e) => {
                          const [hh, mm] = e.target.value.split(":").map(Number);
                          updateTimeField(item.id, "at", hh * 60 + mm);
                        }}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-300 focus:border-zinc-600 outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">End</p>
                      <input
                        type="time"
                        value={minutesToInput(item.end)}
                        onChange={(e) => {
                          const [hh, mm] = e.target.value.split(":").map(Number);
                          updateTimeField(item.id, "end", hh * 60 + mm);
                        }}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-300 focus:border-zinc-600 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {/* Temp slider — smooth, no network spam */}
                  <TempSlider
                    value={item.temp}
                    color={isActive ? pal.accent : PALETTE.AUTO.accent}
                    onChange={(v) => localUpdateTemp(item.id, v)}
                    onCommit={(v) => commitTemp(item.id, v)}
                  />

                  {/* Duration footer */}
                  <p className="mt-2.5 text-[9px] text-zinc-700 text-right tabular-nums">
                    {minutesToTimeLabel(item.at)} → {minutesToTimeLabel(item.end)}
                    {" "}({h > 0 ? `${h}h ` : ""}{m > 0 ? `${m}m` : ""})
                  </p>
                </div>
              );
            })}
          </div>

          {/* Footer summary */}
          <div className="mt-4 pt-4 border-t border-zinc-800/50 space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="uppercase tracking-widest text-zinc-600">Manual Setpoint</span>
              <span className="font-bold tabular-nums text-zinc-400">{targetTemp.toFixed(1)}°C</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="uppercase tracking-widest text-zinc-600">
                {scheduleIsActive ? "Active Range" : "No Range Active"}
              </span>
              <span className="font-bold tabular-nums text-zinc-400">
                {scheduleIsActive ? `${scheduledTemp.toFixed(1)}°C` : "—"}
              </span>
            </div>
            <div className="flex justify-between text-[11px] border-t border-zinc-800/50 pt-1.5">
              <span className="uppercase tracking-widest text-zinc-500">Effective</span>
              <span className={`font-bold tabular-nums ${pal.text}`}>{effectiveSetpoint.toFixed(1)}°C</span>
            </div>
            {overrideMode && (
              <p className="text-[9px] text-amber-400/80 uppercase tracking-widest pt-0.5">
                ⚠ Override active — schedule paused
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}