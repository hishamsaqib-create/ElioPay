"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import {
  Download, Mail, ChevronDown, ChevronUp, Save, CheckCircle2,
  Plus, Trash2, Lock, Unlock, AlertCircle, Loader2
} from "lucide-react";

interface LabBill { lab_name: string; amount: number; description?: string; }
interface Adjustment { description: string; amount: number; type: "addition" | "deduction"; }
interface PrivatePatient { name: string; date: string; amount: number; finance: boolean; finance_term?: number; notes?: string; }

interface Calculation {
  grossPrivate: number; splitPercentage: number; netPrivate: number;
  nhsUdas: number; udaRate: number; nhsIncome: number;
  labBills: LabBill[]; labBillsTotal: number; labBillsDeduction: number;
  financeFees: number; financeFeesDeduction: number;
  therapyMinutes: number; therapyRate: number; therapyDeduction: number;
  adjustments: Adjustment[]; adjustmentsTotal: number;
  totalDeductions: number; totalEarnings: number; netPay: number;
}

interface Dentist {
  id: number; name: string; email: string | null;
  split_percentage: number; is_nhs: number; uda_rate: number;
  performer_number: string | null;
}

interface Entry {
  id: number; period_id: number; dentist_id: number;
  gross_private: number; nhs_udas: number; lab_bills_json: string;
  finance_fees: number; therapy_minutes: number; therapy_rate: number;
  adjustments_json: string; notes: string; private_patients_json: string;
  calculation: Calculation; dentist: Dentist;
  dentist_name: string; dentist_email: string | null;
}

