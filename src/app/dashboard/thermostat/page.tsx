'use client';

import { useEffect, useMemo, useState } from "react";

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
  at: number;   // minutes since midnight
  temp: number;
};

type ControlPatch = Partial<{
  mode: Mode;
  setpoint: number;
  useSchedule: boolean;
  schedule: { at: number; temp: number }[];
  overrideMode: boolean;
  overrideSetpoint: number | null;
  humidifier: boolean;
  cooling_fan: number;
  heater: boolean;
}>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function roundTo(n: number, step: number) {
  return Math.round(n / step) * step;
}

function minutesToTimeLabel(m: number) {
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = ((hh + 11) % 12) + 1;
  const ampm = hh >= 12 ? "PM" : "AM";
  return `${h12}:${mm.toString().padStart(2, "0")} ${ampm}`;
}

function createScheduleItem(at: number, temp: number): ScheduleItem {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    at,
    temp,
  };
}

/** Returns the active scheduled temp for right now, or fallback if schedule is empty. */
function computeScheduledTemp(
  schedule: { at: number; temp: number }[],
  fallback: number
): number {
  if (!schedule.length) return fallback;

  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();

  const sorted = [...schedule].sort((a, b) => a.at - b.at);
  // Walk backwards to find the last entry that has already triggered
  const active = [...sorted].reverse().find((s) => s.at <= minutes);

  // If nothing triggered yet today, wrap around to the last item of the previous day
  return active ? active.temp : sorted[sorted.length - 1].temp;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_TEMP = 10;
const MAX_TEMP = 40;
const HYSTERESIS = 0.5;

// ─── Component ───────────────────────────────────────────────────────────────

export default function ThermostatPage() {
  // Sensor
  const [sensorReadings, setSensorReadings] = useState<SensorData[]>([]);
  const lastReading = sensorReadings.at(-1);
  const prevReading = sensorReadings.at(-2);
  const lastTempNumber = lastReading?.temp ?? NaN;
  const lastTemp = Number.isFinite(lastTempNumber)
    ? lastTempNumber.toFixed(1)
    : "--";

  // Control state (mirrored from server)
  const [mode, setMode] = useState<Mode>("HEAT");
  const [targetTemp, setTargetTemp] = useState(23.0);
  const [useSchedule, setUseSchedule] = useState(true);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideSetpoint, setOverrideSetpoint] = useState<number | null>(null);
  const [coolingFan, setCoolingFan] = useState(0);
  const [humidifier, setHumidifier] = useState(false);
  const [heaterStatus, setHeaterStatus] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([
    createScheduleItem(6 * 60, 22.0),
  ]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // ─── Derived / computed values ──────────────────────────────────────────

  const scheduledTemp = useMemo(
    () => computeScheduledTemp(schedule, targetTemp),
    [schedule, targetTemp]
  );

  /**
   * The temperature the system is actually trying to reach.
   * Priority: OFF (no target) → Override → Schedule → Manual
   *
   * BUG FIX: When mode is OFF we short-circuit immediately so no
   * actuation logic ever fires based on a stale setpoint.
   */
  const effectiveSetpoint = useMemo(() => {
    if (mode === "OFF") return targetTemp; // display only; actuators won't fire
    if (overrideMode && overrideSetpoint != null) return overrideSetpoint;
    return useSchedule ? scheduledTemp : targetTemp;
  }, [mode, overrideMode, overrideSetpoint, useSchedule, scheduledTemp, targetTemp]);

  /**
   * The mode label shown on the dial.
   *
   * BUG FIX: OFF is checked first so override logic can never hijack it.
   */
  const displayMode = useMemo<Mode>(() => {
    if (mode === "OFF") return "OFF";
    if (!overrideMode || overrideSetpoint == null) return mode;
    if (lastTempNumber < overrideSetpoint - HYSTERESIS) return "HEAT";
    if (lastTempNumber > overrideSetpoint + HYSTERESIS) return "COOL";
    return "AUTO";
  }, [mode, overrideMode, overrideSetpoint, lastTempNumber]);

  /** True when heater should be on. Never fires when mode is OFF. */
  const heatCall = useMemo(() => {
    if (displayMode === "OFF" || displayMode === "COOL") return false;
    return lastTempNumber < effectiveSetpoint - HYSTERESIS;
  }, [displayMode, lastTempNumber, effectiveSetpoint]);

  /** True when cooling fan should be on. Never fires when mode is OFF. */
  const coolCall = useMemo(() => {
    if (displayMode === "OFF" || displayMode === "HEAT") return false;
    return lastTempNumber > effectiveSetpoint + HYSTERESIS;
  }, [displayMode, lastTempNumber, effectiveSetpoint]);

  // ─── Dial ring arc ──────────────────────────────────────────────────────

  const ringRatio = clamp(
    (effectiveSetpoint - MIN_TEMP) / (MAX_TEMP - MIN_TEMP),
    0,
    1
  );
  const circumference = 2 * Math.PI * 88;
  const dash = circumference * ringRatio;
  const gap = circumference - dash;

  // ─── API helpers ────────────────────────────────────────────────────────

  function applyServerData(data: any) {
    setMode(data.mode);
    setTargetTemp(data.setpoint);
    setUseSchedule(data.useSchedule);
    setSchedule(
      Array.isArray(data.schedule)
        ? data.schedule.map((item: any) =>
            createScheduleItem(item.at ?? 0, item.temp ?? 0)
          )
        : []
    );
    setOverrideMode(data.overrideMode ?? false);
    setOverrideSetpoint(data.overrideSetpoint ?? null);
    setCoolingFan(data.cooling_fan ?? 0);
    setHumidifier(data.humidifier ?? false);
    setHeaterStatus(data.heater ?? false);
  }

  async function syncControlState() {
    try {
      const res = await fetch("/api/control");
      applyServerData(await res.json());
    } catch (err) {
      console.error("Failed to sync control state", err);
    }
  }

  async function sendControlPatch(patch: ControlPatch) {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      applyServerData(await res.json());
    } catch (err) {
      console.error("Failed to update control state", err);
    } finally {
      setIsSyncing(false);
    }
  }

  // ─── Polling ────────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadSensors() {
      try {
        const res = await fetch("/api/readings");
        const json = await res.json();
        if (Array.isArray(json)) {
          setSensorReadings(
            json.map((row) => ({
              temp: row.bme_temp,
              hum: row.scd_hum,
              co2: row.scd_co2,
              timestamp: row.timestamp,
            }))
          );
        }
      } catch {
        /* keep last known readings */
      }
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

  // ─── Dial drag handler ──────────────────────────────────────────────────

  function handleDialPointer(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const x = e.clientX - cx;
    const y = e.clientY - cy;

    const angle = Math.atan2(y, x);
    const start = (-210 * Math.PI) / 180;
    const end = (30 * Math.PI) / 180;

    let a = angle;
    while (a < start) a += 2 * Math.PI;
    while (a > start + 2 * Math.PI) a -= 2 * Math.PI;

    const t = (a - start) / (end - start);
    const ratio = clamp(t, 0, 1);
    const temp = MIN_TEMP + ratio * (MAX_TEMP - MIN_TEMP);
    const snapped = roundTo(temp, 0.5);

    setUseSchedule(false);
    setTargetTemp(snapped);
  }

  // ─── Schedule helpers ───────────────────────────────────────────────────

  function addScheduleItem() {
    const next = [...schedule, createScheduleItem(12 * 60, 21.0)].sort(
      (a, b) => a.at - b.at
    );
    setSchedule(next);
    sendControlPatch({ schedule: next.map(({ at, temp }) => ({ at, temp })) });
  }

  function updateScheduleTemp(id: string, temp: number) {
    const next = schedule.map((e) => (e.id === id ? { ...e, temp } : e));
    setSchedule(next);
    sendControlPatch({ schedule: next.map(({ at, temp }) => ({ at, temp })) });
  }

  function updateScheduleTime(id: string, at: number) {
    const next = schedule
      .map((e) => (e.id === id ? { ...e, at } : e))
      .sort((a, b) => a.at - b.at);
    setSchedule(next);
    sendControlPatch({ schedule: next.map(({ at, temp }) => ({ at, temp })) });
  }

  function removeScheduleItem(id: string) {
    const next = schedule.filter((e) => e.id !== id);
    setSchedule(next);
    sendControlPatch({ schedule: next.map(({ at, temp }) => ({ at, temp })) });
  }

  // ─── Dial label helpers ─────────────────────────────────────────────────

  const dialLabel = (() => {
    if (mode === "OFF") return "System Off";
    if (overrideMode) return "⚠ Override Active";
    if (displayMode === "HEAT") return "Heating";
    if (displayMode === "COOL") return "Cooling";
    return "Holding";
  })();

  const ringColor = (() => {
    if (displayMode === "OFF") return "text-zinc-700";
    if (displayMode === "HEAT") return "text-orange-400";
    if (displayMode === "COOL") return "text-blue-400";
    return "text-sky-400";
  })();

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">

      {/* Override banner */}
      {overrideMode && overrideSetpoint != null && (
        <div className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-center">
          <div className="text-lg font-semibold text-amber-400">
            ⚠ Override Mode Active
          </div>
          <div className="mt-1 text-sm opacity-80">
            Holding at {overrideSetpoint}°C — schedule and manual setpoint are
            paused until override is cleared.
          </div>
          <button
            onClick={() =>
              sendControlPatch({ overrideMode: false, overrideSetpoint: null })
            }
            className="mt-3 rounded-full border border-amber-500/60 px-4 py-1 text-sm text-amber-400 hover:bg-amber-500/20"
          >
            Clear Override
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">Thermostat</h1>
          <p className="mt-1 text-sm opacity-70">
            Schedule → Setpoint → Compare to sensor → Heater + Fan + Humidifier
          </p>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-2">
          {(["HEAT", "COOL", "AUTO", "OFF"] as Mode[]).map((m) => (
            <button
              key={m}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                mode === m ? "bg-white/10" : "bg-transparent"
              }`}
              onClick={() =>
                sendControlPatch(
                  m === "OFF"
                    ? // BUG FIX: clear override when switching OFF so stale
                      // setpoints never drive the actuators
                      { mode: "OFF", overrideMode: false, overrideSetpoint: null }
                    : { mode: m }
                )
              }
            >
              {m[0] + m.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">

        {/* ── Left: Dial + actuator status ── */}
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-6">

          <div className="flex items-center justify-between">
            <div className="text-sm opacity-70">
              {overrideMode
                ? "Override setpoint"
                : useSchedule
                ? "Scheduled setpoint"
                : "Manual setpoint"}
            </div>
            <button
              onClick={() =>
                sendControlPatch({ useSchedule: !useSchedule })
              }
              className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
            >
              {useSchedule ? "Using Schedule" : "Using Manual"}
            </button>
          </div>

          {/* Dial */}
          <div className="mt-6 flex items-center justify-center">
            <div
              className="relative h-[240px] w-[240px] select-none"
              onPointerDown={(e) => {
                (e.currentTarget as HTMLDivElement).setPointerCapture(
                  e.pointerId
                );
                setDragging(true);
                handleDialPointer(e);
              }}
              onPointerMove={(e) => dragging && handleDialPointer(e)}
              onPointerUp={() => {
                setDragging(false);
                sendControlPatch({ setpoint: targetTemp, useSchedule: false });
              }}
            >
              <svg className="absolute inset-0" viewBox="0 0 200 200">
                {/* Track */}
                <circle
                  cx="100"
                  cy="100"
                  r="88"
                  stroke="currentColor"
                  strokeWidth="10"
                  fill="none"
                  className="text-zinc-800/70"
                />
                {/* Arc */}
                <circle
                  cx="100"
                  cy="100"
                  r="88"
                  stroke="currentColor"
                  strokeWidth="10"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${gap}`}
                  transform="rotate(-210 100 100)"
                  className={ringColor}
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {/* Status label */}
                <div
                  className={`text-xs uppercase tracking-widest ${
                    overrideMode ? "text-amber-400" : "opacity-60"
                  }`}
                >
                  {dialLabel}
                </div>

                {/* Setpoint */}
                <div className="mt-2 text-5xl font-semibold tabular-nums">
                  {effectiveSetpoint.toFixed(1)}°
                </div>

                {/* Sensor reading */}
                {sensorReadings.length > 0 ? (
                  <div className="mt-2 text-center text-xs opacity-80">
                    <span className="font-medium">Now: </span>
                    {lastTemp}°C
                    {prevReading && (
                      <span className="ml-1">
                        {lastTempNumber > prevReading.temp ? (
                          <span className="text-green-500">▲</span>
                        ) : lastTempNumber < prevReading.temp ? (
                          <span className="text-red-500">▼</span>
                        ) : (
                          <span className="opacity-40">▬</span>
                        )}
                      </span>
                    )}
                    {lastReading?.timestamp && (
                      <span className="ml-2 opacity-60">
                        (
                        {new Date(lastReading.timestamp).toLocaleTimeString(
                          [],
                          { hour: "2-digit", minute: "2-digit" }
                        )}
                        )
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 text-center text-xs opacity-60">
                    No sensor data
                  </div>
                )}

                {/* +/- buttons — stop pointer events from reaching the dial */}
                <div
                  className="mt-4 flex items-center gap-3"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  <button
                    className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
                    onClick={() => {
                      const next = clamp(targetTemp - 0.5, MIN_TEMP, MAX_TEMP);
                      sendControlPatch({ setpoint: next, useSchedule: false });
                    }}
                  >
                    −
                  </button>
                  <button
                    className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
                    onClick={() => {
                      const next = clamp(targetTemp + 0.5, MIN_TEMP, MAX_TEMP);
                      sendControlPatch({ setpoint: next, useSchedule: false });
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Output status row */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StatusCard label="Heater Output" value={heaterStatus ? "ON (ESP32)" : "OFF"} />
            <StatusCard label="Cooling Output" value={coolCall ? "ON (Fan)" : "OFF"} />
            <StatusCard
              label="Setpoint Source"
              value={
                mode === "OFF"
                  ? "Off"
                  : overrideMode
                  ? "Override"
                  : useSchedule
                  ? "Schedule"
                  : "Manual"
              }
            />
          </div>

          {/* Fan + Humidifier controls */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-4">
              <div className="text-sm opacity-60">Cooling Fan (PWM)</div>
              <input
                type="range"
                min={0}
                max={100}
                value={coolingFan}
                onChange={(e) =>
                  sendControlPatch({ cooling_fan: Number(e.target.value) })
                }
                className="mt-3 w-full"
              />
              <div className="mt-2 text-sm opacity-80">
                Speed: <span className="font-medium">{coolingFan}%</span>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-4">
              <div className="text-sm opacity-60">Humidifier</div>
              <button
                onClick={() =>
                  sendControlPatch({ humidifier: !humidifier })
                }
                className={`mt-3 rounded-lg px-4 py-2 text-sm ${
                  humidifier
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {humidifier ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* Actuator status summary */}
          <div className="mt-6 rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-4">
            <div className="text-sm opacity-60">
              Actuator Status (ESP32 Modules)
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <ActuatorStatus label="Heater" value={heaterStatus ? "ON" : "OFF"} />
              <ActuatorStatus label="Cooling Fan" value={`${coolingFan}%`} />
              <ActuatorStatus label="Humidifier" value={humidifier ? "ON" : "OFF"} />
            </div>
          </div>
        </div>

        {/* ── Right: Schedule ── */}
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Daily Schedule</div>
              <div className="text-xs opacity-70">
                Edit setpoints used in closed-loop control
              </div>
            </div>
            <button
              onClick={addScheduleItem}
              className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
            >
              + Add
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {schedule
              .slice()
              .sort((a, b) => a.at - b.at)
              .map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-20 shrink-0 text-sm tabular-nums">
                      {minutesToTimeLabel(item.at)}
                    </div>
                    <input
                      type="range"
                      min={MIN_TEMP}
                      max={MAX_TEMP}
                      step={0.5}
                      value={item.temp}
                      onChange={(e) =>
                        updateScheduleTemp(item.id, Number(e.target.value))
                      }
                      className="w-full"
                    />
                    <div className="w-12 shrink-0 text-right text-sm tabular-nums">
                      {item.temp.toFixed(1)}°
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={`${String(Math.floor(item.at / 60)).padStart(2, "0")}:${String(item.at % 60).padStart(2, "0")}`}
                      onChange={(e) => {
                        const [hh, mm] = e.target.value.split(":").map(Number);
                        updateScheduleTime(item.id, hh * 60 + mm);
                      }}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => removeScheduleItem(item.id)}
                      className="rounded-md border border-zinc-800 px-2 py-1 text-sm hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {/* Schedule summary */}
          <div className="mt-4 rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3 text-sm">
            <div className="opacity-70">Right now (based on time):</div>
            <div className="mt-1">
              Scheduled setpoint:{" "}
              <span className="font-medium tabular-nums">
                {scheduledTemp.toFixed(1)}°C
              </span>
              {" · "}
              Effective setpoint:{" "}
              <span className="font-medium tabular-nums">
                {effectiveSetpoint.toFixed(1)}°C
              </span>
            </div>
            {overrideMode && (
              <div className="mt-2 text-amber-400 text-xs">
                ⚠ Override is active — effective setpoint is locked to{" "}
                {overrideSetpoint}°C regardless of schedule.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
      <div className="text-xs opacity-60">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function ActuatorStatus({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs opacity-60">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}