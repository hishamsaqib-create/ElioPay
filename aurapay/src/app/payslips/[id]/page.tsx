"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import {
  Download, Mail, ChevronDown, ChevronUp, Save, CheckCircle2,
  Plus, Trash2, Lock, Unlock, AlertCircle, Loader2, Undo2, FileSpreadsheet, FileText, X, Upload, ExternalLink
} from "lucide-react";

interface LabBill { lab_name: string; amount: number; description?: string; file_url?: string; uploaded_at?: string; }
interface Adjustment { description: string; amount: number; type: "addition" | "deduction"; }
interface PrivatePatient {
  name: string; date: string; amount: number; finance: boolean;
  amountPaid?: number; amountOutstanding?: number;
  status?: "paid" | "partial" | "unpaid";
  flagged?: boolean; flagReason?: string;
  financeFee?: number; invoiceId?: string; patientId?: string;
  resolved?: boolean; resolvedNote?: string;
  durationMins?: number; treatment?: string; hourlyRate?: number;
}

interface Analytics {
  totalChairMins: number;
  totalPatients: number;
  grossPerHour: number;
  netPerHour: number;
  avgAppointmentMins: number;
  utilizationPercent: number;
  topPatientsByHourlyRate: Array<{ name: string; amount: number; durationMins: number; hourlyRate: number }>;
  topTreatmentsByHourlyRate: Array<{ treatment: string; totalAmount: number; totalMins: number; hourlyRate: number; count: number }>;
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

interface TherapyBreakdownItem {
  patientName: string;
  patientId: string;
  date: string;
  minutes: number;
  treatment?: string;
  therapistName?: string;
  cost: number;
}

interface Entry {
  id: number; period_id: number; dentist_id: number;
  gross_private: number; nhs_udas: number; lab_bills_json: string;
  finance_fees: number; therapy_minutes: number; therapy_rate: number;
  adjustments_json: string; notes: string; private_patients_json: string;
  discrepancies_json?: string; dentist_log_json?: string; analytics_json?: string;
  therapy_breakdown_json?: string;
  calculation: Calculation; dentist: Dentist;
  dentist_name: string; dentist_email: string | null;
}

interface Period {
  id: number; month: number; year: number; status: string;
  nhs_period_start?: string | null;
  nhs_period_end?: string | null;
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
  const [nhsPeriodStart, setNhsPeriodStart] = useState("");
  const [nhsPeriodEnd, setNhsPeriodEnd] = useState("");
  const [processingNhs, setProcessingNhs] = useState(false);
  const [nhsPdfFile, setNhsPdfFile] = useState<File | null>(null);
  const [nhsResult, setNhsResult] = useState<{ extractions?: Array<{ dentistName: string; udas: number; nhsIncome: number }>; extractedText?: string; period?: { start: string | null; end: string | null } } | null>(null);

  // Split settings from API (used for client-side recalculation)
  const [splitSettings, setSplitSettings] = useState<{ labBillSplit: number; financeFeeSplit: number }>({ labBillSplit: 0.5, financeFeeSplit: 0.5 });