interface Period {
  id: number; month: number; year: number; status: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" });

export default function PeriodDetailPage() {
  const params = useParams();
  const router = useRouter();
  const periodId = params.id as string;

  const [period, setPeriod] = useState<Period | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [emailSending, setEmailSending] = useState<Record<number, boolean>>({});
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [fetchingDentally, setFetchingDentally] = useState(false);

  const loadData = useCallback(async () => {
    const [periodsRes, entriesRes] = await Promise.all([
      fetch("/api/periods"),
      fetch(`/api/periods/entries?period_id=${periodId}`),
    ]);
    const periodsData = await periodsRes.json();
    const entriesData = await entriesRes.json();
    const p = periodsData.periods?.find((p: Period) => p.id === parseInt(periodId));
    setPeriod(p || null);
    setEntries(entriesData.entries || []);
  }, [periodId]);

  useEffect(() => { loadData(); }, [loadData]);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function saveEntry(entry: Entry) {
    setSaving((s) => ({ ...s, [entry.id]: true }));
    const labBills: LabBill[] = JSON.parse(entry.lab_bills_json || "[]");
    const adjustments: Adjustment[] = JSON.parse(entry.adjustments_json || "[]");
    const privatePatients: PrivatePatient[] = JSON.parse(entry.private_patients_json || "[]");

    await fetch("/api/periods/entries", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        gross_private: entry.gross_private,
        nhs_udas: entry.nhs_udas,
        lab_bills: labBills,
        finance_fees: entry.finance_fees,
        therapy_minutes: entry.therapy_minutes,
        therapy_rate: entry.therapy_rate,
        adjustments: adjustments,
        notes: entry.notes,
        private_patients: privatePatients,
      }),
    });
    await loadData();
    setSaving((s) => ({ ...s, [entry.id]: false }));
    showToast(`Saved ${entry.dentist_name}`);
  }

  function updateEntry(id: number, updates: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  }

  function updateLabBills(entryId: number, labBills: LabBill[]) {
    updateEntry(entryId, { lab_bills_json: JSON.stringify(labBills) });
  }

  function updateAdjustments(entryId: number, adjustments: Adjustment[]) {
    updateEntry(entryId, { adjustments_json: JSON.stringify(adjustments) });
  }

  function updatePatients(entryId: number, patients: PrivatePatient[]) {
    updateEntry(entryId, { private_patients_json: JSON.stringify(patients) });
  }

  async function downloadPdf(entryId: number) {
    const res = await fetch(`/api/payslips/generate-pdf?entry_id=${entryId}`);
    if (!res.ok) { showToast("PDF generation failed", "error"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "payslip.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendEmail(entryId: number, dentistId: number) {
    setEmailSending((s) => ({ ...s, [entryId]: true }));
    const res = await fetch("/api/payslips/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry_id: entryId }),
    });
    const data = await res.json();
    if (res.ok) showToast(data.message || "Email sent!");
    else showToast(data.error || "Failed to send email", "error");
    setEmailSending((s) => ({ ...s, [entryId]: false }));
  }

  async function fetchFromDentally() {
    setFetchingDentally(true);
    try {
      const res = await fetch("/api/dentally", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_id: parseInt(periodId) }),
      });
      const data = await res.json();
      if (res.ok) {
        console.log("Dentally fetch debug:", data.debug);
        showToast(data.message || "Data fetched from Dentally");
        await loadData();
      } else {
        showToast(data.error || "Failed to fetch from Dentally", "error");
      }
    } catch {
      showToast("Network error fetching from Dentally", "error");
    }
    setFetchingDentally(false);
  }

  async function toggleFinalize() {
    if (!period) return;
    const newStatus = period.status === "finalized" ? "draft" : "finalized";
    await fetch("/api/periods/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period_id: period.id, status: newStatus }),
    });
    loadData();
    showToast(newStatus === "finalized" ? "Period finalized" : "Period reopened");
  }

  if (!period) {
    return <Shell><div className="flex items-center justify-center h-64 text-text-muted">Loading...</div></Shell>;
  }

  const totalNetPay = entries.reduce((s, e) => s + e.calculation.netPay, 0);
  const isFinalized = period.status === "finalized";

  return (
    <Shell>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${
            toast.type === "success" ? "bg-green-600" : "bg-red-600"
          }`}>
            {toast.msg}
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text">
              {monthName(period.month)} {period.year}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                isFinalized ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
              }`}>
                {isFinalized ? "Finalized" : "Draft"}
              </span>
              <span className="text-sm text-text-muted">{entries.length} dentists</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isFinalized && (
              <button
                onClick={fetchFromDentally}
                disabled={fetchingDentally}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition border border-primary-300 text-primary-700 hover:bg-primary-50 disabled:opacity-50"
              >
                {fetchingDentally ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {fetchingDentally ? "Fetching..." : "Fetch from Dentally"}
              </button>
            )}
            <button
              onClick={toggleFinalize}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition border ${
                isFinalized
                  ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                  : "border-green-300 text-green-700 hover:bg-green-50"
              }`}
            >
              {isFinalized ? <Unlock size={15} /> : <Lock size={15} />}
              {isFinalized ? "Reopen" : "Finalize"}
            </button>
          </div>
        </div>

        {/* Total banner */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl p-6 text-white">
          <p className="text-sm text-slate-400 font-medium">Total Net Payroll</p>
          <p className="text-3xl font-bold mt-1 text-amber-400">{fmt(totalNetPay)}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-700">
            <div>
              <p className="text-xs text-slate-400">Total Gross</p>
              <p className="text-sm font-semibold">{fmt(entries.reduce((s, e) => s + e.calculation.grossPrivate, 0))}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Total NHS</p>
              <p className="text-sm font-semibold">{fmt(entries.reduce((s, e) => s + e.calculation.nhsIncome, 0))}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Total Deductions</p>
              <p className="text-sm font-semibold text-red-400">{fmt(entries.reduce((s, e) => s + e.calculation.totalDeductions, 0))}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Dentists</p>
              <p className="text-sm font-semibold">{entries.length}</p>
            </div>
          </div>
        </div>

        {/* Dentist cards */}
        <div className="space-y-3">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id;
            const labBills: LabBill[] = JSON.parse(entry.lab_bills_json || "[]");
            const adjustments: Adjustment[] = JSON.parse(entry.adjustments_json || "[]");
            const patients: PrivatePatient[] = JSON.parse(entry.private_patients_json || "[]");
            const c = entry.calculation;

            return (
              <div key={entry.id} className="bg-white rounded-xl border border-border overflow-hidden">
                {/* Summary row */}
                <button
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-dim transition text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center font-bold text-sm">
                      {entry.dentist_name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <div>
                      <p className="font-semibold text-text">{entry.dentist_name}</p>
                      <p className="text-xs text-text-muted">
                        {c.splitPercentage}% split
                        {entry.dentist.is_nhs ? " | NHS" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-bold text-text">{fmt(c.netPay)}</p>
                      <p className="text-xs text-text-muted">Net Pay</p>
                    </div>
                    {expanded ? <ChevronUp size={18} className="text-text-subtle" /> : <ChevronDown size={18} className="text-text-subtle" />}
                  </div>
                </button>

                {/* Expanded detail */}
                {expanded && (
                  <div className="border-t border-border px-5 py-5 space-y-6">
                    {/* Quick summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-surface-dim rounded-lg p-3">
                        <p className="text-xs text-text-muted">Gross Private</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(c.grossPrivate)}</p>
                      </div>
                      <div className="bg-surface-dim rounded-lg p-3">
                        <p className="text-xs text-text-muted">Net Private</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(c.netPrivate)}</p>
                      </div>
                      <div className="bg-surface-dim rounded-lg p-3">
                        <p className="text-xs text-text-muted">NHS Income</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(c.nhsIncome)}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3">
                        <p className="text-xs text-red-600">Total Deductions</p>
                        <p className="text-sm font-bold text-red-700 mt-0.5">-{fmt(c.totalDeductions)}</p>
                      </div>
                    </div>

                    {/* Editable fields */}
                    <div className="space-y-5">
                      {/* Gross Private & NHS */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-text-muted mb-1">Gross Private Income</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle text-sm">£</span>
                            <input
                              type="number"
                              step="0.01"
                              value={entry.gross_private || ""}
                              onChange={(e) => updateEntry(entry.id, { gross_private: parseFloat(e.target.value) || 0 })}
                              disabled={isFinalized}
                              className="w-full pl-7 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted disabled:text-text-muted"
                            />
                          </div>
                        </div>
                        {entry.dentist.is_nhs ? (
                          <div>
                            <label className="block text-xs font-medium text-text-muted mb-1">
                              NHS UDAs <span className="text-text-subtle">(x £{entry.dentist.uda_rate})</span>
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              value={entry.nhs_udas || ""}
                              onChange={(e) => updateEntry(entry.id, { nhs_udas: parseFloat(e.target.value) || 0 })}
                              disabled={isFinalized}
                              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                            />
                          </div>
                        ) : null}
                        <div>
                          <label className="block text-xs font-medium text-text-muted mb-1">Finance Fees Total</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle text-sm">£</span>
                            <input
                              type="number"
                              step="0.01"
                              value={entry.finance_fees || ""}
                              onChange={(e) => updateEntry(entry.id, { finance_fees: parseFloat(e.target.value) || 0 })}
                              disabled={isFinalized}
                              className="w-full pl-7 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Therapy */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-text-muted mb-1">Therapy Minutes</label>
                          <input
                            type="number"
                            value={entry.therapy_minutes || ""}
                            onChange={(e) => updateEntry(entry.id, { therapy_minutes: parseFloat(e.target.value) || 0 })}
                            disabled={isFinalized}
                            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-muted mb-1">Rate per Minute</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle text-sm">£</span>
                            <input
                              type="number"
                              step="0.0001"
                              value={entry.therapy_rate}
                              onChange={(e) => updateEntry(entry.id, { therapy_rate: parseFloat(e.target.value) || 0.5833 })}
                              disabled={isFinalized}
                              className="w-full pl-7 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Lab Bills */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-semibold text-text uppercase tracking-wide">Lab Bills</label>
                          {!isFinalized && (
                            <button
                              onClick={() => updateLabBills(entry.id, [...labBills, { lab_name: "", amount: 0 }])}
                              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                            >
                              <Plus size={13} /> Add Lab Bill
                            </button>
                          )}
                        </div>
                        {labBills.length === 0 ? (
                          <p className="text-xs text-text-subtle italic">No lab bills added</p>
                        ) : (
                          <div className="space-y-2">
                            {labBills.map((lb, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <input
                                  placeholder="Lab name"
                                  value={lb.lab_name}
                                  onChange={(e) => {
                                    const updated = [...labBills];
                                    updated[i] = { ...updated[i], lab_name: e.target.value };
                                    updateLabBills(entry.id, updated);
                                  }}
                                  disabled={isFinalized}
                                  className="flex-1 px-3 py-1.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                                />
                                <div className="relative w-28">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle text-xs">£</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={lb.amount || ""}
                                    onChange={(e) => {
                                      const updated = [...labBills];
                                      updated[i] = { ...updated[i], amount: parseFloat(e.target.value) || 0 };
                                      updateLabBills(entry.id, updated);
                                    }}
                                    disabled={isFinalized}
                                    className="w-full pl-6 pr-2 py-1.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                                  />
                                </div>
                                {!isFinalized && (
                                  <button
                                    onClick={() => updateLabBills(entry.id, labBills.filter((_, j) => j !== i))}
                                    className="text-text-subtle hover:text-danger transition"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            ))}
                            <p className="text-xs text-text-muted">
                              Total: {fmt(c.labBillsTotal)} (Dentist pays 50%: {fmt(c.labBillsDeduction)})
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Adjustments */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-semibold text-text uppercase tracking-wide">Adjustments</label>
                          {!isFinalized && (
                            <button
                              onClick={() => updateAdjustments(entry.id, [...adjustments, { description: "", amount: 0, type: "deduction" }])}
                              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                            >
                              <Plus size={13} /> Add Adjustment
                            </button>
                          )}
                        </div>
                        {adjustments.length === 0 ? (
                          <p className="text-xs text-text-subtle italic">No adjustments</p>
                        ) : (
                          <div className="space-y-2">
                            {adjustments.map((adj, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <select
                                  value={adj.type}
                                  onChange={(e) => {
                                    const updated = [...adjustments];
                                    updated[i] = { ...updated[i], type: e.target.value as "addition" | "deduction" };
                                    updateAdjustments(entry.id, updated);
                                  }}
                                  disabled={isFinalized}
                                  className="w-28 px-2 py-1.5 border border-border rounded-lg text-xs focus:ring-2 focus:ring-primary-500 outline-none bg-white disabled:bg-surface-muted"
                                >
                                  <option value="deduction">Deduction</option>
                                  <option value="addition">Addition</option>
                                </select>
                                <input
                                  placeholder="Description"
                                  value={adj.description}
                                  onChange={(e) => {
                                    const updated = [...adjustments];
                                    updated[i] = { ...updated[i], description: e.target.value };
                                    updateAdjustments(entry.id, updated);
                                  }}
                                  disabled={isFinalized}
                                  className="flex-1 px-3 py-1.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                                />
                                <div className="relative w-28">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle text-xs">£</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={adj.amount || ""}
                                    onChange={(e) => {
                                      const updated = [...adjustments];
                                      updated[i] = { ...updated[i], amount: parseFloat(e.target.value) || 0 };
                                      updateAdjustments(entry.id, updated);
                                    }}
                                    disabled={isFinalized}
                                    className="w-full pl-6 pr-2 py-1.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                                  />
                                </div>
                                {!isFinalized && (
                                  <button
                                    onClick={() => updateAdjustments(entry.id, adjustments.filter((_, j) => j !== i))}
                                    className="text-text-subtle hover:text-danger transition"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Private Patients */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-semibold text-text uppercase tracking-wide">Private Patients</label>
                          {!isFinalized && (
                            <button
                              onClick={() => updatePatients(entry.id, [...patients, { name: "", date: "", amount: 0, finance: false }])}
                              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                            >
                              <Plus size={13} /> Add Patient
                            </button>
                          )}
                        </div>
                        {patients.length === 0 ? (
                          <p className="text-xs text-text-subtle italic">No individual patients logged</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="grid grid-cols-12 gap-2 text-xs text-text-muted font-medium px-1">
                              <span className="col-span-4">Patient Name</span>
                              <span className="col-span-2">Date</span>
                              <span className="col-span-2">Amount</span>
                              <span className="col-span-2">Finance</span>
                              <span className="col-span-2"></span>
                            </div>
                            {patients.map((pt, i) => (
                              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                                <input
                                  placeholder="Name"
                                  value={pt.name}
                                  onChange={(e) => {
                                    const updated = [...patients];
                                    updated[i] = { ...updated[i], name: e.target.value };
                                    updatePatients(entry.id, updated);
                                  }}
                                  disabled={isFinalized}
                                  className="col-span-4 px-2 py-1.5 border border-border rounded-lg text-xs focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                                />
                                <input
                                  type="date"
                                  value={pt.date}
                                  onChange={(e) => {
                                    const updated = [...patients];
                                    updated[i] = { ...updated[i], date: e.target.value };
                                    updatePatients(entry.id, updated);
                                  }}
                                  disabled={isFinalized}
                                  className="col-span-2 px-2 py-1.5 border border-border rounded-lg text-xs focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                                />
                                <div className="col-span-2 relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle text-xs">£</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={pt.amount || ""}
                                    onChange={(e) => {
                                      const updated = [...patients];
                                      updated[i] = { ...updated[i], amount: parseFloat(e.target.value) || 0 };
                                      updatePatients(entry.id, updated);
                                    }}
                                    disabled={isFinalized}
                                    className="w-full pl-5 pr-2 py-1.5 border border-border rounded-lg text-xs focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted"
                                  />
                                </div>
                                <label className="col-span-2 flex items-center gap-1.5 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={pt.finance}
                                    onChange={(e) => {
                                      const updated = [...patients];
                                      updated[i] = { ...updated[i], finance: e.target.checked };
                                      updatePatients(entry.id, updated);
                                    }}
                                    disabled={isFinalized}
                                    className="w-3.5 h-3.5 rounded border-border"
                                  />
                                  Finance
                                </label>
                                <div className="col-span-2 flex justify-end">
                                  {!isFinalized && (
                                    <button
                                      onClick={() => updatePatients(entry.id, patients.filter((_, j) => j !== i))}
                                      className="text-text-subtle hover:text-danger transition"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Notes</label>
                        <textarea
                          value={entry.notes || ""}
                          onChange={(e) => updateEntry(entry.id, { notes: e.target.value })}
                          disabled={isFinalized}
                          rows={2}
                          className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none resize-none disabled:bg-surface-muted"
                          placeholder="Any notes for this payslip..."
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-4 border-t border-border">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => downloadPdf(entry.id)}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg transition"
                        >
                          <Download size={15} /> PDF
                        </button>
                        <button
                          onClick={() => sendEmail(entry.id, entry.dentist_id)}
                          disabled={!entry.dentist_email || emailSending[entry.id]}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg transition disabled:opacity-40"
                          title={entry.dentist_email ? `Send to ${entry.dentist_email}` : "No email address set"}
                        >
                          {emailSending[entry.id] ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                          Email
                        </button>
                        {!entry.dentist_email && (
                          <span className="flex items-center gap-1 text-xs text-amber-600">
                            <AlertCircle size={12} /> No email set
                          </span>
                        )}
                      </div>
                      {!isFinalized && (
                        <button
                          onClick={() => saveEntry(entry)}
                          disabled={saving[entry.id]}
                          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                        >
                          {saving[entry.id] ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Save size={15} />
                          )}
                          Save
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
