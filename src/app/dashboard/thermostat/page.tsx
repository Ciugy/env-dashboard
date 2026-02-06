'use client';

import { useEffect, useMemo, useState } from "react";

type Mode = "HEAT" | "OFF" | "AUTO";

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

function getNowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

type SensorData = { temp: number; hum: number; co2: number; press?: number; };

export default function ThermostatPage() {
  // "Sensor" reading (replace later with real sensor value)
  const [currentTemp, setCurrentTemp] = useState(22.3);
  const [SensorData, setReadings] = useState<SensorData[]>([]);

    useEffect(() => {
  async function load() {
    try {
      const res = await fetch("/api/readings");
      const json = await res.json();

      // Ensure it's always an array
      if (Array.isArray(json)) {
        setReadings(json);
      } else {
        console.error("API returned non-array:", json);
        setReadings([]); // fallback
      }
    } catch (err) {
      console.error("Failed to load readings:", err);
      setReadings([]); // fallback
    }
  }

  load();
  const interval = setInterval(load, 5000);
  return () => clearInterval(interval);
}, []);

  // Thermostat state
  const [mode, setMode] = useState<Mode>("HEAT");
  const [targetTemp, setTargetTemp] = useState(23.0); // manual setpoint
  const [useSchedule, setUseSchedule] = useState(true);

  // Daily schedule: automatically applied setpoints
  const [schedule, setSchedule] = useState([
    { at: 6 * 60, temp: 22.0 },   // 6:00
    { at: 9 * 60, temp: 20.0 },   // 9:00
    { at: 17 * 60, temp: 22.5 },  // 17:00
    { at: 22 * 60, temp: 19.5 },  // 22:00
  ]);

  // Hysteresis (prevents relay/triac chatter)
  const hysteresis = 0.3;

  // Determine scheduled setpoint "for now"
  const nowMinutes = useMemo(() => getNowMinutes(), []);
  const scheduledTemp = useMemo(() => {
  const sorted = [...schedule].sort((a, b) => a.at - b.at);

  // If schedule is empty, fall back to manual setpoint
  if (sorted.length === 0) return targetTemp;

  let chosen = sorted[0];
  for (const s of sorted) {
    if (s.at <= nowMinutes) chosen = s;
  }
  return chosen.temp;
}, [schedule, nowMinutes, targetTemp]);


  const effectiveSetpoint = useSchedule ? scheduledTemp : targetTemp;
  
  useEffect(() => {
  if (schedule.length === 0) setUseSchedule(false);
}, [schedule.length]);

  // Closed-loop decision: should heater be ON?
  const heatCall = useMemo(() => {
    if (mode === "OFF") return false;
    if (mode === "AUTO") {
      // heating with a lamp, so AUTO = behave like HEAT
      // (Later you could add cooling logic here if needed.)
    }
    // Simple hysteresis control:
    // ON when current < setpoint - hys
    // OFF when current > setpoint + hys
    return currentTemp < effectiveSetpoint - hysteresis;
  }, [mode, currentTemp, effectiveSetpoint]);

  useEffect(() => {
    const t = setInterval(() => {
      setCurrentTemp((v) => {
        // If heater is ON, temp rises slowly, otherwise it drifts down slightly
        const drift = heatCall ? 0.03 : -0.015;
        return Math.round((v + drift) * 10) / 10;
      });
    }, 400);
    return () => clearInterval(t);
  }, [heatCall]);

  // Dial interaction
  const minTemp = 10;
  const maxTemp = 30;

  const [dragging, setDragging] = useState(false);

  function handleDialPointer(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const x = e.clientX - cx;
    const y = e.clientY - cy;

    // angle: -pi..pi (0 on +x axis). We want top to be 0-ish like a thermostat
    const angle = Math.atan2(y, x); // -pi..pi
    // Map angle to 0..1 over a 300° sweep (Nest-like)
    // We'll use sweep from -210° to +30° (in radians)
    const start = (-210 * Math.PI) / 180;
    const end = (30 * Math.PI) / 180;

    let a = angle;
    // normalize into range by wrapping
    // Convert to equivalent angle close to our sweep
    while (a < start) a += 2 * Math.PI;
    while (a > start + 2 * Math.PI) a -= 2 * Math.PI;

    const t = (a - start) / (end - start);
    const ratio = clamp(t, 0, 1);

    const temp = minTemp + ratio * (maxTemp - minTemp);
    const snapped = roundTo(temp, 0.5);

    // If schedule is on, dragging should switch to manual (typical thermostat behavior)
    setUseSchedule(false);
    setTargetTemp(snapped);
  }

  // Progress ring
  const ratio = (effectiveSetpoint - minTemp) / (maxTemp - minTemp);
  const ring = clamp(ratio, 0, 1);
  const circumference = 2 * Math.PI * 88;
  const dash = circumference * ring;
  const gap = circumference - dash;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Thermostat</h1>
          <p className="mt-1 text-sm opacity-70">
            Schedule → Setpoint → Compare to sensor → Heater (TRIAC lamp) + optional fan
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={`rounded-full px-3 py-1 text-sm border ${
              mode === "HEAT" ? "bg-white/10" : "bg-transparent"
            }`}
            onClick={() => setMode("HEAT")}
          >
            Heat
          </button>
          <button
            className={`rounded-full px-3 py-1 text-sm border ${
              mode === "AUTO" ? "bg-white/10" : "bg-transparent"
            }`}
            onClick={() => setMode("AUTO")}
          >
            Auto
          </button>
          <button
            className={`rounded-full px-3 py-1 text-sm border ${
              mode === "OFF" ? "bg-white/10" : "bg-transparent"
            }`}
            onClick={() => setMode("OFF")}
          >
            Off
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Dial */}
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm opacity-70">
              {useSchedule ? "Scheduled setpoint" : "Manual setpoint"}
            </div>
            <button
              onClick={() => setUseSchedule((v) => !v)}
              className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
            >
              {useSchedule ? "Using Schedule" : "Using Manual"}
            </button>
          </div>

          <div className="mt-6 flex items-center justify-center">
            <div
              className="relative h-[240px] w-[240px] select-none"
              onPointerDown={(e) => {
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                setDragging(true);
                handleDialPointer(e);
              }}
              onPointerMove={(e) => {
                if (!dragging) return;
                handleDialPointer(e);
              }}
              onPointerUp={() => setDragging(false)}
            >
              {/* Outer ring */}
              <svg className="absolute inset-0" viewBox="0 0 200 200">
                <circle
                  cx="100"
                  cy="100"
                  r="88"
                  stroke="currentColor"
                  strokeWidth="10"
                  fill="none"
                  className="text-zinc-800/70"
                />
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
                  className={heatCall && mode !== "OFF" ? "text-orange-400" : "text-sky-400"}
                />
              </svg>

              {/* Center */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-xs uppercase tracking-widest opacity-60">
                  {mode === "OFF" ? "System Off" : heatCall ? "Heating" : "Holding"}
                </div>
                <div className="mt-2 text-5xl font-semibold tabular-nums">
                  {effectiveSetpoint.toFixed(1)}°
                </div>
                <div className="mt-2 text-sm opacity-70">
                  Current: <span className="tabular-nums">{currentTemp.toFixed(1)}°</span>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                  className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setUseSchedule(false);
                    setTargetTemp((t) => clamp(t - 0.5, minTemp, maxTemp));
                  }}
                >
                  −
                </button>

                <button
                  className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setUseSchedule(false);
                    setTargetTemp((t) => clamp(t + 0.5, minTemp, maxTemp));
                  }}
                >
                  +
                </button>

                </div>
              </div>
            </div>
          </div>

          {/* Output status */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
              <div className="text-xs opacity-60">Heater Output</div>
              <div className="mt-1 text-sm font-medium">
                {mode === "OFF" ? "OFF" : heatCall ? "ON (TRIAC)" : "OFF"}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
              <div className="text-xs opacity-60">Setpoint Source</div>
              <div className="mt-1 text-sm font-medium">
                {useSchedule ? "Schedule" : "Manual"}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
              <div className="text-xs opacity-60">Hysteresis</div>
              <div className="mt-1 text-sm font-medium tabular-nums">±{hysteresis}°C</div>
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="bg-zinc-950/40 rounded-2xl border border-zinc-800/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Daily Schedule</div>
              <div className="text-xs opacity-70">
                Edit setpoints used in closed-loop control
              </div>
            </div>
            <button
              onClick={() =>
                setSchedule((s) => [...s, { at: 12 * 60, temp: 21.0 }].sort((a, b) => a.at - b.at))
              }
              className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
            >
              + Add
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {schedule
              .slice()
              .sort((a, b) => a.at - b.at)
              .map((item, idx) => (
                <div
                  key={`${item.at}-${idx}`}
                  className="grid gap-3 rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3 md:grid-cols-[96px_1fr_72px_96px_auto]"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-sm tabular-nums md:self-center">{minutesToTimeLabel(item.at)}</div>
                      <div className="flex items-center gap-3 md:self-center">
                      <input
                        type="range"
                        min={minTemp}
                        max={maxTemp}
                        step={0.5}
                        value={item.temp}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setSchedule((s) => {
                            const copy = [...s];
                            copy[idx] = { ...copy[idx], temp: v };
                            return copy;
                          });
                        }}
                        className="w-full"
                      />
                    </div>
                    <div className="text-sm tabular-nums md:self-center">{item.temp.toFixed(1)}°</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={`${String(Math.floor(item.at / 60)).padStart(2, "0")}:${String(item.at % 60).padStart(2, "0")}`}
                      onChange={(e) => {
                        const [hh, mm] = e.target.value.split(":").map(Number);
                        const at = hh * 60 + mm;
                        setSchedule((s) => {
                          const copy = [...s];
                          copy[idx] = { ...copy[idx], at };
                          return copy.sort((a, b) => a.at - b.at);
                        });
                      }}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => setSchedule((s) => s.filter((_, i) => i !== idx))}
                      className="rounded-md border border-zinc-800 px-2 py-1 text-sm hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3 text-sm">
            <div className="opacity-70">Right now (based on time):</div>
            <div className="mt-1">
              Scheduled setpoint: <span className="font-medium tabular-nums">{scheduledTemp.toFixed(1)}°C</span>
              {" · "}
              Effective setpoint: <span className="font-medium tabular-nums">{effectiveSetpoint.toFixed(1)}°C</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