  // Client-side recalculation (mirrors server-side calculatePayslip)
  function recalculate(entry: Entry): Calculation {
    const labBills: LabBill[] = JSON.parse(entry.lab_bills_json || "[]");
    const adjustments: Adjustment[] = JSON.parse(entry.adjustments_json || "[]");

    const splitPercentage = Math.max(0, Math.min(100, entry.dentist.split_percentage));
    const grossPrivate = Math.max(0, entry.gross_private);
    const netPrivate = Math.round(grossPrivate * (splitPercentage / 100) * 100) / 100;

    const nhsUdas = Math.max(0, entry.nhs_udas);
    const udaRate = Math.max(0, entry.dentist.uda_rate);
    const nhsIncome = entry.dentist.is_nhs ? Math.round(nhsUdas * udaRate * 100) / 100 : 0;

    const validLabBills = labBills.filter(b => b.amount > 0);
    const labBillsTotal = Math.round(validLabBills.reduce((s, b) => s + b.amount, 0) * 100) / 100;
    const labBillsDeduction = Math.round(labBillsTotal * splitSettings.labBillSplit * 100) / 100;

    const financeFees = Math.max(0, entry.finance_fees);
    const financeFeesDeduction = Math.round(financeFees * splitSettings.financeFeeSplit * 100) / 100;

    const therapyMinutes = Math.max(0, entry.therapy_minutes);
    const therapyRate = entry.therapy_rate > 0 ? entry.therapy_rate : 0.5833;
    const therapyDeduction = Math.round(therapyMinutes * therapyRate * 100) / 100;

    let adjustmentsTotal = 0;
    for (const adj of adjustments) {
      if (typeof adj.amount !== "number" || adj.amount < 0) continue;
      adjustmentsTotal += adj.type === "addition" ? adj.amount : -adj.amount;
    }
    adjustmentsTotal = Math.round(adjustmentsTotal * 100) / 100;

    const totalEarnings = Math.round((netPrivate + nhsIncome) * 100) / 100;
    const totalDeductions = Math.round((labBillsDeduction + financeFeesDeduction + therapyDeduction) * 100) / 100;
    const netPay = Math.round((totalEarnings - totalDeductions + adjustmentsTotal) * 100) / 100;

    return {
      grossPrivate, splitPercentage, netPrivate,
      nhsUdas, udaRate, nhsIncome,
      labBills: validLabBills, labBillsTotal, labBillsDeduction,
      financeFees, financeFeesDeduction,
      therapyMinutes, therapyRate, therapyDeduction,
      adjustments, adjustmentsTotal,
      totalDeductions, totalEarnings, netPay,
    };
  }

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
    if (entriesData.settings) {
      setSplitSettings(entriesData.settings);
    }
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
    const discrepancies: Discrepancy[] = JSON.parse(entry.discrepancies_json || "[]");
    const dentistLog: DentistLogEntry[] = JSON.parse(entry.dentist_log_json || "[]");

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
        discrepancies: discrepancies,
        dentist_log: dentistLog,
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
    const totalFinanceFees = Math.round(patients.reduce((s, p) => s + (p.financeFee || 0), 0) * 100) / 100;
    updateEntry(entryId, {
      private_patients_json: JSON.stringify(patients),
      finance_fees: totalFinanceFees,
    });
  }

