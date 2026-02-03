"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import {
  Download, Mail, ChevronDown, ChevronUp, Save, CheckCircle2,
  Plus, Trash2, Lock, Unlock, AlertCircle, Loader2, Undo2, FileSpreadsheet, FileText, X
} from "lucide-react";

interface LabBill { lab_name: string; amount: number; description?: string; }
interface Adjustment { description: string; amount: number; type: "addition" | "deduction"; }
interface PrivatePatient {
  name: string; date: string; amount: number; finance: boolean;
  amountPaid?: number; amountOutstanding?: number;
  status?: "paid" | "partial" | "unpaid";
  flagged?: boolean; flagReason?: string;
  financeFee?: number; invoiceId?: string; patientId?: string;
  resolved?: boolean; resolvedNote?: string;
}
interface Discrepancy {
  type: "invoiced_not_paid" | "partial_payment" | "log_mismatch" | "in_log_not_system" | "in_system_not_log";
  patientName: string; invoicedAmount: number; paidAmount: number;
  date: string; notes: string; resolved?: boolean;
}
interface DentistLogEntry {
  patientName: string; date: string; amount: number; treatment?: string;
}

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
  discrepancies_json?: string; dentist_log_json?: string;
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
  const [dentallyResult, setDentallyResult] = useState<Record<string, unknown> | null>(null);
  const [showLogImport, setShowLogImport] = useState<number | null>(null);
  const [logCsv, setLogCsv] = useState("");
  const [importingLog, setImportingLog] = useState(false);
  const [fetchingSheets, setFetchingSheets] = useState(false);
  const [showNhsUpload, setShowNhsUpload] = useState(false);
  const [nhsText, setNhsText] = useState("");
  const [nhsManual, setNhsManual] = useState<Record<string, string>>({});
  const [processingNhs, setProcessingNhs] = useState(false);

  // Undo history - stores previous entry states
  const [undoHistory, setUndoHistory] = useState<Map<number, Entry[]>>(new Map());
  const MAX_UNDO_HISTORY = 10;

  // Save state for undo before any change
  function saveForUndo(entryId: number, currentEntry: Entry) {
    setUndoHistory(prev => {
      const newMap = new Map(prev);
      const history = newMap.get(entryId) || [];
      const newHistory = [...history, { ...currentEntry }].slice(-MAX_UNDO_HISTORY);
      newMap.set(entryId, newHistory);
      return newMap;
    });
  }

  // Undo last change for an entry
  function undoEntry(entryId: number) {
    const history = undoHistory.get(entryId);
    if (!history || history.length === 0) return;

    const previousState = history[history.length - 1];
    setEntries(prev => prev.map(e => e.id === entryId ? previousState : e));

    // Remove the used state from history
    setUndoHistory(prev => {
      const newMap = new Map(prev);
      const newHistory = [...(newMap.get(entryId) || [])];
      newHistory.pop();
      newMap.set(entryId, newHistory);
      return newMap;
    });

    showToast("Change undone");
  }

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

  function updateEntry(id: number, updates: Partial<Entry>, skipUndo = false) {
    const entry = entries.find(e => e.id === id);
    if (entry && !skipUndo) {
      saveForUndo(id, entry);
    }
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
        setDentallyResult(data);
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

  async function importDentistLog(entryId: number) {
    if (!logCsv.trim()) {
      showToast("Please paste CSV data", "error");
      return;
    }
    setImportingLog(true);
    try {
      const res = await fetch("/api/periods/dentist-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId, csv_data: logCsv }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Log imported successfully");
        setShowLogImport(null);
        setLogCsv("");
        await loadData();
      } else {
        showToast(data.error || "Failed to import log", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
    setImportingLog(false);
  }

  async function fetchFromGoogleSheets(entryId: number, dentistName: string) {
    setFetchingSheets(true);
    try {
      const res = await fetch("/api/google-sheets/takings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: entryId,
          dentist_name: dentistName,
          period_id: parseInt(periodId),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || `Imported ${data.count || 0} entries from Google Sheets`);
        await loadData();
      } else {
        showToast(data.error || "Failed to fetch from Google Sheets", "error");
      }
    } catch {
      showToast("Network error fetching from Google Sheets", "error");
    }
    setFetchingSheets(false);
  }

  async function submitNhsStatement() {
    setProcessingNhs(true);
    try {
      const formData = new FormData();
      formData.append("period_id", periodId);
      if (nhsText.trim()) {
        formData.append("statement_text", nhsText);
      }
      if (Object.keys(nhsManual).length > 0) {
        formData.append("manual_udas", JSON.stringify(nhsManual));
      }

      const res = await fetch("/api/nhs-statement", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "NHS UDAs updated");
        setShowNhsUpload(false);
        setNhsText("");
        setNhsManual({});
        await loadData();
      } else {
        showToast(data.error || "Failed to process NHS statement", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
    setProcessingNhs(false);
  }

  // Get NHS dentists from entries
  const nhsDentists = entries.filter(e => e.dentist.is_nhs);

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

        {/* NHS Statement Upload (only show if there are NHS dentists) */}
        {nhsDentists.length > 0 && !isFinalized && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText size={20} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-blue-800">NHS Statement</h3>
                  <p className="text-xs text-blue-600">Upload or enter NHS UDAs for {nhsDentists.map(e => e.dentist_name).join(", ")}</p>
                </div>
              </div>
              <button
                onClick={() => setShowNhsUpload(!showNhsUpload)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 hover:text-blue-800 bg-blue-100 hover:bg-blue-200 rounded-lg transition"
              >
                {showNhsUpload ? <X size={14} /> : <Plus size={14} />}
                {showNhsUpload ? "Close" : "Enter UDAs"}
              </button>
            </div>

            {showNhsUpload && (
              <div className="mt-4 pt-4 border-t border-blue-200 space-y-4">
                {/* Manual UDA Entry */}
                <div>
                  <label className="block text-xs font-medium text-blue-800 mb-2">Enter UDAs Manually</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {nhsDentists.map(entry => (
                      <div key={entry.id} className="bg-white rounded-lg p-3 border border-blue-100">
                        <label className="block text-xs font-medium text-text mb-1">
                          {entry.dentist_name}
                          <span className="text-text-muted ml-1">(£{entry.dentist.uda_rate}/UDA)</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0"
                          value={nhsManual[entry.dentist_name] || ""}
                          onChange={(e) => setNhsManual({ ...nhsManual, [entry.dentist_name]: e.target.value })}
                          className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        {nhsManual[entry.dentist_name] && parseFloat(nhsManual[entry.dentist_name]) > 0 && (
                          <p className="text-xs text-green-600 mt-1">
                            = £{(parseFloat(nhsManual[entry.dentist_name]) * entry.dentist.uda_rate).toFixed(2)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Or paste statement text */}
                <div>
                  <label className="block text-xs font-medium text-blue-800 mb-1">
                    Or Paste NHS Statement Text
                    <span className="text-blue-600 font-normal ml-1">(optional - will try to auto-extract UDAs)</span>
                  </label>
                  <textarea
                    value={nhsText}
                    onChange={(e) => setNhsText(e.target.value)}
                    rows={4}
                    placeholder="Paste the text content from your NHS statement here..."
                    className="w-full px-3 py-2 border border-border rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={submitNhsStatement}
                    disabled={processingNhs || (Object.keys(nhsManual).length === 0 && !nhsText.trim())}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                  >
                    {processingNhs ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Update NHS UDAs
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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

        {/* Dentally fetch results */}
        {dentallyResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-blue-800">Dentally Fetch Results</h3>
              <button onClick={() => setDentallyResult(null)} className="text-xs text-blue-600 hover:underline">Dismiss</button>
            </div>
            <p className="text-sm text-blue-700">{String(dentallyResult.message || "")}</p>
            {(() => {
              const debug = dentallyResult.debug as Record<string, unknown> | undefined;
              if (!debug) return null;
              return (
                <div className="text-xs text-blue-600 space-y-1">
                  <p>
                    Total from API: {String(debug.totalInvoicesFromApi || debug.totalInvoices || 0)} |
                    In date range: <span className="font-semibold">{String(debug.invoicesInDateRange || debug.processedInvoices || 0)}</span>
                  </p>
                  <p>
                    Flagged for review: <span className="text-amber-600 font-medium">{String(debug.flaggedForReview || 0)}</span>
                    {debug.financePayments ? <span className="text-blue-600 ml-2">| Finance: {String(debug.financePayments)}</span> : null}
                  </p>
                  <p>Skipped: {String(debug.skippedNonClinician || debug.skippedTherapist || 0)} non-clinician, {String(debug.skippedNhs || 0)} NHS</p>
                  {(() => {
                    const unmatched = (debug.unmatchedClinicianIds || debug.unmatchedUserIds) as Array<{ id: string; name?: string; role?: string }> | string[];
                    if (!unmatched || unmatched.length === 0) return null;
                    // Handle both old format (string[]) and new format (object[])
                    if (typeof unmatched[0] === "string") {
                      return <p className="text-amber-600">Unmatched IDs: {(unmatched as string[]).join(", ")}</p>;
                    }
                    return (
                      <div className="text-amber-600">
                        <p className="font-medium">Unmatched Clinician IDs (add these to Dentists page):</p>
                        {(unmatched as Array<{ id: string; name?: string; role?: string }>).map((u, i) => (
                          <p key={i} className="ml-2">
                            <code className="bg-amber-100 px-1 rounded">{u.id}</code>
                            {u.name && <span className="ml-1">= {u.name}</span>}
                            {u.role && <span className="text-amber-500 ml-1">({u.role})</span>}
                          </p>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            {(() => {
              const summary = dentallyResult.summary as Record<string, { invoiced: number; paid: number; outstanding: number; patients: number; flagged: number; finance?: number }> | undefined;
              if (!summary || Object.keys(summary).length === 0) return null;
              return (
                <div className="text-xs text-blue-700 mt-2">
                  <p className="font-medium mb-2">Summary by Dentist:</p>
                  <div className="grid gap-2">
                    {Object.entries(summary).map(([name, data]) => (
                      <div key={name} className="bg-white/50 rounded p-2">
                        <p className="font-medium">{name}</p>
                        <div className="flex flex-wrap gap-3 mt-1 text-[11px]">
                          <span>Invoiced: {fmt(data.invoiced)}</span>
                          <span className="text-green-600">Paid: {fmt(data.paid)}</span>
                          {data.outstanding > 0 && <span className="text-red-600">Outstanding: {fmt(data.outstanding)}</span>}
                          <span>{data.patients} patients</span>
                          {data.flagged > 0 && <span className="text-amber-600">{data.flagged} flagged</span>}
                          {data.finance && data.finance > 0 && <span className="text-blue-600">{data.finance} finance</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

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
                        {(() => { const pts: PrivatePatient[] = JSON.parse(entry.private_patients_json || "[]"); return pts.length > 0 ? ` | ${pts.length} patients` : ""; })()}
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
                  <div className="border-t-2 border-primary-200 bg-gradient-to-b from-slate-50 to-white px-5 py-5 space-y-6">
                    {/* Undo button */}
                    {!isFinalized && (undoHistory.get(entry.id)?.length || 0) > 0 && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => undoEntry(entry.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                        >
                          <Undo2 size={14} />
                          Undo ({undoHistory.get(entry.id)?.length || 0})
                        </button>
                      </div>
                    )}

                    {/* Quick summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                        <p className="text-xs text-text-muted">Gross Private</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(c.grossPrivate)}</p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                        <p className="text-xs text-text-muted">Net Private</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(c.netPrivate)}</p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                        <p className="text-xs text-text-muted">NHS Income</p>
                        <p className="text-sm font-bold mt-0.5">{fmt(c.nhsIncome)}</p>
                      </div>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 shadow-sm">
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

                      {/* Private Patients Breakdown */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-semibold text-text uppercase tracking-wide">
                            Private Patients ({patients.length})
                            {patients.length > 0 && (
                              <span className="ml-2 font-normal normal-case">
                                <span className="text-green-600">Paid: {fmt(patients.reduce((s, p) => s + (p.amountPaid ?? p.amount), 0))}</span>
                                {patients.some(p => p.amountOutstanding && p.amountOutstanding > 0) && (
                                  <span className="text-red-600 ml-2">Outstanding: {fmt(patients.reduce((s, p) => s + (p.amountOutstanding ?? 0), 0))}</span>
                                )}
                              </span>
                            )}
                          </label>
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
                          <p className="text-xs text-text-subtle italic">No individual patients logged. Click &quot;Fetch from Dentally&quot; to auto-import or add manually.</p>
                        ) : (
                          <div className="space-y-1">
                            <div className="bg-surface-dim rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="text-left px-3 py-2 font-medium text-text-muted">Patient</th>
                                    <th className="text-left px-3 py-2 font-medium text-text-muted">Date</th>
                                    <th className="text-right px-3 py-2 font-medium text-text-muted">Amount</th>
                                    <th className="text-center px-3 py-2 font-medium text-text-muted">Status</th>
                                    <th className="text-center px-3 py-2 font-medium text-text-muted">Finance</th>
                                    <th className="text-right px-3 py-2 font-medium text-text-muted">Fee</th>
                                    {!isFinalized && <th className="w-8"></th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {patients.map((pt, i) => (
                                    <tr key={i} className={`border-b border-border last:border-0 ${pt.flagged && !pt.resolved ? "bg-amber-50" : pt.resolved ? "bg-green-50" : ""}`}>
                                      <td className="px-3 py-1.5">
                                        <div className="flex items-center gap-1">
                                          {pt.flagged && !pt.resolved && <AlertCircle size={12} className="text-amber-500 shrink-0" />}
                                          {pt.resolved && <CheckCircle2 size={12} className="text-green-500 shrink-0" />}
                                          <input
                                            placeholder="Name"
                                            value={pt.name}
                                            onChange={(e) => {
                                              const updated = [...patients];
                                              updated[i] = { ...updated[i], name: e.target.value };
                                              updatePatients(entry.id, updated);
                                            }}
                                            disabled={isFinalized}
                                            className="w-full bg-transparent text-xs outline-none disabled:text-text-muted"
                                          />
                                        </div>
                                        {pt.flagReason && !pt.resolved && (
                                          <p className="text-[10px] text-amber-600 mt-0.5 ml-4">{pt.flagReason}</p>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        <input
                                          type="date"
                                          value={pt.date}
                                          onChange={(e) => {
                                            const updated = [...patients];
                                            updated[i] = { ...updated[i], date: e.target.value };
                                            updatePatients(entry.id, updated);
                                          }}
                                          disabled={isFinalized}
                                          className="w-full bg-transparent text-xs outline-none disabled:text-text-muted"
                                        />
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-medium">
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
                                          className="w-20 bg-transparent text-xs text-right outline-none disabled:text-text-muted"
                                        />
                                      </td>
                                      <td className="px-3 py-1.5 text-center">
                                        {!isFinalized ? (
                                          <select
                                            value={pt.status || "paid"}
                                            onChange={(e) => {
                                              const updated = [...patients];
                                              const newStatus = e.target.value as "paid" | "partial" | "unpaid";
                                              updated[i] = {
                                                ...updated[i],
                                                status: newStatus,
                                                amountPaid: newStatus === "paid" ? pt.amount : newStatus === "unpaid" ? 0 : pt.amountPaid,
                                                amountOutstanding: newStatus === "unpaid" ? pt.amount : newStatus === "paid" ? 0 : pt.amountOutstanding,
                                                flagged: newStatus !== "paid",
                                                flagReason: newStatus === "unpaid" ? "Invoice not paid" : newStatus === "partial" ? "Partial payment" : undefined,
                                              };
                                              updatePatients(entry.id, updated);
                                            }}
                                            className={`text-[10px] font-medium rounded px-1 py-0.5 border-0 outline-none ${
                                              pt.status === "paid" ? "bg-green-100 text-green-700" :
                                              pt.status === "partial" ? "bg-amber-100 text-amber-700" :
                                              pt.status === "unpaid" ? "bg-red-100 text-red-700" :
                                              "bg-gray-100 text-gray-600"
                                            }`}
                                          >
                                            <option value="paid">PAID</option>
                                            <option value="partial">PARTIAL</option>
                                            <option value="unpaid">UNPAID</option>
                                          </select>
                                        ) : (
                                          pt.status === "paid" ? (
                                            <span className="inline-block px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">PAID</span>
                                          ) : pt.status === "partial" ? (
                                            <span className="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">PARTIAL</span>
                                          ) : pt.status === "unpaid" ? (
                                            <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-medium">UNPAID</span>
                                          ) : (
                                            <span className="text-text-subtle">-</span>
                                          )
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-center">
                                        {!isFinalized ? (
                                          <input
                                            type="checkbox"
                                            checked={pt.finance || false}
                                            onChange={(e) => {
                                              const updated = [...patients];
                                              updated[i] = {
                                                ...updated[i],
                                                finance: e.target.checked,
                                                flagged: e.target.checked || pt.status !== "paid",
                                                flagReason: e.target.checked && pt.status === "paid" ? "Paid via finance - verify fee deduction" : pt.flagReason,
                                              };
                                              updatePatients(entry.id, updated);
                                            }}
                                            className="w-4 h-4 text-blue-600 rounded"
                                          />
                                        ) : pt.finance ? (
                                          <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">FIN</span>
                                        ) : (
                                          <span className="text-text-subtle">-</span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        {pt.finance && (
                                          <input
                                            type="number"
                                            step="0.01"
                                            placeholder="0"
                                            value={pt.financeFee || ""}
                                            onChange={(e) => {
                                              const updated = [...patients];
                                              updated[i] = { ...updated[i], financeFee: parseFloat(e.target.value) || 0 };
                                              updatePatients(entry.id, updated);
                                            }}
                                            disabled={isFinalized}
                                            className="w-16 bg-white border border-blue-200 rounded px-1 py-0.5 text-[10px] text-right outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-surface-muted"
                                          />
                                        )}
                                      </td>
                                      {!isFinalized && (
                                        <td className="px-1 py-1.5">
                                          <div className="flex items-center gap-1">
                                            {pt.flagged && !pt.resolved && (
                                              <button
                                                onClick={() => {
                                                  const updated = [...patients];
                                                  updated[i] = { ...updated[i], resolved: true, flagged: false };
                                                  updatePatients(entry.id, updated);
                                                }}
                                                title="Mark as resolved"
                                                className="text-green-500 hover:text-green-600 transition"
                                              >
                                                <CheckCircle2 size={12} />
                                              </button>
                                            )}
                                            <button
                                              onClick={() => updatePatients(entry.id, patients.filter((_, j) => j !== i))}
                                              className="text-text-subtle hover:text-danger transition"
                                            >
                                              <Trash2 size={12} />
                                            </button>
                                          </div>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-slate-100">
                                    <td className="px-3 py-2 font-semibold text-xs" colSpan={2}>Total ({patients.length} patients)</td>
                                    <td className="px-3 py-2 text-right font-bold text-xs">{fmt(patients.reduce((s, p) => s + p.amount, 0))}</td>
                                    <td className="px-3 py-2 text-center text-xs">
                                      <span className="text-green-600">{patients.filter(p => p.status === "paid").length} paid</span>
                                      {patients.filter(p => p.status !== "paid" && p.status).length > 0 && (
                                        <span className="text-amber-600 ml-1">{patients.filter(p => p.status !== "paid" && p.status).length} review</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-center text-xs text-blue-600">
                                      {patients.filter(p => p.finance).length > 0 && `${patients.filter(p => p.finance).length} fin`}
                                    </td>
                                    <td className="px-2 py-2 text-right text-xs font-medium text-blue-700">
                                      {patients.some(p => p.financeFee && p.financeFee > 0) && fmt(patients.reduce((s, p) => s + (p.financeFee || 0), 0))}
                                    </td>
                                    {!isFinalized && <td></td>}
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Dentist Private Log Import */}
                      {!isFinalized && (
                        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-xs font-semibold text-text uppercase tracking-wide">Dentist Private Log</h4>
                              <p className="text-xs text-text-muted mt-0.5">Import dentist&apos;s own takings log to cross-reference</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => fetchFromGoogleSheets(entry.id, entry.dentist_name)}
                                disabled={fetchingSheets}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 hover:text-green-800 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition disabled:opacity-50"
                              >
                                {fetchingSheets ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                                Google Sheets
                              </button>
                              <button
                                onClick={() => setShowLogImport(showLogImport === entry.id ? null : entry.id)}
                                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                              >
                                {showLogImport === entry.id ? "Cancel" : "Paste CSV"}
                              </button>
                            </div>
                          </div>
                          {showLogImport === entry.id && (
                            <div className="mt-3 space-y-3">
                              <div>
                                <label className="block text-xs text-text-muted mb-1">
                                  Paste CSV data (Patient Name, Date, Amount, Treatment)
                                </label>
                                <textarea
                                  value={logCsv}
                                  onChange={(e) => setLogCsv(e.target.value)}
                                  rows={5}
                                  placeholder="John Smith, 15/01/2025, 250.00, Crown&#10;Jane Doe, 16/01/2025, 95.00, Filling"
                                  className="w-full px-3 py-2 border border-border rounded-lg text-xs font-mono focus:ring-2 focus:ring-primary-500 outline-none"
                                />
                              </div>
                              <button
                                onClick={() => importDentistLog(entry.id)}
                                disabled={importingLog || !logCsv.trim()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                              >
                                {importingLog ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                Compare with Dentally Data
                              </button>
                            </div>
                          )}
                          {(() => {
                            const dentistLog: DentistLogEntry[] = JSON.parse(entry.dentist_log_json || "[]");
                            if (dentistLog.length === 0) return null;
                            return (
                              <div className="mt-3 pt-3 border-t border-border">
                                <p className="text-xs text-text-muted mb-2">Imported log: {dentistLog.length} entries</p>
                                <div className="max-h-32 overflow-y-auto text-xs space-y-1">
                                  {dentistLog.slice(0, 5).map((l, i) => (
                                    <div key={i} className="flex justify-between text-text-muted">
                                      <span>{l.patientName}</span>
                                      <span>{fmt(l.amount)}</span>
                                    </div>
                                  ))}
                                  {dentistLog.length > 5 && <p className="text-text-subtle">...and {dentistLog.length - 5} more</p>}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Discrepancies / Flagged Items */}
                      {(() => {
                        let discrepancies: Discrepancy[] = JSON.parse(entry.discrepancies_json || "[]");
                        const unresolvedCount = discrepancies.filter(d => !d.resolved).length;
                        if (discrepancies.length === 0) return null;
                        return (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <AlertCircle size={16} className="text-amber-600" />
                                <h4 className="text-sm font-semibold text-amber-800">
                                  Items for Review ({unresolvedCount} unresolved / {discrepancies.length} total)
                                </h4>
                              </div>
                              {!isFinalized && unresolvedCount > 0 && (
                                <button
                                  onClick={() => {
                                    const updated = discrepancies.map(d => ({ ...d, resolved: true }));
                                    updateEntry(entry.id, { discrepancies_json: JSON.stringify(updated) });
                                  }}
                                  className="text-xs text-green-600 hover:text-green-700 font-medium"
                                >
                                  Resolve All
                                </button>
                              )}
                            </div>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {discrepancies.filter(d => !d.resolved).map((d, i) => (
                                <div key={i} className="bg-white rounded p-2 text-xs">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">{d.patientName}</span>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                        d.type === "invoiced_not_paid" ? "bg-red-100 text-red-700" :
                                        d.type === "partial_payment" ? "bg-amber-100 text-amber-700" :
                                        d.type === "in_log_not_system" ? "bg-purple-100 text-purple-700" :
                                        d.type === "in_system_not_log" ? "bg-blue-100 text-blue-700" :
                                        "bg-slate-100 text-slate-700"
                                      }`}>
                                        {d.type === "invoiced_not_paid" ? "NOT PAID" :
                                         d.type === "partial_payment" ? "PARTIAL" :
                                         d.type === "in_log_not_system" ? "IN LOG ONLY" :
                                         d.type === "in_system_not_log" ? "IN SYSTEM ONLY" :
                                         "MISMATCH"}
                                      </span>
                                      {!isFinalized && (
                                        <button
                                          onClick={() => {
                                            const updated = discrepancies.map((disc, j) =>
                                              discrepancies.filter(x => !x.resolved).indexOf(disc) === i
                                                ? { ...disc, resolved: true }
                                                : disc
                                            );
                                            updateEntry(entry.id, { discrepancies_json: JSON.stringify(updated) });
                                          }}
                                          className="text-green-500 hover:text-green-600"
                                          title="Mark as resolved"
                                        >
                                          <CheckCircle2 size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-text-muted mt-1">
                                    {d.date}
                                    {d.invoicedAmount > 0 && ` - System: ${fmt(d.invoicedAmount)}`}
                                    {d.paidAmount > 0 && d.paidAmount !== d.invoicedAmount && `, Paid: ${fmt(d.paidAmount)}`}
                                  </p>
                                  <p className="text-amber-700 mt-0.5">{d.notes}</p>
                                </div>
                              ))}
                              {discrepancies.some(d => d.resolved) && (
                                <details className="mt-2">
                                  <summary className="text-xs text-text-muted cursor-pointer hover:text-text">
                                    {discrepancies.filter(d => d.resolved).length} resolved items
                                  </summary>
                                  <div className="mt-2 space-y-1 opacity-60">
                                    {discrepancies.filter(d => d.resolved).map((d, i) => (
                                      <div key={i} className="bg-green-50 rounded p-2 text-xs flex items-center justify-between">
                                        <span>{d.patientName} - {fmt(d.invoicedAmount)}</span>
                                        <span className="text-green-600 text-[10px]">RESOLVED</span>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          </div>
                        );
                      })()}

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
