"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";

export default function NewPeriodPage() {
  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [month, setMonth] = useState(prevMonth);
  const [year, setYear] = useState(prevYear);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function create() {
    setLoading(true);
    const res = await fetch("/api/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, year }),
    });
    const data = await res.json();
    router.push(`/payslips/${data.period.id}`);
  }

  const months = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i).toLocaleString("en-GB", { month: "long" }),
  }));

  return (
    <Shell>
      <div className="max-w-md mx-auto mt-8">
        <div className="bg-white rounded-2xl border border-border p-8 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-text">Create Pay Period</h1>
            <p className="text-sm text-text-muted mt-1">
              Select the month and year for the new payslip period. Entries will be created for all active dentists.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
          </div>
          <button
            onClick={create}
            disabled={loading}
            className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition disabled:opacity-50 text-sm"
          >
            {loading ? "Creating..." : "Create Period"}
          </button>
        </div>
      </div>
    </Shell>
  );
}