  async function downloadPdf(entryId: number) {
    try {
      const res = await fetch(`/api/payslips/generate-pdf?entry_id=${entryId}`);
      if (!res.ok) {
        const contentType = res.headers.get("Content-Type");
        if (contentType?.includes("application/json")) {
          const errData = await res.json();
          showToast(errData.details || errData.error || "PDF generation failed", "error");
        } else {
          showToast("PDF generation failed", "error");
        }
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "payslip.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(`PDF error: ${e instanceof Error ? e.message : "Unknown error"}`, "error");
    }
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
    setNhsResult(null);
    try {
      const formData = new FormData();
      formData.append("period_id", periodId);
      if (nhsPdfFile) {
        formData.append("pdf_file", nhsPdfFile);
      }
      if (nhsText.trim()) {
        formData.append("statement_text", nhsText);
      }
      if (Object.keys(nhsManual).length > 0) {
        formData.append("manual_udas", JSON.stringify(nhsManual));
      }
      if (nhsPeriodStart) {
        formData.append("nhs_period_start", nhsPeriodStart);
      }
      if (nhsPeriodEnd) {
        formData.append("nhs_period_end", nhsPeriodEnd);
      }

      const res = await fetch("/api/nhs-statement", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "NHS UDAs updated");
        setNhsResult(data);
        // Auto-fill period dates if extracted from PDF
        if (data.period?.start) setNhsPeriodStart(data.period.start);
        if (data.period?.end) setNhsPeriodEnd(data.period.end);
        setNhsPdfFile(null);
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

  const totalNetPay = entries.reduce((s, e) => s + recalculate(e).netPay, 0);
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
                  <p className="text-xs text-blue-600">Upload PDF or enter NHS UDAs for {nhsDentists.map(e => e.dentist_name).join(", ")}</p>
                </div>
              </div>
              <button
                onClick={() => setShowNhsUpload(!showNhsUpload)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 hover:text-blue-800 bg-blue-100 hover:bg-blue-200 rounded-lg transition"
              >
                {showNhsUpload ? <X size={14} /> : <Plus size={14} />}
                {showNhsUpload ? "Close" : "Upload Statement"}
              </button>
            </div>

            {showNhsUpload && (
              <div className="mt-4 pt-4 border-t border-blue-200 space-y-4">
                {/* PDF Upload */}
                <div>
                  <label className="block text-xs font-medium text-blue-800 mb-2">Upload NHS Statement PDF</label>
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer">
                      <div className={`flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed rounded-lg transition ${
                        nhsPdfFile ? "border-green-400 bg-green-50" : "border-blue-300 hover:border-blue-400 hover:bg-blue-100"
                      }`}>
                        {nhsPdfFile ? (
                          <>
                            <CheckCircle2 size={20} className="text-green-600" />
                            <span className="text-sm font-medium text-green-700">{nhsPdfFile.name}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); setNhsPdfFile(null); }}
                              className="ml-2 text-red-500 hover:text-red-600"
                            >
                              <X size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <Download size={20} className="text-blue-500" />
                            <span className="text-sm text-blue-700">Click to select NHS Statement PDF</span>
                          </>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setNhsPdfFile(file);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-blue-600 mt-1">Upload your NHS FP17 statement PDF to auto-extract UDAs and period dates</p>
                </div>

                {/* NHS Period Dates */}
                <div>
                  <label className="block text-xs font-medium text-blue-800 mb-2">NHS Period Dates {nhsPdfFile && <span className="text-green-600 font-normal">(will auto-fill from PDF)</span>}</label>
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-[10px] text-text-muted mb-1">Period Start</label>
                      <input
                        type="date"
                        value={nhsPeriodStart}
                        onChange={(e) => setNhsPeriodStart(e.target.value)}
                        className="px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <span className="text-text-muted mt-4">to</span>
                    <div>
                      <label className="block text-[10px] text-text-muted mb-1">Period End</label>
                      <input
                        type="date"
                        value={nhsPeriodEnd}
                        onChange={(e) => setNhsPeriodEnd(e.target.value)}
                        className="px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-blue-600 mt-1">NHS periods often differ from private periods (e.g., 1st-31st vs 15th-14th)</p>
                </div>

                {/* Manual UDA Entry */}
                <div>
                  <label className="block text-xs font-medium text-blue-800 mb-2">Or Enter UDAs Manually</label>
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
                <details className="text-xs">
                  <summary className="text-blue-700 cursor-pointer hover:text-blue-800 font-medium">Or paste statement text...</summary>
                  <div className="mt-2">
                    <textarea
                      value={nhsText}
                      onChange={(e) => setNhsText(e.target.value)}
                      rows={4}
                      placeholder="Paste the text content from your NHS statement here..."
                      className="w-full px-3 py-2 border border-border rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </details>

                {/* Results */}
                {nhsResult && nhsResult.extractions && nhsResult.extractions.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <h4 className="text-xs font-semibold text-green-800 mb-2">Extracted from PDF:</h4>
                    <div className="space-y-1">
                      {nhsResult.extractions.map((e, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-green-700">{e.dentistName}</span>
                          <span className="font-medium text-green-800">{e.udas} UDAs = £{e.nhsIncome.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    {nhsResult.period?.start && nhsResult.period?.end && (
                      <p className="text-[10px] text-green-600 mt-2">
                        Period: {nhsResult.period.start} to {nhsResult.period.end}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={submitNhsStatement}
                    disabled={processingNhs || (!nhsPdfFile && Object.keys(nhsManual).length === 0 && !nhsText.trim())}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                  >
                    {processingNhs ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {nhsPdfFile ? "Process PDF & Update UDAs" : "Update NHS UDAs"}
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
              <p className="text-sm font-semibold">{fmt(entries.reduce((s, e) => s + recalculate(e).grossPrivate, 0))}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Total NHS</p>
              <p className="text-sm font-semibold">{fmt(entries.reduce((s, e) => s + recalculate(e).nhsIncome, 0))}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Total Deductions</p>
              <p className="text-sm font-semibold text-red-400">{fmt(entries.reduce((s, e) => s + recalculate(e).totalDeductions, 0))}</p>
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
            const c = recalculate(entry);

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
                    {/* NHS Period Banner */}
                    {entry.dentist.is_nhs && period.nhs_period_start && period.nhs_period_end && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center gap-3">
                        <FileText size={16} className="text-blue-500" />
                        <div>
                          <span className="text-xs font-medium text-blue-800">NHS Period: </span>
                          <span className="text-xs text-blue-700">
                            {new Date(period.nhs_period_start + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            {" - "}
                            {new Date(period.nhs_period_end + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <span className="text-[10px] text-blue-500 ml-2">({c.nhsUdas} UDAs @ £{c.udaRate}/UDA)</span>
                        </div>
                      </div>
                    )}

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

                    {/* Deductions Breakdown */}
                    {(c.totalDeductions > 0 || c.therapyMinutes > 0) && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                        <h4 className="text-xs font-semibold text-red-800 uppercase tracking-wide">Deductions Breakdown</h4>
                        <div className="space-y-1.5 text-xs">
                          {c.labBillsDeduction > 0 && (
                            <div className="flex justify-between text-red-700">
                              <span>Lab Bills ({fmt(c.labBillsTotal)} total, dentist pays {Math.round(splitSettings.labBillSplit * 100)}%)</span>
                              <span className="font-medium">-{fmt(c.labBillsDeduction)}</span>
                            </div>
                          )}
                          {c.financeFeesDeduction > 0 && (
                            <div className="flex justify-between text-red-700">
                              <span>Finance Fees ({fmt(c.financeFees)} total, {Math.round(splitSettings.financeFeeSplit * 100)}% split)</span>
                              <span className="font-medium">-{fmt(c.financeFeesDeduction)}</span>
                            </div>
                          )}
                          {c.therapyDeduction > 0 && (
                            <div className="flex justify-between text-red-700">
                              <span>Therapy ({c.therapyMinutes} mins x {fmt(c.therapyRate)}/min)</span>
                              <span className="font-medium">-{fmt(c.therapyDeduction)}</span>
                            </div>
                          )}
                          {c.therapyMinutes > 0 && c.therapyDeduction === 0 && (
                            <div className="flex justify-between text-amber-600">
                              <span>Therapy ({c.therapyMinutes} mins) - rate not set</span>
                              <span className="font-medium">£0.00</span>
                            </div>
                          )}
                          <div className="flex justify-between text-red-900 font-bold pt-1.5 border-t border-red-200">
                            <span>Total Deductions</span>
                            <span>-{fmt(c.totalDeductions)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Performance Analytics */}
                    {(() => {
                      const analytics: Analytics | null = entry.analytics_json ? JSON.parse(entry.analytics_json) : null;
                      if (!analytics || analytics.totalChairMins === 0) return null;

                      const totalHours = analytics.totalChairMins / 60;
                      const patientsWithDuration = patients.filter(p => p.durationMins && p.durationMins > 0);

                      return (
                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4 space-y-4">
                          <h4 className="text-sm font-bold text-indigo-800 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            Performance Analytics
                          </h4>

                          {/* Key Metrics */}
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <div className="bg-white/70 rounded-lg p-3 text-center">
                              <p className="text-[10px] text-indigo-600 font-medium uppercase">Chair Time</p>
                              <p className="text-lg font-bold text-indigo-900">{totalHours.toFixed(1)}h</p>
                              <p className="text-[10px] text-text-muted">{analytics.totalChairMins} mins</p>
                            </div>
                            <div className="bg-white/70 rounded-lg p-3 text-center">
                              <p className="text-[10px] text-indigo-600 font-medium uppercase">Utilization</p>
                              <p className="text-lg font-bold text-indigo-900">{analytics.utilizationPercent}%</p>
                              <p className="text-[10px] text-text-muted">of available</p>
                            </div>
                            <div className="bg-white/70 rounded-lg p-3 text-center">
                              <p className="text-[10px] text-green-600 font-medium uppercase">Gross £/Hour</p>
                              <p className="text-lg font-bold text-green-700">{fmt(analytics.grossPerHour)}</p>
                              <p className="text-[10px] text-text-muted">per hour</p>
                            </div>
                            <div className="bg-white/70 rounded-lg p-3 text-center">
                              <p className="text-[10px] text-emerald-600 font-medium uppercase">Net £/Hour</p>
                              <p className="text-lg font-bold text-emerald-700">{fmt(analytics.netPerHour)}</p>
                              <p className="text-[10px] text-text-muted">{c.splitPercentage}% split</p>
                            </div>
                            <div className="bg-white/70 rounded-lg p-3 text-center">
                              <p className="text-[10px] text-indigo-600 font-medium uppercase">Avg Appt</p>
                              <p className="text-lg font-bold text-indigo-900">{analytics.avgAppointmentMins}m</p>
                              <p className="text-[10px] text-text-muted">{patientsWithDuration.length} appts</p>
                            </div>
                          </div>

                          {/* Top Performers */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Top Patients by £/hour */}
                            {analytics.topPatientsByHourlyRate.length > 0 && (
                              <div className="bg-white/60 rounded-lg p-3">
                                <h5 className="text-xs font-semibold text-indigo-700 mb-2 flex items-center gap-1">
                                  <span className="text-yellow-500">★</span> Top Patients by £/hour
                                </h5>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                  {analytics.topPatientsByHourlyRate.slice(0, 5).map((p, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                      <span className="text-text truncate max-w-[120px]">{p.name}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-text-muted">{p.durationMins}m</span>
                                        <span className="font-semibold text-green-700">{fmt(p.hourlyRate)}/h</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Top Treatments by £/hour */}
                            {analytics.topTreatmentsByHourlyRate.length > 0 && (
                              <div className="bg-white/60 rounded-lg p-3">
                                <h5 className="text-xs font-semibold text-indigo-700 mb-2 flex items-center gap-1">
                                  <span className="text-yellow-500">★</span> Top Treatments by £/hour
                                </h5>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                  {analytics.topTreatmentsByHourlyRate.slice(0, 5).map((t, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                      <span className="text-text truncate max-w-[120px] capitalize">{t.treatment}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-text-muted">×{t.count}</span>
                                        <span className="font-semibold text-green-700">{fmt(t.hourlyRate)}/h</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

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

                      {/* Therapy Breakdown */}
                      {(() => {
                        const therapyBreakdown: TherapyBreakdownItem[] = JSON.parse(entry.therapy_breakdown_json || "[]");
                        if (therapyBreakdown.length === 0) return null;
                        const totalMins = therapyBreakdown.reduce((sum, t) => sum + t.minutes, 0);
                        const totalCost = therapyBreakdown.reduce((sum, t) => sum + t.cost, 0);
                        return (
                          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-semibold text-purple-800 flex items-center gap-2">
                                🦷 Therapy Referrals Breakdown
                                <span className="text-purple-600 font-normal">({therapyBreakdown.length} appointments)</span>
                              </h4>
                              <span className="text-xs font-bold text-purple-700">
                                {totalMins} mins = {fmt(totalCost)}
                              </span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-purple-600">
                                    <th className="py-1 pr-3">Patient</th>
                                    <th className="py-1 pr-3">Date</th>
                                    <th className="py-1 pr-3">Therapist</th>
                                    <th className="py-1 pr-3 text-right">Mins</th>
                                    <th className="py-1 text-right">Cost</th>
                                  </tr>
                                </thead>
                                <tbody className="text-purple-800">
                                  {therapyBreakdown.map((t, i) => (
                                    <tr key={i} className="border-t border-purple-100">
                                      <td className="py-1.5 pr-3 font-medium">{t.patientName}</td>
                                      <td className="py-1.5 pr-3 text-purple-600">
                                        {new Date(t.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                      </td>
                                      <td className="py-1.5 pr-3 text-purple-600">{t.therapistName || "Therapist"}</td>
                                      <td className="py-1.5 pr-3 text-right">{t.minutes}</td>
                                      <td className="py-1.5 text-right font-medium">{fmt(t.cost)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-purple-300 font-bold text-purple-900">
                                    <td colSpan={3} className="py-1.5">Total</td>
                                    <td className="py-1.5 text-right">{totalMins}</td>
                                    <td className="py-1.5 text-right">{fmt(totalCost)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

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
                          <div className="space-y-3">
                            {labBills.map((lb, i) => (
                              <div key={i} className="p-2 bg-surface-muted rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <input
                                    placeholder="Lab name"
                                    value={lb.lab_name}
                                    onChange={(e) => {
                                      const updated = [...labBills];
                                      updated[i] = { ...updated[i], lab_name: e.target.value };
                                      updateLabBills(entry.id, updated);
                                    }}
                                    disabled={isFinalized}
                                    className="flex-1 px-3 py-1.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted bg-white"
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
                                      className="w-full pl-6 pr-2 py-1.5 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none disabled:bg-surface-muted bg-white"
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
                                {/* File upload/view row */}
                                <div className="flex items-center gap-2 text-xs">
                                  {lb.file_url ? (
                                    <a
                                      href={lb.file_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-primary-600 hover:text-primary-700"
                                    >
                                      <ExternalLink size={12} /> View bill
                                    </a>
                                  ) : !isFinalized && lb.lab_name && lb.amount > 0 ? (
                                    <label className="flex items-center gap-1 text-text-muted hover:text-primary-600 cursor-pointer">
                                      <Upload size={12} />
                                      <span>Upload bill</span>
                                      <input
                                        type="file"
                                        accept=".pdf,image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          const formData = new FormData();
                                          formData.append("file", file);
                                          formData.append("entry_id", String(entry.id));
                                          formData.append("lab_name", lb.lab_name);
                                          formData.append("amount", String(lb.amount));
                                          formData.append("description", lb.description || "");
                                          try {
                                            const res = await fetch("/api/lab-bills/upload", {
                                              method: "POST",
                                              body: formData,
                                            });
                                            const data = await res.json();
                                            if (res.ok) {
                                              const updated = [...labBills];
                                              updated[i] = { ...updated[i], file_url: data.lab_bill.file_url };
                                              updateLabBills(entry.id, updated);
                                              showToast("Lab bill uploaded");
                                            } else {
                                              showToast(data.error || "Upload failed", "error");
                                            }
                                          } catch {
                                            showToast("Upload failed", "error");
                                          }
                                          e.target.value = "";
                                        }}
                                      />
                                    </label>
                                  ) : (
                                    <span className="text-text-subtle">Enter lab name and amount to upload</span>
                                  )}
                                </div>
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
                            <div className="bg-surface-dim rounded-lg overflow-hidden overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="text-left px-3 py-2 font-medium text-text-muted">Patient</th>
                                    <th className="text-left px-3 py-2 font-medium text-text-muted">Date</th>
                                    <th className="text-right px-3 py-2 font-medium text-text-muted">Amount</th>
                                    <th className="text-center px-2 py-2 font-medium text-text-muted">Mins</th>
                                    <th className="text-right px-2 py-2 font-medium text-text-muted">£/hr</th>
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
                                      <td className="px-2 py-1.5 text-center text-text-muted">
                                        {pt.durationMins ? `${pt.durationMins}` : "-"}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        {pt.hourlyRate ? (
                                          <span className={`font-medium ${pt.hourlyRate >= 300 ? "text-green-600" : pt.hourlyRate >= 200 ? "text-blue-600" : "text-text-muted"}`}>
                                            £{pt.hourlyRate.toFixed(0)}
                                          </span>
                                        ) : "-"}
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
                                    <td className="px-2 py-2 text-center text-xs text-text-muted">
                                      {patients.filter(p => p.durationMins).reduce((s, p) => s + (p.durationMins || 0), 0)}m
                                    </td>
                                    <td className="px-2 py-2 text-right text-xs text-green-600 font-medium">
                                      {(() => {
                                        const totalMins = patients.filter(p => p.durationMins).reduce((s, p) => s + (p.durationMins || 0), 0);
                                        const totalAmt = patients.reduce((s, p) => s + p.amount, 0);
                                        return totalMins > 0 ? `£${Math.round(totalAmt / (totalMins / 60))}` : "-";
                                      })()}
                                    </td>
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

                        // Function to add a discrepancy to the patient breakdown
                        const addToBreakdown = (d: Discrepancy, discIdx: number) => {
                          // Get the amount - for in_log_not_system, use logAmount; otherwise use invoicedAmount
                          const amount = (d as Discrepancy & { logAmount?: number }).logAmount || d.invoicedAmount || 0;
                          if (amount <= 0) return;

                          // Add to patients list
                          const newPatient: PrivatePatient = {
                            name: d.patientName,
                            date: d.date,
                            amount: amount,
                            finance: false,
                            amountPaid: amount,
                            amountOutstanding: 0,
                            status: "paid",
                            flagged: false,
                            resolved: true,
                            resolvedNote: `Added from ${d.type === "in_log_not_system" ? "dentist log" : "discrepancy review"}`,
                          };
                          const updatedPatients = [...patients, newPatient];

                          // Mark discrepancy as resolved
                          const updatedDiscrepancies = discrepancies.map((disc, j) =>
                            j === discIdx ? { ...disc, resolved: true } : disc
                          );

                          // Update entry with both changes
                          updateEntry(entry.id, {
                            private_patients_json: JSON.stringify(updatedPatients),
                            discrepancies_json: JSON.stringify(updatedDiscrepancies),
                            gross_private: entry.gross_private + amount, // Also add to gross total
                          });
                          showToast(`Added ${d.patientName} (${fmt(amount)}) to breakdown`);
                        };

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
                              {discrepancies.map((d, discIdx) => {
                                if (d.resolved) return null;
                                const logAmount = (d as Discrepancy & { logAmount?: number }).logAmount;
                                return (
                                <div key={discIdx} className="bg-white rounded p-2 text-xs">
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
                                      {!isFinalized && d.type === "in_log_not_system" && logAmount && logAmount > 0 && (
                                        <button
                                          onClick={() => addToBreakdown(d, discIdx)}
                                          className="px-1.5 py-0.5 bg-green-100 hover:bg-green-200 text-green-700 rounded text-[10px] font-medium"
                                          title="Add this payment to the breakdown total"
                                        >
                                          + Add {fmt(logAmount)}
                                        </button>
                                      )}
                                      {!isFinalized && (
                                        <button
                                          onClick={() => {
                                            const updated = discrepancies.map((disc, j) =>
                                              j === discIdx ? { ...disc, resolved: true } : disc
                                            );
                                            updateEntry(entry.id, { discrepancies_json: JSON.stringify(updated) });
                                          }}
                                          className="text-green-500 hover:text-green-600"
                                          title="Mark as resolved (dismiss)"
                                        >
                                          <CheckCircle2 size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-text-muted mt-1">
                                    {d.date}
                                    {logAmount && logAmount > 0 && ` - Log: ${fmt(logAmount)}`}
                                    {d.invoicedAmount > 0 && ` - System: ${fmt(d.invoicedAmount)}`}
                                    {d.paidAmount > 0 && d.paidAmount !== d.invoicedAmount && `, Paid: ${fmt(d.paidAmount)}`}
                                  </p>
                                  <p className="text-amber-700 mt-0.5">{d.notes}</p>
                                </div>
                              );})}
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
