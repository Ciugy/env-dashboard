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

type SensorData = {
  temp: number;
  hum: number;
  co2: number;
  timestamp?: string;
};

export default function ThermostatPage() {
  const [sensorReadings, setSensorReadings] = useState<SensorData[]>([]);
  const [currentTemp, setCurrentTemp] = useState(22.3);

  // CONTROL STATE
  const [mode, setMode] = useState<Mode>("HEAT");
  const [targetTemp, setTargetTemp] = useState(23.0);
  const [useSchedule, setUseSchedule] = useState(true);

  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideSetpoint, setOverrideSetpoint] = useState<number | null>(null);

  // NEW: Fan + Humidifier + Heater status
  const [fan, setFan] = useState(0); // 0–100%
  const [humidifier, setHumidifier] = useState(false);
  const [heaterStatus, setHeaterStatus] = useState(false);

  const [schedule, setSchedule] = useState([
    { at: 6 * 60, temp: 22.0 },
    { at: 9 * 60, temp: 20.0 },
    { at: 17 * 60, temp: 22.5 },
    { at: 22 * 60, temp: 19.5 },
  ]);

  // LOAD SENSOR DATA
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/readings");
        const json = await res.json();

        if (Array.isArray(json)) {
          const mapped = json.map((row) => ({
            temp: row.bme_temp,
            hum: row.scd_hum,
            co2: row.scd_co2,
            timestamp: row.timestamp,
          }));

          setSensorReadings(mapped);

          // ⭐ NEW: update UI temperature from newest reading
          if (mapped.length > 0) {
            setCurrentTemp(mapped[0].temp);
          }
        } else {
          setSensorReadings([]);
        }
      } catch {
        setSensorReadings([]);
      }
    }

  load();
  const interval = setInterval(load, 5000);
  return () => clearInterval(interval);
}, []);


  // LOAD CONTROL STATE FROM BACKEND
  useEffect(() => {
    async function loadControl() {
      try {
        const res = await fetch("/api/control");
        const data = await res.json();

        setMode(data.mode);
        setTargetTemp(data.setpoint);
        setUseSchedule(data.useSchedule);
        setSchedule(data.schedule);
        setOverrideMode(data.overrideMode);
        setOverrideSetpoint(data.overrideSetpoint);

        setFan(data.fan ?? 0);
        setHumidifier(data.humidifier ?? false);
        setHeaterStatus(data.heater ?? false);
      } catch (err) {
        console.error("Failed to load control state", err);
      }
    }

    loadControl();
    const interval = setInterval(loadControl, 1000);
    return () => clearInterval(interval);
  }, []);


  function computeScheduledTemp(schedule: { at: number; temp: number }[]) {
    if (!schedule.length) return targetTemp;

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();

    const active = schedule
      .filter((s) => s.at <= minutes)
      .sort((a, b) => b.at - a.at)[0];

    if (!active) {
      return schedule[schedule.length - 1].temp;
    }

    return active.temp;
  }

  const scheduledTemp = computeScheduledTemp(schedule);
  const effectiveSetpoint = useSchedule ? scheduledTemp : targetTemp;

  const hysteresis = 0.3;

  const heatCall = useMemo(() => {
    if (mode === "OFF") return false;
    return currentTemp < effectiveSetpoint - hysteresis;
  }, [mode, currentTemp, effectiveSetpoint]);


  // SEND CONTROL STATE TO BACKEND
  useEffect(() => {
    async function send() {
      const payload = {
        mode,
        setpoint: targetTemp,
        useSchedule,
        schedule,
        overrideMode,
        overrideSetpoint,
        fan: coolCall ? 100 : fan,   // auto cooling
        humidifier
      };


      await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    send();
  }, [mode, targetTemp, useSchedule, schedule, overrideMode, overrideSetpoint, fan, humidifier]);

  // DIAL LOGIC
  const minTemp = 10;
  const maxTemp = 30;

  const [dragging, setDragging] = useState(false);

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

    const temp = minTemp + ratio * (maxTemp - minTemp);
    const snapped = roundTo(temp, 0.5);

    setUseSchedule(false);
    setTargetTemp(snapped);
  }

  const ratio = (effectiveSetpoint - minTemp) / (maxTemp - minTemp);
  const ring = clamp(ratio, 0, 1);
  const circumference = 2 * Math.PI * 88;
  const dash = circumference * ring;
  const gap = circumference - dash;

  const coolCall = useMemo(() => {
  if (mode === "OFF") return false;
  return currentTemp > effectiveSetpoint + hysteresis;
}, [mode, currentTemp, effectiveSetpoint]);


  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Thermostat</h1>

          {overrideMode && (
            <div className="mt-2 text-sm text-amber-400">
              Physical Override Active — Setpoint {overrideSetpoint}°C
            </div>
          )}

          <p className="mt-1 text-sm opacity-70">
            Schedule → Setpoint → Compare to sensor → Heater + Fan + Humidifier
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
        {/* LEFT SIDE: DIAL + STATUS */}
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

          {/* DIAL */}
          <div className="mt-6 flex items-center justify-center">
            <div
              className="relative h-[240px] w-[240px] select-none"
              onPointerDown={(e) => {
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                setDragging(true);
                handleDialPointer(e);
              }}
              onPointerMove={(e) => dragging && handleDialPointer(e)}
              onPointerUp={() => setDragging(false)}
            >
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
                  className={
                      mode === "OFF"
                        ? "text-zinc-700"
                        : heatCall
                        ? "text-orange-400"
                        : coolCall
                        ? "text-blue-400"
                        : "text-sky-400"
                      }
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-xs uppercase tracking-widest opacity-60">
                  {mode === "OFF"
                    ? "System Off"
                    : heatCall
                    ? "Heating"
                    : coolCall
                    ? "Cooling"
                    : "Holding"}
                </div>
                <div className="mt-2 text-5xl font-semibold tabular-nums">
                  {effectiveSetpoint.toFixed(1)}°
                </div>

                {/* SENSOR READING */}
                {sensorReadings.length > 0 ? (() => {
                  const last = sensorReadings[sensorReadings.length - 1];
                  const prev = sensorReadings[sensorReadings.length - 2];

                  return (
                    <div className="mt-2 text-xs text-center opacity-80">
                      <span className="font-medium">Sensor reading:</span>{" "}
                      {last.temp.toFixed(1)}°C
                      {prev && (
                        <span className="ml-2">
                          {last.temp > prev.temp ? (
                            <span className="text-green-500">▲</span>
                          ) : last.temp < prev.temp ? (
                            <span className="text-red-500">▼</span>
                          ) : (
                            <span className="opacity-40">▬</span>
                          )}
                        </span>
                      )}

                      {last.timestamp && (
                        <span className="ml-2 opacity-60">
                          (updated{" "}
                          {new Date(last.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          )
                        </span>
                      )}
                    </div>
                  );
                })() : (
                  <div className="mt-2 text-xs text-center opacity-60">No sensor data</div>
                )}

                {/* +/- BUTTONS */}
                <div
                  className="mt-4 flex items-center gap-3"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  <button
                    className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
                    onClick={() => {
                      setUseSchedule(false);
                      setTargetTemp((t) => clamp(t - 0.5, minTemp, maxTemp));
                    }}
                  >
                    −
                  </button>

                  <button
                    className="rounded-full border px-3 py-1 text-sm hover:bg-white/10"
                    onClick={() => {
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

          {/* OUTPUT STATUS */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {/* Heater */}
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
                <div className="text-xs opacity-60">Heater Output</div>
                <div className="mt-1 text-sm font-medium">
                  {heaterStatus ? "ON (ESP32)" : "OFF"}
                </div>
              </div>

              {/* Cooling */}
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
                <div className="text-xs opacity-60">Cooling Output</div>
                <div className="mt-1 text-sm font-medium">
                  {coolCall ? "ON (Fan)" : "OFF"}
                </div>
              </div>

              {/* Setpoint Source */}
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
                <div className="text-xs opacity-60">Setpoint Source</div>
                <div className="mt-1 text-sm font-medium">
                  {useSchedule ? "Schedule" : "Manual"}
                </div>
              </div>
          </div>

          {/* FAN + HUMIDIFIER CONTROLS */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {/* FAN */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-4">
              <div className="text-sm opacity-60">Cooling Fan (PWM)</div>
              <input
                type="range"
                min={0}
                max={100}
                value={fan}
                onChange={(e) => setFan(Number(e.target.value))}
                className="w-full mt-3"
              />
              <div className="mt-2 text-sm opacity-80">
                Speed: <span className="font-medium">{fan}%</span>
              </div>
            </div>

            {/* HUMIDIFIER */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-4">
              <div className="text-sm opacity-60">Humidifier</div>
              <button
                onClick={() => setHumidifier((v) => !v)}
                className={`mt-3 px-4 py-2 rounded-lg text-sm ${
                  humidifier
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {humidifier ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* ACTUATOR STATUS */}
          <div className="mt-6 rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-4">
            <div className="text-sm opacity-60">Actuator Status (ESP32 Modules)</div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs opacity-60">Heater</div>
                <div className="mt-1 text-sm font-medium">
                  {heaterStatus ? "ON" : "OFF"}
                </div>
              </div>

              <div>
                <div className="text-xs opacity-60">Cooling Fan</div>
                <div className="mt-1 text-sm font-medium">{fan}%</div>
              </div>

              <div>
                <div className="text-xs opacity-60">Humidifier</div>
                <div className="mt-1 text-sm font-medium">
                  {humidifier ? "ON" : "OFF"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/*RIGHT SIDE: SCHEDULE*/}
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
                    <div className="text-sm tabular-nums md:self-center">
                      {minutesToTimeLabel(item.at)}
                    </div>
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
                    <div className="text-sm tabular-nums md:self-center">
                      {item.temp.toFixed(1)}°
                    </div>
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
              Scheduled setpoint:{" "}
              <span className="font-medium tabular-nums">{scheduledTemp.toFixed(1)}°C</span>
              {" · "}
              Effective setpoint:{" "}
              <span className="font-medium tabular-nums">{effectiveSetpoint.toFixed(1)}°C</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
