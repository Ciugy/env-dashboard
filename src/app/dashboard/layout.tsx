import Sidebar from "@/components/ui/layout/Sidebar";
import ThemeToggle from "@/components/ui/layout/ThemeToggle";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <nav className="flex items-center justify-between p-4 md:p-8 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex">
          <Sidebar />
        </div>
          <ThemeToggle />
      </nav>

      <div className="p-4 md:p-8 max-w-6xl mx-auto">{children}</div>
    </main>
  );
}
