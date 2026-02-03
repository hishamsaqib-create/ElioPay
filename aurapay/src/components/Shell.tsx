"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Users, FileText, Settings, LogOut, Menu, X, ChevronRight
} from "lucide-react";

interface User {
  id: number; name: string; email: string; role: string;
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/payslips", label: "Payslips", icon: FileText },
  { href: "/dentists", label: "Dentists", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.ok) {
        const data = await r.json();
        setUser(data.user);
      } else {
        router.replace("/login");
      }
    });
  }, [router]);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-dim">
        <div className="text-primary-600 text-xl font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  const currentPage = NAV.find((n) => pathname.startsWith(n.href));

  return (
    <div className="min-h-screen flex bg-surface-dim">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-border flex flex-col transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-8 h-8">
                <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-700"/>
                <path d="M50 25 L35 70 L42 70 L45 60 L55 60 L58 70 L65 70 L50 25 Z M47 53 L50 42 L53 53 Z" fill="currentColor" className="text-slate-700"/>
                <path d="M40 58 Q50 68 60 58" fill="currentColor" className="text-slate-700"/>
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-text leading-none">AuraPay<sup className="text-[8px] font-medium ml-0.5 text-text-subtle">TM</sup></h1>
              <p className="text-[10px] text-text-subtle leading-none mt-0.5">Aura Dental Clinic</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden text-text-muted">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  active
                    ? "bg-primary-50 text-primary-700"
                    : "text-text-muted hover:bg-surface-muted hover:text-text"
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-sm font-semibold">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text truncate">{user.name}</p>
              <p className="text-xs text-text-subtle truncate">{user.role}</p>
            </div>
            <button onClick={logout} className="text-text-subtle hover:text-danger transition" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-border flex items-center px-6 gap-4 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-text-muted">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-1.5 text-sm text-text-muted">
            <span className="hidden sm:inline">AuraPay</span>
            {currentPage && (
              <>
                <ChevronRight size={14} />
                <span className="font-medium text-text">{currentPage.label}</span>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
