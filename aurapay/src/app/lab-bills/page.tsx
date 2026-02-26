"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import Shell from "@/components/Shell";
import {
  Plus, Trash2, Upload, Eye, X, Check, Loader2, Search, Filter,
  EyeOff, List, LayoutGrid, ChevronDown, ChevronRight
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
const shortMonth = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "short" });

type PayFilter = "all" | "unpaid" | "paid";
type GroupBy = "none" | "lab" | "dentist" | "month";
type ViewMode = "list" | "table";

export default function LabBillsPage() {
  const [bills, setBills] = useState<LabBill[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [savedLabs, setSavedLabs] = useState<SavedLab[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [payFilter, setPayFilter] = useState<PayFilter>("all");
  const [filterLab, setFilterLab] = useState<string>("");
  const [filterDentist, setFilterDentist] = useState<string>("");

  // View
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Add form
  const [showAddRow, setShowAddRow] = useState(false);
  const [newBill, setNewBill] = useState({ lab_name: "", dentist_id: "", amount: "", description: "", date: new Date().toISOString().substring(0, 10) });
  const [uploading, setUploading] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showNewLab, setShowNewLab] = useState(false);
  const [newLabName, setNewLabName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);

  useEffect(() => { load(); }, [filterYear, filterMonth]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ year: String(filterYear) });
    if (filterMonth) params.set("month", String(filterMonth));
    const [billsRes, dentistsRes, entitiesRes] = await Promise.all([
      fetch(`/api/bills/lab?${params}`), fetch("/api/dentists"), fetch("/api/bills/saved-entities"),
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
      if (uploadRes.ok) { const data = await uploadRes.json(); fileUrl = data.file_url; }
    }
    const res = await fetch("/api/bills/lab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newBill, amount: parseFloat(newBill.amount), dentist_id: newBill.dentist_id ? parseInt(newBill.dentist_id) : null, file_url: fileUrl }),
    });
    if (res.ok) {
      setNewBill({ lab_name: "", dentist_id: "", amount: "", description: "", date: new Date().toISOString().substring(0, 10) });
      setNewFile(null); setShowAddRow(false); load();
    }
  }

  async function updateBill(id: number, updates: Record<string, unknown>) {
    await fetch("/api/bills/lab", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) });
    load();
  }

  async function deleteBill(id: number) {
    if (!confirm("Delete this lab bill?")) return;
    await fetch(`/api/bills/lab?id=${id}`, { method: "DELETE" }); load();
  }

  async function uploadFile(billId: number, file: File, labName: string) {
    setUploading(billId);
    const formData = new FormData();
    formData.append("file", file); formData.append("type", "lab"); formData.append("entity_name", labName);
    const res = await fetch("/api/bills/upload", { method: "POST", body: formData });
    if (res.ok) { const data = await res.json(); await updateBill(billId, { file_url: data.file_url }); }
    setUploading(null);
  }

  async function addNewLab() {
    if (!newLabName.trim()) return;
    const res = await fetch("/api/bills/saved-entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "lab", name: newLabName.trim() }) });
    if (res.ok) { setSavedLabs([...savedLabs, { id: 0, name: newLabName.trim() }]); setNewBill({ ...newBill, lab_name: newLabName.trim() }); setNewLabName(""); setShowNewLab(false); load(); }
  }

  // Filtering logic
  const filtered = useMemo(() => {
    return bills.filter(b => {
      if (payFilter === "unpaid" && b.paid) return false;
      if (payFilter === "paid" && !b.paid) return false;
      if (filterLab && b.lab_name !== filterLab) return false;
      if (filterDentist && String(b.dentist_id) !== filterDentist) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (!b.lab_name.toLowerCase().includes(q) && !(b.dentist_name || "").toLowerCase().includes(q) && !b.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [bills, payFilter, filterLab, filterDentist, searchTerm]);

  const totalAmount = filtered.reduce((s, b) => s + b.amount, 0);
  const paidAmount = filtered.filter(b => b.paid).reduce((s, b) => s + b.amount, 0);
  const unpaidAmount = totalAmount - paidAmount;
  const unpaidCount = filtered.filter(b => !b.paid).length;

  // Unique labs and dentists in current data
  const uniqueLabs = [...new Set(bills.map(b => b.lab_name))].sort();
  const uniqueDentists = [...new Map(bills.filter(b => b.dentist_id).map(b => [b.dentist_id, b.dentist_name])).entries()].sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));

  // Grouped data
  const grouped = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map<string, LabBill[]>();
    for (const bill of filtered) {
      let key = "";
      if (groupBy === "lab") key = bill.lab_name;
      else if (groupBy === "dentist") key = bill.dentist_name || "Unassigned";
      else if (groupBy === "month") key = `${shortMonth(bill.month)} ${bill.year}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(bill);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      items,
      total: items.reduce((s, b) => s + b.amount, 0),
      paidTotal: items.filter(b => b.paid).reduce((s, b) => s + b.amount, 0),
      unpaidTotal: items.filter(b => !b.paid).reduce((s, b) => s + b.amount, 0),
      count: items.length,
      unpaidCount: items.filter(b => !b.paid).length,
    })).sort((a, b) => b.total - a.total);
  }, [filtered, groupBy]);

  function toggleGroup(key: string) {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsedGroups(next);
  }

  function clearFilters() {
    setSearchTerm(""); setPayFilter("all"); setFilterLab(""); setFilterDentist("");
  }

  const hasActiveFilters = payFilter !== "all" || filterLab || filterDentist || searchTerm;

  function renderBillRow(bill: LabBill) {
    return (
      <tr key={bill.id} className={`border-b border-border last:border-0 hover:bg-surface-dim/50 transition ${bill.paid ? "bg-green-50/30" : ""}`}>
        <td className="px-3 py-2 text-text-subtle whitespace-nowrap text-xs">{bill.date}</td>
        <td className="px-3 py-2 font-medium text-sm">{bill.lab_name}</td>
        <td className="px-3 py-2">
          <select value={bill.dentist_id || ""} onChange={e => updateBill(bill.id, { dentist_id: e.target.value ? parseInt(e.target.value) : null })}
            className="text-xs bg-transparent border-0 outline-none p-0 cursor-pointer text-text-muted hover:text-text w-full">
            <option value="">-</option>
            {dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </td>
        <td className="px-3 py-2 text-text-subtle text-xs max-w-[180px] truncate">{bill.description || "-"}</td>
        <td className="px-3 py-2 text-right font-semibold text-sm tabular-nums">{fmt(bill.amount)}</td>
        <td className="px-3 py-2 text-center">
          {bill.file_url ? (
            <button onClick={() => setPreviewUrl(bill.file_url)} className="text-blue-600 hover:text-blue-700 p-0.5" title="View invoice"><Eye size={15} /></button>
          ) : (
            <label className="cursor-pointer text-text-muted hover:text-primary-600 transition p-0.5">
              {uploading === bill.id ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                onChange={e => { if (e.target.files?.[0]) uploadFile(bill.id, e.target.files[0], bill.lab_name); }} />
            </label>
          )}
        </td>
        <td className="px-3 py-2 text-center">
          <button onClick={() => updateBill(bill.id, { paid: bill.paid ? 0 : 1, paid_date: bill.paid ? null : new Date().toISOString().substring(0, 10) })}
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${bill.paid ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400"}`}>
            {bill.paid ? <Check size={10} /> : null}
          </button>
        </td>
        <td className="px-3 py-2 text-center">
          <button onClick={() => deleteBill(bill.id)} className="text-text-muted hover:text-danger transition p-0.5"><Trash2 size={13} /></button>
        </td>
      </tr>
    );
  }

  // Spreadsheet-style table view (labs as columns, months as rows)
  function renderTableView() {
    const labNames = [...new Set(filtered.map(b => b.lab_name))].sort();
    const monthKeys = [...new Set(filtered.map(b => `${b.year}-${String(b.month).padStart(2, "0")}`))].sort();

    // Build lookup: monthKey -> labName -> total
    const lookup = new Map<string, Map<string, { total: number; paid: boolean; bills: LabBill[] }>>();
    for (const bill of filtered) {
      const mk = `${bill.year}-${String(bill.month).padStart(2, "0")}`;
      if (!lookup.has(mk)) lookup.set(mk, new Map());
      const row = lookup.get(mk)!;
      if (!row.has(bill.lab_name)) row.set(bill.lab_name, { total: 0, paid: true, bills: [] });
      const cell = row.get(bill.lab_name)!;
      cell.total += bill.amount;
      if (!bill.paid) cell.paid = false;
      cell.bills.push(bill);
    }

    // Column totals
    const colTotals = new Map<string, number>();
    for (const ln of labNames) {
      let t = 0;
      for (const mk of monthKeys) { t += lookup.get(mk)?.get(ln)?.total || 0; }
      colTotals.set(ln, t);
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-dim">
              <th className="text-left px-3 py-2.5 font-semibold text-text-muted sticky left-0 bg-surface-dim z-10 min-w-[100px]">Month</th>
              {labNames.map(ln => (
                <th key={ln} className="text-right px-3 py-2.5 font-semibold text-text-muted min-w-[90px] whitespace-nowrap">{ln}</th>
              ))}
              <th className="text-right px-3 py-2.5 font-bold text-text min-w-[90px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {monthKeys.map(mk => {
              const [y, m] = mk.split("-").map(Number);
              const row = lookup.get(mk);
              const rowTotal = labNames.reduce((s, ln) => s + (row?.get(ln)?.total || 0), 0);
              return (
                <tr key={mk} className="border-b border-border hover:bg-surface-dim/50 transition">
                  <td className="px-3 py-2 font-medium sticky left-0 bg-white z-10">{shortMonth(m)} {y}</td>
                  {labNames.map(ln => {
                    const cell = row?.get(ln);
                    if (!cell) return <td key={ln} className="px-3 py-2 text-right text-text-subtle">-</td>;
                    return (
                      <td key={ln} className={`px-3 py-2 text-right font-medium tabular-nums ${cell.paid ? "text-green-700 bg-green-50/50" : "text-red-700 bg-red-50/50"}`}>
                        {fmt(cell.total)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-dim">
              <td className="px-3 py-2.5 font-bold sticky left-0 bg-surface-dim z-10">Total</td>
              {labNames.map(ln => (
                <td key={ln} className="px-3 py-2.5 text-right font-bold tabular-nums">{fmt(colTotals.get(ln) || 0)}</td>
              ))}
              <td className="px-3 py-2.5 text-right font-bold tabular-nums text-primary-700">{fmt(totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  return (
    <Shell>
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Lab Bills</h1>
            <p className="text-sm text-text-muted mt-0.5">Track and manage dental lab bills</p>
          </div>
          <button onClick={() => setShowAddRow(true)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">
            <Plus size={16} /> Add Lab Bill
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button onClick={() => setPayFilter("all")} className={`rounded-xl border p-3.5 text-left transition ${payFilter === "all" ? "border-primary-300 bg-primary-50 ring-1 ring-primary-200" : "border-border bg-white hover:border-primary-200"}`}>
            <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Total</p>
            <p className="text-xl font-bold text-text mt-0.5">{fmt(totalAmount)}</p>
            <p className="text-[10px] text-text-subtle mt-0.5">{filtered.length} bills</p>
          </button>
          <button onClick={() => setPayFilter("paid")} className={`rounded-xl border p-3.5 text-left transition ${payFilter === "paid" ? "border-green-300 bg-green-50 ring-1 ring-green-200" : "border-border bg-white hover:border-green-200"}`}>
            <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wider">Paid</p>
            <p className="text-xl font-bold text-green-600 mt-0.5">{fmt(paidAmount)}</p>
            <p className="text-[10px] text-text-subtle mt-0.5">{filtered.filter(b => b.paid).length} bills</p>
          </button>
          <button onClick={() => setPayFilter("unpaid")} className={`rounded-xl border p-3.5 text-left transition ${payFilter === "unpaid" ? "border-red-300 bg-red-50 ring-1 ring-red-200" : "border-border bg-white hover:border-red-200"}`}>
            <p className="text-[10px] text-red-600 font-semibold uppercase tracking-wider">Unpaid</p>
            <p className="text-xl font-bold text-red-600 mt-0.5">{fmt(unpaidAmount)}</p>
            <p className="text-[10px] text-text-subtle mt-0.5">{unpaidCount} bills</p>
          </button>
          <div className="rounded-xl border border-border bg-white p-3.5">
            <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">With Invoice</p>
            <p className="text-xl font-bold text-text mt-0.5">{filtered.filter(b => b.file_url).length}<span className="text-sm font-normal text-text-muted">/{filtered.length}</span></p>
            <p className="text-[10px] text-text-subtle mt-0.5">{filtered.length > 0 ? Math.round(filtered.filter(b => b.file_url).length / filtered.length * 100) : 0}% uploaded</p>
          </div>
        </div>

        {/* Filters & Controls */}
        <div className="bg-white rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Date filters */}
            <select value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white font-medium">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={filterMonth || ""} onChange={e => setFilterMonth(e.target.value ? parseInt(e.target.value) : null)}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white">
              <option value="">All Months</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
            </select>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Entity filters */}
            <select value={filterLab} onChange={e => setFilterLab(e.target.value)}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white">
              <option value="">All Labs</option>
              {uniqueLabs.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={filterDentist} onChange={e => setFilterDentist(e.target.value)}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white">
              <option value="">All Dentists</option>
              {uniqueDentists.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
            </select>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Search */}
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg bg-white" />
            </div>

            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2">Clear</button>
            )}

            <div className="w-px h-5 bg-border mx-1" />

            {/* Group by */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-text-muted font-medium uppercase">Group:</span>
              {(["none", "lab", "dentist", "month"] as GroupBy[]).map(g => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`text-[10px] px-2 py-1 rounded-md font-medium transition ${groupBy === g ? "bg-primary-100 text-primary-700" : "text-text-muted hover:bg-surface-dim"}`}>
                  {g === "none" ? "None" : g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-border mx-1" />

            {/* View mode */}
            <div className="flex items-center bg-surface-dim rounded-lg p-0.5">
              <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-md transition ${viewMode === "list" ? "bg-white text-text shadow-sm" : "text-text-muted"}`} title="List view"><List size={14} /></button>
              <button onClick={() => setViewMode("table")} className={`p-1.5 rounded-md transition ${viewMode === "table" ? "bg-white text-text shadow-sm" : "text-text-muted"}`} title="Table view"><LayoutGrid size={14} /></button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-primary-600" /></div>
          ) : viewMode === "table" ? (
            renderTableView()
          ) : grouped ? (
            /* Grouped list view */
            <div>
              {grouped.map(group => (
                <div key={group.key}>
                  <button onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-dim hover:bg-gray-100 transition border-b border-border">
                    <div className="flex items-center gap-2">
                      {collapsedGroups.has(group.key) ? <ChevronRight size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
                      <span className="font-semibold text-sm text-text">{group.key}</span>
                      <span className="text-xs text-text-muted">({group.count} bill{group.count !== 1 ? "s" : ""})</span>
                      {group.unpaidCount > 0 && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-semibold">{group.unpaidCount} unpaid</span>}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      {group.unpaidTotal > 0 && <span className="text-red-600 font-semibold">{fmt(group.unpaidTotal)} unpaid</span>}
                      <span className="font-bold text-text tabular-nums">{fmt(group.total)}</span>
                    </div>
                  </button>
                  {!collapsedGroups.has(group.key) && (
                    <table className="w-full text-sm">
                      <tbody>{group.items.map(renderBillRow)}</tbody>
                    </table>
                  )}
                </div>
              ))}
              {grouped.length === 0 && <p className="text-center py-8 text-text-muted text-sm">No bills match your filters</p>}
              {/* Grand total footer */}
              {grouped.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-surface-dim border-t-2 border-border">
                  <span className="font-bold text-sm">Grand Total ({filtered.length} bills)</span>
                  <div className="flex items-center gap-4 text-sm">
                    {unpaidAmount > 0 && <span className="text-red-600 font-semibold">{fmt(unpaidAmount)} unpaid</span>}
                    <span className="font-bold text-primary-700 tabular-nums">{fmt(totalAmount)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Flat list view */
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-dim">
                    <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Date</th>
                    <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Lab</th>
                    <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Dentist</th>
                    <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Description</th>
                    <th className="text-right px-3 py-2.5 font-medium text-text-muted text-xs">Amount</th>
                    <th className="text-center px-3 py-2.5 font-medium text-text-muted text-xs w-12">File</th>
                    <th className="text-center px-3 py-2.5 font-medium text-text-muted text-xs w-10">Paid</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {showAddRow && (
                    <tr className="border-b border-border bg-primary-50/60">
                      <td className="px-3 py-1.5"><input type="date" value={newBill.date} onChange={e => setNewBill({ ...newBill, date: e.target.value })} className="text-xs border border-border rounded px-2 py-1 w-full bg-white" /></td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <select value={newBill.lab_name} onChange={e => setNewBill({ ...newBill, lab_name: e.target.value })} className="text-xs border border-border rounded px-2 py-1 bg-white flex-1">
                            <option value="">Select lab...</option>
                            {savedLabs.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                          </select>
                          <button onClick={() => setShowNewLab(true)} className="text-primary-600 hover:text-primary-700 shrink-0"><Plus size={14} /></button>
                        </div>
                        {showNewLab && (
                          <div className="flex items-center gap-1 mt-1">
                            <input type="text" placeholder="New lab name" value={newLabName} onChange={e => setNewLabName(e.target.value)} className="text-[10px] border border-border rounded px-2 py-1 flex-1 bg-white" />
                            <button onClick={addNewLab} className="text-green-600"><Check size={12} /></button>
                            <button onClick={() => { setShowNewLab(false); setNewLabName(""); }} className="text-text-muted"><X size={12} /></button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5"><select value={newBill.dentist_id} onChange={e => setNewBill({ ...newBill, dentist_id: e.target.value })} className="text-xs border border-border rounded px-2 py-1 bg-white w-full"><option value="">Dentist...</option>{dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>
                      <td className="px-3 py-1.5"><input type="text" placeholder="Description" value={newBill.description} onChange={e => setNewBill({ ...newBill, description: e.target.value })} className="text-xs border border-border rounded px-2 py-1 w-full bg-white" /></td>
                      <td className="px-3 py-1.5"><input type="number" step="0.01" placeholder="0.00" value={newBill.amount} onChange={e => setNewBill({ ...newBill, amount: e.target.value })} className="text-xs border border-border rounded px-2 py-1 w-20 text-right bg-white" /></td>
                      <td className="px-3 py-1.5 text-center">
                        <label className="cursor-pointer inline-flex items-center gap-1 text-[10px] text-primary-600 hover:text-primary-700">
                          <Upload size={12} />{newFile ? "..." : ""}
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e => { if (e.target.files?.[0]) setNewFile(e.target.files[0]); }} />
                        </label>
                      </td>
                      <td className="px-3 py-1.5 text-center text-text-muted">-</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-0.5">
                          <button onClick={addBill} className="text-green-600 hover:text-green-700"><Check size={14} /></button>
                          <button onClick={() => { setShowAddRow(false); setNewFile(null); }} className="text-text-muted hover:text-text"><X size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filtered.map(renderBillRow)}
                  {filtered.length === 0 && !showAddRow && <tr><td colSpan={8} className="text-center py-8 text-text-muted text-sm">No lab bills match your filters</td></tr>}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-surface-dim">
                      <td colSpan={4} className="px-3 py-2.5 font-bold text-xs">Total ({filtered.length} bills)</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-sm">{fmt(totalAmount)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                )}
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
              {previewUrl.endsWith(".pdf") ? <iframe src={previewUrl} className="w-full h-[70vh] rounded-lg border" /> : <img src={previewUrl} alt="Invoice" className="max-w-full mx-auto rounded-lg" />}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
