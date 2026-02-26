"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import Link from "next/link";
import { Plus, Calendar, ChevronRight } from "lucide-react";

interface Period {
  id: number; month: number; year: number; status: string; created_at: string;
}

export default function PayslipsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);

  useEffect(() => {
    fetch("/api/periods").then((r) => r.json()).then((d) => setPeriods(d.periods || []));
  }, []);

  const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" });

  return (
    <Shell>
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text">Pay Periods</h1>
            <p className="text-xs sm:text-sm text-text-muted mt-0.5">All monthly payslip periods</p>
          </div>
          <Link
            href="/payslips/new"
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition w-full sm:w-auto"
          >
            <Plus size={16} /> New Period
          </Link>
        </div>

        <div className="bg-white rounded-xl border border-border">
          {periods.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar size={44} className="mx-auto text-text-subtle mb-3" />
              <p className="text-text-muted">No pay periods created yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {periods.map((p) => (
                <Link
                  key={p.id}
                  href={`/payslips/${p.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-surface-dim transition group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 bg-primary-50 text-primary-600 rounded-xl flex items-center justify-center font-bold text-sm">
                      {monthName(p.month).substring(0, 3)}
                    </div>
                    <div>
                      <p className="font-semibold text-text">{monthName(p.month)} {p.year}</p>
                      <p className="text-xs text-text-subtle mt-0.5">
                        Created {new Date(p.created_at).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        p.status === "finalized"
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {p.status === "finalized" ? "Finalized" : "Draft"}
                    </span>
                    <ChevronRight size={16} className="text-text-subtle group-hover:text-primary-600 transition" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
