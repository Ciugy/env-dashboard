'use client';

import { useState } from "react";
import Link from "next/link";

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-md border border-zinc-700/60 px-3 py-2 text-sm hover:bg-zinc-800/40"
        aria-label="Open sidebar"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>

      {/* Backdrop */}
      {open && (
        <button
          aria-label="Close sidebar"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-black/50"
        />
      )}

      {/* Drawer */}
      <aside
        className={[
          "fixed left-0 top-0 z-50 h-dvh w-72",
          "bg-zinc-900 text-zinc-100 shadow-xl",
          "transform transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="text-sm font-semibold tracking-wide">Navigation</div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-2 hover:bg-zinc-800"
            aria-label="Close sidebar"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeWidth="2" strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="p-3">
          <Link
            href="/dashboard"
            className="block rounded-md px-3 py-2 text-sm hover:bg-zinc-800"
            onClick={() => setOpen(false)}
          >
            Home
          </Link>

          <Link
            href="/dashboard/thermostat"
            className="block rounded-md px-3 py-2 text-sm hover:bg-zinc-800"
            onClick={() => setOpen(false)}
          >
            Thermostat
          </Link>
        </nav>
      </aside>
    </>
  );
}
