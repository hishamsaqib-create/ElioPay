"use client";
import { useEffect, useState, useRef } from "react";
import Shell from "@/components/Shell";
import {
  Plus, Trash2, Upload, Eye, X, Check, ChevronDown, Loader2, Search, Filter
} from "lucide-react";

interface Dentist { id: number; name: string; }
interface SavedLab { id: number; name: string; }
interface LabBill {
  id: number; lab_name: string; dentist_id: number | null; dentist_name: string | null;
  amount: number; description: string; file_url: string | null; date: string;
  month: number; year: number; paid: number; paid_date: string | null;
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" });

export default function LabBillsPage() {
  const [bills, setBills] = useState<LabBill[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [savedLabs, setSavedLabs] = useState<SavedLab[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddRow, setShowAddRow] = useState(false);
  const [newBill, setNewBill] = useState({ lab_name: "", dentist_id: "", amount: "", description: "", date: new Date().toISOString().substring(0, 10) });
  const [uploading, setUploading] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showNewLab, setShowNewLab] = useState(false);
  const [newLabName, setNewLabName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newFileInputRef = useRef<HTMLInputElement>(null);
  const [newFile, setNewFile] = useState<File | null>(null);

  useEffect(() => { load(); }, [filterYear, filterMonth]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ year: String(filterYear) });
    if (filterMonth) params.set("month", String(filterMonth));

    const [billsRes, dentistsRes, entitiesRes] = await Promise.all([
      fetch(`/api/bills/lab?${params}`),
      fetch("/api/dentists"),
      fetch("/api/bills/saved-entities"),
    ]);

    if (billsRes.ok) { const d = await billsRes.json(); setBills(d.bills || []); }
    if (dentistsRes.ok) { const d = await dentistsRes.json(); setDentists(d.dentists || []); }
    if (entitiesRes.ok) { const d = await entitiesRes.json(); setSavedLabs(d.labs || []); }
    setLoading(false);
  }

