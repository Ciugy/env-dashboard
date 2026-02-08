"use client";

import { useEffect, useState } from "react";
import UserLocation from "@/components/ui/layout/Location";

import {
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

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

function Tile({
  title,
  value,
  unit,
  footer,
}: {
  title: string;
  value: string;
  unit?: string;
  footer?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-4 shadow-sm hover:shadow-lg transition-shadow duration-200 min-h-[110px]">
      <div className="text-sm opacity-60">{title}</div>
      <div className="mt-2 text-4xl sm:text-5xl font-semibold">
        {value} <span className="text-xs opacity-60">{unit}</span>
      </div>
      {footer ? <div className="mt-2 text-xs opacity-70">{footer}</div> : null}
      <div className="mt-3 h-10">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[{t:'1', v:1},{t:'2',v:2},{t:'3',v:1.5},{t:'4',v:2.2}] }>
            <Line type="monotone" dataKey="v" stroke="#06b6d4" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatusBadge({ co2 }: { co2: number }) {
  let label = "Good";
  let cls =
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";

  if (co2 >= 800 && co2 < 1200) {
    label = "Moderate";
    cls =
      "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
  } else if (co2 >= 1200) {
    label = "Poor";
    cls = "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
  }

  return (
    <span className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium ${cls}`}>
      <span aria-hidden>
        {co2 >= 1200 ? "🔥" : co2 >= 800 ? "⚠️" : "✅"}
      </span>
      {label}
    </span>
  );
}

export default function Dashboard() {
  const [readings, setReadings] = useState<Reading[]>([]);

  // Fetch DB data every 5 seconds
  useEffect(() => {
  async function load() {
    try {
      const res = await fetch("/api/readings");
      const json = await res.json();

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


  const latest = readings[0];

  const current = latest
    ? {
        temp: latest.bme_temp,
        hum: latest.scd_hum,
        press: latest.bme_press,
        co2: latest.scd_co2,
      }
    : {
        temp: 0,
        hum: 0,
        press: 0,
        co2: 0,
      };

  const data = readings
    .map((r) => ({
      t: r.timestamp.slice(11, 16), // HH:MM
      temp: r.bme_temp,
      hum: r.bme_hum,
      press: r.bme_press,
      co2: r.scd_co2,
    }))
    .reverse();

  const alertMsg =
    current.co2 >= 1200
      ? "⚠️ CO₂ is high. Improve ventilation."
      : "Everything looks good";

  const humAlert =
    current.hum >= 70
      ? "⚠️ Humidity is high. Consider using a dehumidifier."
      : "All readings are within normal ranges.";

  return (
    <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        title="Temperature"
        value={current.temp.toFixed(1)}
        unit="°C"
        footer="BME680"
      />
      <Tile
        title="Humidity"
        value={current.hum.toFixed(0)}
        unit="%"
        footer="BME680"
      />
      <Tile
        title="Pressure"
        value={current.press.toFixed(1)}
        unit="hPa"
        footer="BME680"
      />

      <div className={`rounded-2xl border ${current.co2 >= 1200 ? 'border-red-400/40' : current.co2 >= 800 ? 'border-amber-400/40' : 'border-emerald-400/40'} bg-white dark:bg-zinc-900 p-4 shadow-sm`}>
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-70">CO₂</div>
          <StatusBadge co2={current.co2} />
        </div>
        <div className="mt-2 text-3xl font-semibold">
          {current.co2.toFixed(0)} <span className="text-base opacity-70">ppm</span>
        </div>
        <div className="mt-2 text-xs opacity-70">SCD-40</div>
      </div>

      <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-4 shadow-sm sm:col-span-2 lg:col-span-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm opacity-70">CO₂ Trend</div>
            <div className="text-lg font-semibold">Recent readings</div>
          </div>
          <div className="text-xs opacity-70">Live</div>
        </div>

        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.08} />
              <XAxis dataKey="t" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: any) => `${value} ppm`} />
              <defs>
                <linearGradient id="co2Grad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="co2" stroke="#06b6d4" fill="url(#co2Grad)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="co2" stroke="#06b6d4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-4 shadow-sm sm:col-span-2 lg:col-span-1">
        <div className="text-sm opacity-70">Alerts</div>
        <div className="mt-2 text-base font-semibold">Status</div>
        <div className="mt-3 text-sm opacity-80 leading-relaxed">{alertMsg}</div>

        <div className="mt-4 text-xs opacity-60">
          Thresholds: {humAlert}
        </div>
      </div>

      <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-4 shadow-sm sm:col-span-2 lg:col-span-2">
        <div className="text-sm opacity-70">Notes</div>
        <div className="mt-2 text-sm opacity-80">
          Add calibration notes, room info, or sensor placement details here.
        </div>
      </div>

      <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-4 shadow-sm sm:col-span-2 lg:col-span-2">
        <div className="text-sm opacity-70">Location</div>
        <div className="mt-2 text-sm opacity-80">
         <UserLocation />
        </div>
      </div>
    </div>
  );
}
