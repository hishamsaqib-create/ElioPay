"use client";
import { useEffect, useState, useRef } from "react";
import Shell from "@/components/Shell";
import { Loader2, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "short" });

interface MonthlyTotal {
  year: number; month: number; lab_total: number; supplier_total: number;
}
interface ByMonth {
  year: number; month: number; lab_name?: string; supplier_name?: string;
  total: number; count: number; paid_count: number; paid_total: number; unpaid_total: number;
}
interface ByDentist {
  dentist_name: string | null; lab_name: string; total: number; count: number;
}
interface DentistPay {
  month: number; year: number; period_status: string; dentist_name: string; gross_private: number;
  lab_bills_json: string; finance_fees: number; therapy_minutes: number; therapy_rate: number;
  superannuation_deduction: number; adjustments_json: string; split_percentage: number;
  is_nhs: number; uda_rate: number; nhs_udas: number;
}
interface Summary {
  total_count: number; total_amount: number; paid_count: number; paid_amount: number;
  unpaid_count: number; unpaid_amount: number;
}

// Simple canvas line chart component
function LineChart({ data, width = 800, height = 300 }: { data: { label: string; values: { name: string; value: number; color: string }[] }[]; width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.scale(dpr, dpr);

    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Find all series names and max value
    const seriesNames = new Set<string>();
    let maxVal = 0;
    for (const d of data) {
      for (const v of d.values) {
        seriesNames.add(v.name);
        if (v.value > maxVal) maxVal = v.value;
      }
    }
    if (maxVal === 0) maxVal = 100;
    maxVal = Math.ceil(maxVal / 100) * 100; // Round up to nearest 100

    // Draw grid lines
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      // Y-axis labels
      const val = maxVal - (maxVal / gridLines) * i;
      ctx.fillStyle = "#6b7280";
      ctx.font = "11px system-ui";
      ctx.textAlign = "right";
      ctx.fillText("£" + val.toLocaleString(), padding.left - 8, y + 4);
    }

    // Draw lines for each series
    const seriesArray = Array.from(seriesNames);
    for (const seriesName of seriesArray) {
      const points: { x: number; y: number }[] = [];
      let color = "#3b82f6";

      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const v = d.values.find(v => v.name === seriesName);
        if (v) {
          color = v.color;
          const x = padding.left + (chartW / Math.max(data.length - 1, 1)) * i;
          const y = padding.top + chartH - (v.value / maxVal) * chartH;
          points.push({ x, y });
        }
      }

      if (points.length < 2) continue;

      // Draw line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();

      // Draw dots
      for (const p of points) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // X-axis labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    for (let i = 0; i < data.length; i++) {
      const x = padding.left + (chartW / Math.max(data.length - 1, 1)) * i;
      ctx.fillText(data[i].label, x, height - 8);
    }
  }, [data, width, height]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}

// Simple bar chart
function BarChart({ data, width = 800, height = 250 }: { data: { label: string; value: number; color: string }[]; width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.scale(dpr, dpr);

    const padding = { top: 20, right: 20, bottom: 50, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    let maxVal = Math.max(...data.map(d => d.value), 100);
    maxVal = Math.ceil(maxVal / 100) * 100;

    // Grid
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      const val = maxVal - (maxVal / 4) * i;
      ctx.fillStyle = "#6b7280";
      ctx.font = "11px system-ui";
      ctx.textAlign = "right";
      ctx.fillText("£" + val.toLocaleString(), padding.left - 8, y + 4);
    }

    // Bars
    const barWidth = Math.min(40, chartW / data.length - 8);
    const gap = (chartW - barWidth * data.length) / (data.length + 1);

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const x = padding.left + gap + (barWidth + gap) * i;
      const barH = (d.value / maxVal) * chartH;
      const y = padding.top + chartH - barH;

      ctx.fillStyle = d.color;
      ctx.beginPath();
      const radius = 4;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - radius, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
      ctx.lineTo(x + barWidth, padding.top + chartH);
      ctx.lineTo(x, padding.top + chartH);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.fill();

      // Label
      ctx.fillStyle = "#6b7280";
      ctx.font = "10px system-ui";
      ctx.textAlign = "center";
      ctx.save();
      ctx.translate(x + barWidth / 2, height - 5);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(d.label, 0, 0);
      ctx.restore();
    }
  }, [data, width, height]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}

