"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Users, FileText, Settings, LogOut, Menu, X, ChevronRight, User, Shield,
  FlaskConical, Truck, CreditCard, BarChart3
} from "lucide-react";

interface User {
  id: number; name: string; email: string; role: string; is_super_admin?: boolean;
}

interface ClinicSettings {
  clinic_name?: string;
  clinic_logo_url?: string;
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/payslips", label: "Payslips", icon: FileText },
  { href: "/dentists", label: "Dentists", icon: Users },
  { href: "/lab-bills", label: "Lab Bills", icon: FlaskConical },
  { href: "/supplier-invoices", label: "Invoices", icon: Truck },
  { href: "/bulk-payments", label: "Bulk Payments", icon: CreditCard },
  { href: "/reporting", label: "Reporting", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

const ADMIN_NAV = { href: "/admin", label: "Admin Zone", icon: Shield };

export default function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings>({});
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

    // Fetch clinic settings
    fetch("/api/settings").then(async (r) => {
      if (r.ok) {
        const data = await r.json();
        setClinicSettings(data.settings || {});
      }
    });
  }, [router]);

  // Update favicon dynamically when logo changes
  useEffect(() => {
    const logoUrl = clinicSettings.clinic_logo_url;
    if (logoUrl) {
      updateFavicon(logoUrl);
    } else {
      updateFavicon("/icon.svg");
    }
  }, [clinicSettings.clinic_logo_url]);

  function updateFavicon(url: string) {
    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;

    let appleLink: HTMLLinkElement | null = document.querySelector("link[rel='apple-touch-icon']");
    if (!appleLink) {
      appleLink = document.createElement("link");
      appleLink.rel = "apple-touch-icon";
      document.head.appendChild(appleLink);
    }
    appleLink.href = url;
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-dim">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
          <span className="text-sm text-text-muted font-medium">Loading</span>
        </div>
      </div>
    );
  }

  const currentPage = pathname.startsWith("/admin") ? ADMIN_NAV : NAV.find((n) => pathname.startsWith(n.href));
  const clinicName = clinicSettings.clinic_name || "Your Clinic";

  return (
    <div className="min-h-screen flex bg-surface-dim">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-[260px] bg-white/80 backdrop-blur-xl border-r border-border flex flex-col transition-transform duration-300 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-14 flex items-center px-5 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            {clinicSettings.clinic_logo_url ? (
              <img src={clinicSettings.clinic_logo_url} alt="Logo" className="w-7 h-7 object-contain rounded-md" />
            ) : (
              <div className="w-7 h-7 flex items-center justify-center bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg shadow-sm">
                <span className="text-white font-bold text-xs">A</span>
              </div>
            )}
            <div>
              <h1 className="text-[15px] font-semibold text-text leading-none tracking-tight">AuraPay</h1>
              <p className="text-[10px] text-text-subtle leading-none mt-0.5 truncate max-w-[140px]">{clinicName}</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  active
                    ? "bg-primary-600 text-white shadow-sm"
                    : "text-text-muted hover:bg-surface-muted hover:text-text"
                }`}
              >
                <item.icon size={16} strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </Link>
            );
          })}

          {/* Admin Zone - only for super admins */}
          {user?.is_super_admin && (
            <>
              <div className="my-2.5 border-t border-border/60" />
              <Link
                href={ADMIN_NAV.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  pathname.startsWith(ADMIN_NAV.href)
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                }`}
              >
                <ADMIN_NAV.icon size={16} />
                {ADMIN_NAV.label}
              </Link>
            </>
          )}
        </nav>

        <div className="p-3 border-t border-border/60">
          <Link
            href="/account"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-muted transition-all duration-150"
          >
            <div className="w-7 h-7 bg-gradient-to-br from-primary-400 to-primary-600 text-white rounded-full flex items-center justify-center text-xs font-semibold shadow-sm">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-text truncate">{user.name}</p>
              <p className="text-[11px] text-text-subtle truncate capitalize">{user.role}</p>
            </div>
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2 mt-0.5 rounded-lg text-[13px] text-text-muted hover:bg-surface-muted hover:text-danger transition-all duration-150"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white/80 backdrop-blur-xl border-b border-border/60 flex items-center px-6 gap-4 shrink-0 sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-text-muted hover:text-text">
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-1.5 text-[13px] text-text-subtle">
            <span className="hidden sm:inline">AuraPay</span>
            {currentPage && (
              <>
                <ChevronRight size={12} className="text-text-subtle/60" />
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
