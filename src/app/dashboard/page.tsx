"use client";

import { useEffect, useRef, useState } from "react";
import UserLocation from "@/components/ui/layout/Location";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Reading = {
  timestamp: string;
  bme_temp: number;
  bme_hum: number;
  bme_press: number;
  bme_gas: number;
  scd_co2: number;
  scd_temp: number;
  scd_hum: number;
};

type ChartTab = "co2" | "temp" | "humidity" | "pressure";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function co2Status(co2: number): {
  label: string;
  color: string;
  bg: string;
  border: string;
  emoji: string;
} {
  if (co2 >= 1200)
    return {
      label: "Poor",
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      emoji: "🔴",
    };
  if (co2 >= 800)
    return {
      label: "Moderate",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      emoji: "🟡",
    };
  return {
    label: "Good",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    emoji: "🟢",
  };
}

function convertToCSV(readings: Reading[]): string {
  const headers = [
    "Timestamp","Temperature (°C)","Humidity (%)","Pressure (hPa)",
    "Gas Resistance (Ω)","CO2 (ppm)","SCD Temp (°C)","SCD Humidity (%)",
  ];
  const rows = readings.map((r) => [
    r.timestamp, r.bme_temp, r.bme_hum, r.bme_press,
    r.bme_gas, r.scd_co2, r.scd_temp, r.scd_hum,
  ]);
  return [
    headers.join(","),
    ...rows.map((row) => row.map((c) => `"${c}"`).join(",")),
  ].join("\n");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function delta(readings: Reading[], key: keyof Reading): number | null {
  if (readings.length < 2) return null;
  return (readings[0][key] as number) - (readings[1][key] as number);
}

function Arrow({ value }: { value: number | null }) {
  if (value === null) return null;
  if (Math.abs(value) < 0.05) return <span className="opacity-40">▬</span>;
  return value > 0
    ? <span className="text-red-400">▲ {Math.abs(value).toFixed(1)}</span>
    : <span className="text-emerald-400">▼ {Math.abs(value).toFixed(1)}</span>;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({
  data,
  dataKey,
  color,
}: {
  data: { [key: string]: number | string }[];
  dataKey: string;
  color: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#spark-${dataKey})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Stat Tile ────────────────────────────────────────────────────────────────

function StatTile({
  title,
  value,
  unit,
  source,
  trend,
  sparkData,
  sparkKey,
  color,
  loading,
}: {
  title: string;
  value: string;
  unit: string;
  source: string;
  trend: number | null;
  sparkData: { [key: string]: number | string }[];
  sparkKey: string;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4 flex flex-col gap-2 hover:border-zinc-700/60 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">{title}</span>
        <span className="text-xs text-zinc-600">{source}</span>
      </div>

      {loading ? (
        <div className="h-10 rounded-lg bg-zinc-800/60 animate-pulse" />
      ) : (
        <div className="flex items-end gap-2">
          <span className="text-4xl font-semibold tabular-nums text-zinc-100">
            {value}
          </span>
          <span className="text-sm text-zinc-500 mb-1">{unit}</span>
          <span className="text-xs text-zinc-500 mb-1 ml-auto">
            <Arrow value={trend} />
          </span>
        </div>
      )}

      <div className="h-10 mt-1">
        <Sparkline data={sparkData} dataKey={sparkKey} color={color} />
      </div>
    </div>
  );
}

// ─── CO₂ Badge ───────────────────────────────────────────────────────────────

function CO2Tile({ co2, loading }: { co2: number; loading: boolean }) {
  const s = co2Status(co2);
  return (
    <div className={`rounded-2xl border ${s.border} ${s.bg} p-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">CO₂</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.bg} ${s.color} border ${s.border}`}>
          {s.emoji} {s.label}
        </span>
      </div>

      {loading ? (
        <div className="h-10 rounded-lg bg-zinc-800/60 animate-pulse" />
      ) : (
        <div className="flex items-end gap-2">
          <span className={`text-4xl font-semibold tabular-nums ${s.color}`}>
            {co2.toFixed(0)}
          </span>
          <span className="text-sm text-zinc-500 mb-1">ppm</span>
        </div>
      )}

      <div className="text-xs text-zinc-500">SCD-40</div>
    </div>
  );
}

// ─── Chart tabs ───────────────────────────────────────────────────────────────

const CHART_TABS: { key: ChartTab; label: string; dataKey: string; unit: string; color: string }[] = [
  { key: "co2",      label: "CO₂",         dataKey: "co2",   unit: "ppm",  color: "#06b6d4" },
  { key: "temp",     label: "Temperature", dataKey: "temp",  unit: "°C",   color: "#f97316" },
  { key: "humidity", label: "Humidity",    dataKey: "hum",   unit: "%",    color: "#8b5cf6" },
  { key: "pressure", label: "Pressure",    dataKey: "press", unit: "hPa",  color: "#10b981" },
];

function TrendChart({
  data,
}: {
  data: { t: string; temp: number; hum: number; press: number; co2: number }[];
}) {
  const [active, setActive] = useState<ChartTab>("co2");
  const tab = CHART_TABS.find((t) => t.key === active)!;

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4 sm:col-span-2 lg:col-span-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-widest">Trend</div>
          <div className="text-base font-semibold text-zinc-100 mt-0.5">
            {tab.label} over time
          </div>
        </div>

        {/* Tab pills */}
        <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
          {CHART_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                active === t.key
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={tab.color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={tab.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 11, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: "0.5rem",
                fontSize: "12px",
                color: "#e4e4e7",
              }}
              formatter={(v?: number) => [v ? `${v.toFixed(1)} ${tab.unit}` : "", tab.label]}
              labelStyle={{ color: "#71717a" }}
            />
            <Area
              type="monotone"
              dataKey={tab.dataKey}
              stroke={tab.color}
              strokeWidth={2}
              fill="url(#chartGrad)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Alerts panel ─────────────────────────────────────────────────────────────

function AlertsPanel({ co2, hum }: { co2: number; hum: number }) {
  const alerts: { msg: string; level: "warn" | "ok" }[] = [];

  if (co2 >= 1200) alerts.push({ msg: "CO₂ critical — ventilate immediately.", level: "warn" });
  else if (co2 >= 800) alerts.push({ msg: "CO₂ elevated — consider ventilation.", level: "warn" });
  else alerts.push({ msg: "CO₂ within normal range.", level: "ok" });

  if (hum >= 70) alerts.push({ msg: "Humidity high — dehumidifier recommended.", level: "warn" });
  else if (hum < 30) alerts.push({ msg: "Humidity low — consider a humidifier.", level: "warn" });
  else alerts.push({ msg: "Humidity within normal range.", level: "ok" });

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4 sm:col-span-2 lg:col-span-1 flex flex-col gap-3">
      <div className="text-xs text-zinc-500 uppercase tracking-widest">Alerts</div>
      {alerts.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 text-xs rounded-lg p-2 ${
            a.level === "warn"
              ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          }`}
        >
          <span>{a.level === "warn" ? "⚠" : "✓"}</span>
          <span>{a.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Notes tile ───────────────────────────────────────────────────────────────

function NotesTile() {
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("dashboard-notes");
    if (stored) setNotes(stored);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setNotes(val);
    setSaved(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem("dashboard-notes", val);
      setSaved(true);
    }, 800);
  }

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4 sm:col-span-2 lg:col-span-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">Notes</span>
        {saved && <span className="text-xs text-emerald-500">Saved</span>}
      </div>
      <textarea
        value={notes}
        onChange={handleChange}
        placeholder="Calibration notes, sensor placement, room details…"
        rows={4}
        className="w-full bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 resize-none outline-none border border-zinc-800/60 rounded-lg p-2 focus:border-zinc-600 transition-colors"
      />
    </div>
  );
}

// ─── Export tile ──────────────────────────────────────────────────────────────

function ExportTile({ readings }: { readings: Reading[] }) {
  const [exporting, setExporting] = useState(false);

  function doExport(type: "csv" | "json") {
    setExporting(true);
    const ts = new Date().toISOString().slice(0, 10);
    try {
      if (type === "csv") {
        downloadFile(convertToCSV(readings), `readings-${ts}.csv`, "text/csv");
      } else {
        downloadFile(JSON.stringify(readings, null, 2), `readings-${ts}.json`, "application/json");
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4 sm:col-span-2 lg:col-span-2 flex flex-col gap-3">
      <div className="text-xs text-zinc-500 uppercase tracking-widest">Export</div>
      <div className="text-xs text-zinc-500">
        {readings.length.toLocaleString()} readings available
      </div>
      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => doExport("csv")}
          disabled={exporting || readings.length === 0}
          className="flex-1 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ↓ CSV
        </button>
        <button
          onClick={() => doExport("json")}
          disabled={exporting || readings.length === 0}
          className="flex-1 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ↓ JSON
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/readings");
        const json = await res.json();
        if (Array.isArray(json)) {
          setReadings(json);
        }
      } catch (err) {
        console.error("Failed to load readings:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const latest = readings[0];
  const current = {
    temp:  latest?.bme_temp  ?? 0,
    hum:   latest?.scd_hum   ?? 0,
    press: latest?.bme_press ?? 0,
    co2:   latest?.scd_co2   ?? 0,
  };

  const chartData = [...readings].reverse().map((r) => ({
    t:     r.timestamp.slice(11, 16),
    temp:  r.bme_temp,
    hum:   r.scd_hum,
    press: r.bme_press,
    co2:   r.scd_co2,
  }));
  
  const sparkData = [...readings].reverse().slice(-20).map((r) => ({
    temp:  r.bme_temp,
    hum:   r.scd_hum,
    press: r.bme_press,
    co2:   r.scd_co2,
  }));

  return (
    <div className="grid gap-4 md:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">

      <StatTile
        title="Temperature"
        value={current.temp.toFixed(1)}
        unit="°C"
        source="BME680"
        trend={delta(readings, "bme_temp")}
        sparkData={sparkData}
        sparkKey="temp"
        color="#f97316"
        loading={loading}
      />
      <StatTile
        title="Humidity"
        value={current.hum.toFixed(0)}
        unit="%"
        source="SCD-40"
        trend={delta(readings, "scd_hum")}
        sparkData={sparkData}
        sparkKey="hum"
        color="#8b5cf6"
        loading={loading}
      />
      <StatTile
        title="Pressure"
        value={current.press.toFixed(1)}
        unit="hPa"
        source="BME680"
        trend={delta(readings, "bme_press")}
        sparkData={sparkData}
        sparkKey="press"
        color="#10b981"
        loading={loading}
      />
      <CO2Tile co2={current.co2} loading={loading} />

      <TrendChart data={chartData} />
      <AlertsPanel co2={current.co2} hum={current.hum} />

      <NotesTile />
      <ExportTile readings={readings} />

      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-4 sm:col-span-2 lg:col-span-4">
        <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Location</div>
        <UserLocation />
      </div>

    </div>
  );
}