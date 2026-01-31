"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="rounded-xl border px-3 py-2 flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/10"
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
      <span className="text-sm">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