export default function ReportingPage() {
  const [loading, setLoading] = useState(true);
  const [labByMonth, setLabByMonth] = useState<ByMonth[]>([]);
  const [supplierByMonth, setSupplierByMonth] = useState<ByMonth[]>([]);
  const [labByDentist, setLabByDentist] = useState<ByDentist[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotal[]>([]);
  const [dentistPay, setDentistPay] = useState<DentistPay[]>([]);
  const [labSummary, setLabSummary] = useState<Summary | null>(null);
  const [supplierSummary, setSupplierSummary] = useState<Summary | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/bills/reporting");
    if (res.ok) {
      const d = await res.json();
      setLabByMonth(d.labByMonth || []);
      setSupplierByMonth(d.supplierByMonth || []);
      setLabByDentist(d.labByDentist || []);
      setMonthlyTotals(d.monthlyTotals || []);
      setDentistPay(d.dentistPay || []);
      setLabSummary(d.labSummary || null);
      setSupplierSummary(d.supplierSummary || null);
    }
    setLoading(false);
  }

  // Prepare line chart data: monthly lab & supplier totals
  const trendData = monthlyTotals.map(m => ({
    label: `${monthName(m.month)} ${String(m.year).slice(2)}`,
    values: [
      { name: "Lab Bills", value: Number(m.lab_total) || 0, color: "#3b82f6" },
      { name: "Supplier Invoices", value: Number(m.supplier_total) || 0, color: "#f59e0b" },
    ],
  }));

  // Prepare dentist pay trend data (all periods)
  const dentistNames = [...new Set(dentistPay.map(d => d.dentist_name))];
  const dentistColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#6366f1"];
  const payMonths = [...new Set(dentistPay.map(d => `${d.year}-${d.month}`))].sort();

  function calcNetPay(entry: DentistPay): number {
    const labBills = JSON.parse(entry.lab_bills_json || "[]");
    const labTotal = labBills.reduce((s: number, b: { amount: number }) => s + (b.amount || 0), 0);
    const adjustments = JSON.parse(entry.adjustments_json || "[]");
    const adjTotal = adjustments.reduce((s: number, a: { amount: number; type: string }) =>
      s + (a.type === "addition" ? a.amount : -a.amount), 0);
    const netPrivate = entry.gross_private * (entry.split_percentage / 100);
    const nhsIncome = entry.is_nhs ? entry.nhs_udas * entry.uda_rate : 0;
    const labDeduction = labTotal * 0.5;
    const financeDeduction = entry.finance_fees * 0.5;
    const therapyDeduction = entry.therapy_minutes * entry.therapy_rate;
    return netPrivate + nhsIncome - labDeduction - financeDeduction - therapyDeduction - entry.superannuation_deduction + adjTotal;
  }

  const dentistTrendData = payMonths.map(pm => {
    const [year, month] = pm.split("-").map(Number);
    const monthEntries = dentistPay.filter(d => d.year === year && d.month === month);
    const isDraft = monthEntries.some(e => e.period_status === "draft");
    return {
      label: `${monthName(month)} ${String(year).slice(2)}${isDraft ? "*" : ""}`,
      values: dentistNames.map((name, idx) => {
        const entry = monthEntries.find(e => e.dentist_name === name);
        if (!entry) return { name, value: 0, color: dentistColors[idx % dentistColors.length] };
        return { name, value: Math.max(0, calcNetPay(entry)), color: dentistColors[idx % dentistColors.length] };
      }),
    };
  });

  // Build a pay data table for all periods
  const payTableData = payMonths.map(pm => {
    const [year, month] = pm.split("-").map(Number);
    const monthEntries = dentistPay.filter(d => d.year === year && d.month === month);
    const isDraft = monthEntries.some(e => e.period_status === "draft");
    const row: Record<string, number> = {};
    for (const entry of monthEntries) {
      row[entry.dentist_name] = Math.max(0, calcNetPay(entry));
    }
    return { year, month, isDraft, values: row, total: Object.values(row).reduce((s, v) => s + v, 0) };
  });

  // Lab bills by lab name bar chart
  const labNameTotals = new Map<string, number>();
  for (const b of labByMonth) {
    const name = b.lab_name || "Unknown";
    labNameTotals.set(name, (labNameTotals.get(name) || 0) + Number(b.total));
  }
  const labBarData = Array.from(labNameTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((d, i) => ({ label: d[0], value: d[1], color: ["#3b82f6", "#60a5fa", "#93c5fd", "#2563eb", "#1d4ed8", "#1e40af", "#3b82f6", "#60a5fa", "#93c5fd", "#2563eb"][i] }));

  // Anomaly detection: find months where costs deviate significantly from average
  const labMonthlyAmounts = new Map<string, number>();
  for (const b of labByMonth) {
    const key = `${b.year}-${b.month}`;
    labMonthlyAmounts.set(key, (labMonthlyAmounts.get(key) || 0) + Number(b.total));
  }
  const monthlyValues = Array.from(labMonthlyAmounts.values());
  const avgMonthly = monthlyValues.length > 0 ? monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length : 0;
  const stdDev = monthlyValues.length > 1
    ? Math.sqrt(monthlyValues.reduce((s, v) => s + Math.pow(v - avgMonthly, 2), 0) / monthlyValues.length)
    : 0;
  const anomalies = Array.from(labMonthlyAmounts.entries())
    .filter(([, v]) => Math.abs(v - avgMonthly) > stdDev * 1.5)
    .map(([key, value]) => {
      const [year, month] = key.split("-").map(Number);
      const diff = value - avgMonthly;
      return { label: `${monthName(month)} ${year}`, value, diff, isHigh: diff > 0 };
    });

  // Payment status breakdown
  const labUnpaidByEntity = new Map<string, number>();
  for (const b of labByMonth) {
    if (Number(b.unpaid_total) > 0) {
      const name = b.lab_name || "Unknown";
      labUnpaidByEntity.set(name, (labUnpaidByEntity.get(name) || 0) + Number(b.unpaid_total));
    }
  }
  const supplierUnpaidByEntity = new Map<string, number>();
  for (const b of supplierByMonth) {
    if (Number(b.unpaid_total) > 0) {
      const name = b.supplier_name || "Unknown";
      supplierUnpaidByEntity.set(name, (supplierUnpaidByEntity.get(name) || 0) + Number(b.unpaid_total));
    }
  }

  return (
    <Shell>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text">Reporting</h1>
          <p className="text-sm text-text-muted mt-1">Financial analytics, trends, and anomaly detection</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary-600" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-border p-4">
                <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Total Lab Bills</p>
                <p className="text-2xl font-bold text-text mt-1">{fmt(Number(labSummary?.total_amount || 0))}</p>
                <p className="text-xs text-text-subtle mt-1">{Number(labSummary?.total_count || 0)} bills</p>
              </div>
              <div className="bg-white rounded-xl border border-border p-4">
                <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Lab Bills Unpaid</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{fmt(Number(labSummary?.unpaid_amount || 0))}</p>
                <p className="text-xs text-text-subtle mt-1">{Number(labSummary?.unpaid_count || 0)} unpaid</p>
              </div>
              <div className="bg-white rounded-xl border border-border p-4">
                <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Total Supplier Invoices</p>
                <p className="text-2xl font-bold text-text mt-1">{fmt(Number(supplierSummary?.total_amount || 0))}</p>
                <p className="text-xs text-text-subtle mt-1">{Number(supplierSummary?.total_count || 0)} invoices</p>
              </div>
              <div className="bg-white rounded-xl border border-border p-4">
                <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Invoices Unpaid</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{fmt(Number(supplierSummary?.unpaid_amount || 0))}</p>
                <p className="text-xs text-text-subtle mt-1">{Number(supplierSummary?.unpaid_count || 0)} unpaid</p>
              </div>
            </div>

            {/* Monthly Trend Line Chart */}
            {trendData.length > 0 && (
              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-text">Monthly Costs Trend</h2>
                    <p className="text-xs text-text-muted mt-0.5">Lab bills and supplier invoices over time</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block rounded"></span> Lab Bills</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 inline-block rounded"></span> Supplier Invoices</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <LineChart data={trendData} width={Math.max(700, trendData.length * 80)} height={280} />
                </div>
              </div>
            )}

            {/* Dentist Pay Trend */}
            {dentistTrendData.length > 0 && (
              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-text">Dentist Net Pay Trend</h2>
                    <p className="text-xs text-text-muted mt-0.5">All pay periods &mdash; draft months marked with *</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {dentistNames.map((name, i) => (
                      <span key={name} className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: dentistColors[i % dentistColors.length] }}></span>
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <LineChart data={dentistTrendData} width={Math.max(700, dentistTrendData.length * 80)} height={280} />
                </div>

                {/* Pay Data Table */}
                {payTableData.length > 0 && (
                  <div className="mt-6 overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface-dim">
                          <th className="text-left px-4 py-2.5 font-medium text-text-muted">Period</th>
                          <th className="text-left px-4 py-2.5 font-medium text-text-muted">Status</th>
                          {dentistNames.map(name => (
                            <th key={name} className="text-right px-4 py-2.5 font-medium text-text-muted">{name}</th>
                          ))}
                          <th className="text-right px-4 py-2.5 font-medium text-text-muted">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payTableData.map((row, i) => (
                          <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-dim transition">
                            <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                              {monthName(row.month)} {row.year}
                            </td>
                            <td className="px-4 py-2.5">
                              {row.isDraft ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Draft</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Finalized</span>
                              )}
                            </td>
                            {dentistNames.map(name => (
                              <td key={name} className="px-4 py-2.5 text-right font-mono tabular-nums">
                                {row.values[name] != null ? fmt(row.values[name]) : <span className="text-text-subtle">&mdash;</span>}
                              </td>
                            ))}
                            <td className="px-4 py-2.5 text-right font-semibold font-mono tabular-nums">{fmt(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {payTableData.length > 1 && (
                        <tfoot>
                          <tr className="border-t-2 border-border bg-surface-dim">
                            <td className="px-4 py-2.5 font-semibold" colSpan={2}>Grand Total</td>
                            {dentistNames.map(name => {
                              const total = payTableData.reduce((s, row) => s + (row.values[name] || 0), 0);
                              return <td key={name} className="px-4 py-2.5 text-right font-semibold font-mono tabular-nums">{fmt(total)}</td>;
                            })}
                            <td className="px-4 py-2.5 text-right font-bold font-mono tabular-nums">
                              {fmt(payTableData.reduce((s, row) => s + row.total, 0))}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Lab Bills by Lab */}
              {labBarData.length > 0 && (
                <div className="bg-white rounded-xl border border-border p-6">
                  <h2 className="text-lg font-semibold text-text mb-1">Lab Bills by Lab</h2>
                  <p className="text-xs text-text-muted mb-4">Total spend per lab</p>
                  <BarChart data={labBarData} width={500} height={250} />
                </div>
              )}

              {/* Anomaly Detection */}
              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp size={18} className="text-primary-600" />
                  <h2 className="text-lg font-semibold text-text">Anomaly Detection</h2>
                </div>
                <p className="text-xs text-text-muted mb-4">
                  Months where lab bills deviate significantly from average ({fmt(avgMonthly)}/month)
                </p>
                {anomalies.length === 0 ? (
                  <div className="flex items-center gap-2 text-green-600 py-4">
                    <CheckCircle2 size={18} />
                    <span className="text-sm">No significant anomalies detected</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {anomalies.map((a, i) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg ${a.isHigh ? "bg-red-50" : "bg-green-50"}`}>
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} className={a.isHigh ? "text-red-500" : "text-green-500"} />
                          <span className="text-sm font-medium">{a.label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold">{fmt(a.value)}</span>
                          <span className={`text-xs ml-2 ${a.isHigh ? "text-red-600" : "text-green-600"}`}>
                            ({a.isHigh ? "+" : ""}{fmt(a.diff)} vs avg)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Payment Status Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Unpaid Lab Bills by Entity */}
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-surface-dim">
                  <h3 className="font-semibold text-text">Outstanding Lab Bills</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 font-medium text-text-muted">Lab</th>
                        <th className="text-right px-4 py-2.5 font-medium text-text-muted">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labUnpaidByEntity.size === 0 ? (
                        <tr><td colSpan={2} className="text-center py-6 text-green-600 text-sm"><CheckCircle2 size={16} className="inline mr-1" />All lab bills paid</td></tr>
                      ) : (
                        Array.from(labUnpaidByEntity.entries())
                          .sort((a, b) => b[1] - a[1])
                          .map(([name, amount]) => (
                            <tr key={name} className="border-b border-border last:border-0">
                              <td className="px-4 py-2.5 font-medium">{name}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-red-600">{fmt(amount)}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Unpaid Supplier Invoices by Entity */}
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-surface-dim">
                  <h3 className="font-semibold text-text">Outstanding Supplier Invoices</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 font-medium text-text-muted">Supplier</th>
                        <th className="text-right px-4 py-2.5 font-medium text-text-muted">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierUnpaidByEntity.size === 0 ? (
                        <tr><td colSpan={2} className="text-center py-6 text-green-600 text-sm"><CheckCircle2 size={16} className="inline mr-1" />All invoices paid</td></tr>
                      ) : (
                        Array.from(supplierUnpaidByEntity.entries())
                          .sort((a, b) => b[1] - a[1])
                          .map(([name, amount]) => (
                            <tr key={name} className="border-b border-border last:border-0">
                              <td className="px-4 py-2.5 font-medium">{name}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-red-600">{fmt(amount)}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Lab Bills by Dentist */}
            {labByDentist.length > 0 && (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-surface-dim">
                  <h3 className="font-semibold text-text">Lab Bills by Dentist</h3>
                  <p className="text-xs text-text-muted mt-0.5">Breakdown of lab spending per dentist</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 font-medium text-text-muted">Dentist</th>
                        <th className="text-left px-4 py-2.5 font-medium text-text-muted">Lab</th>
                        <th className="text-right px-4 py-2.5 font-medium text-text-muted">Total</th>
                        <th className="text-right px-4 py-2.5 font-medium text-text-muted">Bills</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labByDentist.map((d, i) => (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-dim transition">
                          <td className="px-4 py-2.5 font-medium">{d.dentist_name || "Unassigned"}</td>
                          <td className="px-4 py-2.5 text-text-subtle">{d.lab_name}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">{fmt(Number(d.total))}</td>
                          <td className="px-4 py-2.5 text-right text-text-subtle">{d.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
