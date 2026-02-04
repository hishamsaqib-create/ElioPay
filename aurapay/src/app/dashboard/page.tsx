"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import Link from "next/link";
import { Plus, FileText, Users, TrendingUp, Calendar } from "lucide-react";

interface Period {
  id: number; month: number; year: number; status: string; created_at: string;
}

interface DentistCount { count: number; }

export default function DashboardPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [dentistCount, setDentistCount] = useState(0);

  useEffect(() => {
    fetch("/api/periods").then((r) => r.json()).then((d) => setPeriods(d.periods || []));
    fetch("/api/dentists").then((r) => r.json()).then((d) => setDentistCount(d.dentists?.length || 0));
  }, []);

  const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" });
  const latestPeriod = periods[0];

  return (
    <Shell>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Welcome */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Dashboard</h1>
            <p className="text-sm text-text-muted mt-0.5">Manage payslips and dentist payments</p>
          </div>
          <Link
            href="/payslips/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition shadow-sm"
          >
            <Plus size={16} />
            New Period
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-border p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-50 text-primary-600 rounded-lg flex items-center justify-center">
                <Users size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-text">{dentistCount}</p>
                <p className="text-xs text-text-muted">Active Dentists</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 text-success rounded-lg flex items-center justify-center">
                <FileText size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-text">{periods.length}</p>
                <p className="text-xs text-text-muted">Pay Periods</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 text-gold-500 rounded-lg flex items-center justify-center">
                <TrendingUp size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-text">
                  {latestPeriod ? `${monthName(latestPeriod.month)} ${latestPeriod.year}` : "None"}
                </p>
                <p className="text-xs text-text-muted">Latest Period</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent periods */}
        <div className="bg-white rounded-xl border border-border">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-text">Recent Pay Periods</h2>
            <Link href="/payslips" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              View all
            </Link>
          </div>
          {periods.length === 0 ? (
            <div className="p-10 text-center">
              <Calendar size={40} className="mx-auto text-text-subtle mb-3" />
              <p className="text-text-muted text-sm">No pay periods yet.</p>
              <Link
                href="/payslips/new"
                className="inline-flex items-center gap-1.5 mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                <Plus size={14} /> Create your first pay period
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {periods.slice(0, 5).map((p) => (
                <Link
                  key={p.id}
                  href={`/payslips/${p.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-surface-dim transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-primary-50 text-primary-600 rounded-lg flex items-center justify-center text-sm font-bold">
                      {monthName(p.month).substring(0, 3)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text">{monthName(p.month)} {p.year}</p>
                      <p className="text-xs text-text-subtle">Created {new Date(p.created_at).toLocaleDateString("en-GB")}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      p.status === "finalized"
                        ? "bg-green-50 text-green-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {p.status === "finalized" ? "Finalized" : "Draft"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