  async function addBill() {
    if (!newBill.lab_name || !newBill.amount || !newBill.date) return;

    let fileUrl: string | null = null;
    if (newFile) {
      const formData = new FormData();
      formData.append("file", newFile);
      formData.append("type", "lab");
      formData.append("entity_name", newBill.lab_name);
      const uploadRes = await fetch("/api/bills/upload", { method: "POST", body: formData });
      if (uploadRes.ok) {
        const data = await uploadRes.json();
        fileUrl = data.file_url;
      }
    }

    const res = await fetch("/api/bills/lab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newBill,
        amount: parseFloat(newBill.amount),
        dentist_id: newBill.dentist_id ? parseInt(newBill.dentist_id) : null,
        file_url: fileUrl,
      }),
    });
    if (res.ok) {
      setNewBill({ lab_name: "", dentist_id: "", amount: "", description: "", date: new Date().toISOString().substring(0, 10) });
      setNewFile(null);
      setShowAddRow(false);
      load();
    }
  }

  async function updateBill(id: number, updates: Record<string, unknown>) {
    await fetch("/api/bills/lab", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    load();
  }

  async function deleteBill(id: number) {
    if (!confirm("Delete this lab bill?")) return;
    await fetch(`/api/bills/lab?id=${id}`, { method: "DELETE" });
    load();
  }

  async function uploadFile(billId: number, file: File, labName: string) {
    setUploading(billId);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", "lab");
    formData.append("entity_name", labName);
    const res = await fetch("/api/bills/upload", { method: "POST", body: formData });
    if (res.ok) {
      const data = await res.json();
      await updateBill(billId, { file_url: data.file_url });
    }
    setUploading(null);
  }

  async function addNewLab() {
    if (!newLabName.trim()) return;
    const res = await fetch("/api/bills/saved-entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "lab", name: newLabName.trim() }),
    });
    if (res.ok) {
      setSavedLabs([...savedLabs, { id: 0, name: newLabName.trim() }]);
      setNewBill({ ...newBill, lab_name: newLabName.trim() });
      setNewLabName("");
      setShowNewLab(false);
      load();
    }
  }

  const filtered = bills.filter(b =>
    (!searchTerm || b.lab_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.dentist_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalAmount = filtered.reduce((s, b) => s + b.amount, 0);
  const paidAmount = filtered.filter(b => b.paid).reduce((s, b) => s + b.amount, 0);
  const unpaidAmount = totalAmount - paidAmount;

  return (
    <Shell>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Lab Bills</h1>
            <p className="text-sm text-text-muted mt-1">Track and manage dental lab bills</p>
          </div>
          <button onClick={() => setShowAddRow(true)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">
            <Plus size={16} /> Add Lab Bill
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-border p-4">
            <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold text-text mt-1">{fmt(totalAmount)}</p>
            <p className="text-xs text-text-subtle mt-1">{filtered.length} bills</p>
          </div>
          <div className="bg-white rounded-xl border border-border p-4">
            <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Paid</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{fmt(paidAmount)}</p>
            <p className="text-xs text-text-subtle mt-1">{filtered.filter(b => b.paid).length} bills</p>
          </div>
          <div className="bg-white rounded-xl border border-border p-4">
            <p className="text-xs text-red-600 font-medium uppercase tracking-wide">Unpaid</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{fmt(unpaidAmount)}</p>
            <p className="text-xs text-text-subtle mt-1">{filtered.filter(b => !b.paid).length} bills</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-text-muted" />
              <select value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white">
                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={filterMonth || ""} onChange={e => setFilterMonth(e.target.value ? parseInt(e.target.value) : null)}
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white">
                <option value="">All Months</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input type="text" placeholder="Search labs, dentists, descriptions..." value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg bg-white" />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-dim">
                    <th className="text-left px-4 py-3 font-medium text-text-muted">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-text-muted">Lab</th>
                    <th className="text-left px-4 py-3 font-medium text-text-muted">Dentist</th>
                    <th className="text-left px-4 py-3 font-medium text-text-muted">Description</th>
                    <th className="text-right px-4 py-3 font-medium text-text-muted">Amount</th>
                    <th className="text-center px-4 py-3 font-medium text-text-muted">Invoice</th>
                    <th className="text-center px-4 py-3 font-medium text-text-muted">Paid</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {showAddRow && (
                    <tr className="border-b border-border bg-primary-50">
                      <td className="px-4 py-2">
                        <input type="date" value={newBill.date} onChange={e => setNewBill({ ...newBill, date: e.target.value })}
                          className="text-sm border border-border rounded px-2 py-1 w-full bg-white" />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <select value={newBill.lab_name} onChange={e => setNewBill({ ...newBill, lab_name: e.target.value })}
                            className="text-sm border border-border rounded px-2 py-1 bg-white flex-1">
                            <option value="">Select lab...</option>
                            {savedLabs.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                          </select>
                          <button onClick={() => setShowNewLab(true)} className="text-primary-600 hover:text-primary-700 shrink-0" title="Add new lab">
                            <Plus size={16} />
                          </button>
                        </div>
                        {showNewLab && (
                          <div className="flex items-center gap-1 mt-1">
                            <input type="text" placeholder="New lab name" value={newLabName} onChange={e => setNewLabName(e.target.value)}
                              className="text-xs border border-border rounded px-2 py-1 flex-1 bg-white" />
                            <button onClick={addNewLab} className="text-green-600 hover:text-green-700"><Check size={14} /></button>
                            <button onClick={() => { setShowNewLab(false); setNewLabName(""); }} className="text-text-muted hover:text-text"><X size={14} /></button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <select value={newBill.dentist_id} onChange={e => setNewBill({ ...newBill, dentist_id: e.target.value })}
                          className="text-sm border border-border rounded px-2 py-1 bg-white w-full">
                          <option value="">Select dentist...</option>
                          {dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input type="text" placeholder="Description" value={newBill.description}
                          onChange={e => setNewBill({ ...newBill, description: e.target.value })}
                          className="text-sm border border-border rounded px-2 py-1 w-full bg-white" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" placeholder="0.00" value={newBill.amount}
                          onChange={e => setNewBill({ ...newBill, amount: e.target.value })}
                          className="text-sm border border-border rounded px-2 py-1 w-24 text-right bg-white" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <label className="cursor-pointer inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                          <Upload size={14} />
                          {newFile ? newFile.name.substring(0, 15) + "..." : "Upload"}
                          <input ref={newFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                            onChange={e => { if (e.target.files?.[0]) setNewFile(e.target.files[0]); }} />
                        </label>
                      </td>
                      <td className="px-4 py-2 text-center">-</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={addBill} className="text-green-600 hover:text-green-700"><Check size={16} /></button>
                          <button onClick={() => { setShowAddRow(false); setNewFile(null); }} className="text-text-muted hover:text-text"><X size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filtered.length === 0 && !showAddRow ? (
                    <tr><td colSpan={8} className="text-center py-8 text-text-muted">No lab bills found for this period</td></tr>
                  ) : (
                    filtered.map(bill => (
                      <tr key={bill.id} className={`border-b border-border last:border-0 hover:bg-surface-dim transition ${bill.paid ? "opacity-70" : ""}`}>
                        <td className="px-4 py-2.5 text-text-subtle whitespace-nowrap">{bill.date}</td>
                        <td className="px-4 py-2.5 font-medium">{bill.lab_name}</td>
                        <td className="px-4 py-2.5">
                          <select value={bill.dentist_id || ""} onChange={e => updateBill(bill.id, { dentist_id: e.target.value ? parseInt(e.target.value) : null })}
                            className="text-sm bg-transparent border-0 outline-none p-0 cursor-pointer text-text-muted hover:text-text">
                            <option value="">-</option>
                            {dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-text-subtle max-w-[200px] truncate">{bill.description || "-"}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmt(bill.amount)}</td>
                        <td className="px-4 py-2.5 text-center">
                          {bill.file_url ? (
                            <button onClick={() => setPreviewUrl(bill.file_url)} className="text-blue-600 hover:text-blue-700" title="View invoice">
                              <Eye size={16} />
                            </button>
                          ) : (
                            <label className="cursor-pointer text-text-muted hover:text-primary-600 transition">
                              {uploading === bill.id ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                                onChange={e => { if (e.target.files?.[0]) uploadFile(bill.id, e.target.files[0], bill.lab_name); }} />
                            </label>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => updateBill(bill.id, { paid: bill.paid ? 0 : 1, paid_date: bill.paid ? null : new Date().toISOString().substring(0, 10) })}
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                              bill.paid ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400"
                            }`}
                          >
                            {bill.paid && <Check size={12} />}
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => deleteBill(bill.id)} className="text-text-muted hover:text-danger transition">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-text">Invoice Preview</h3>
              <button onClick={() => setPreviewUrl(null)} className="text-text-muted hover:text-text"><X size={20} /></button>
            </div>
            <div className="p-4 overflow-auto max-h-[80vh]">
              {previewUrl.endsWith(".pdf") ? (
                <iframe src={previewUrl} className="w-full h-[70vh] rounded-lg border" />
              ) : (
                <img src={previewUrl} alt="Invoice" className="max-w-full mx-auto rounded-lg" />
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
