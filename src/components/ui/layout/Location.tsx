"use client";

import { useEffect, useState } from "react";

export default function UserLocation() {
  const [country, setCountry] = useState<string>("Loading...");
  const [city, setCity] = useState<string>("Loading...");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function run() {
      try {
        // One call returns country, city.
        const res = await fetch("https://ipapi.co/json/");
        if (!res.ok) throw new Error("Failed to fetch location");
        const data = await res.json();

        // data.country_name is full name; data.country is code
        setCountry(data.country_name ?? "Unknown");
        setCity(data.city ?? "Unknown");
      } catch (e: any) {
        setError("Could not detect location");
        setCountry("");
      }
    }
    run();
  }, []);

  return (
    <div className="text-sm opacity-100">
      {error ? error : city}, {error ? error : country} <span className="opacity-100">🌍</span>
      </div>
  );
}
