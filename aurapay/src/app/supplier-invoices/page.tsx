"use client";
import { useEffect, useState, useMemo } from "react";
import Shell from "@/components/Shell";
import {
  Plus, Trash2, Upload, Eye, X, Check, Loader2, Search,
  List, LayoutGrid, ChevronDown, ChevronRight
} from "lucide-react";

interface Dentist { id: number; name: string; }
interface SavedSupplier { id: number; name: string; }
interface SupplierInvoice {
  id: number; supplier_name: string; dentist_id: number | null; dentist_name: string | null;
  amount: number; description: string; invoice_number: string; file_url: string | null;
  date: string; month: number; year: number; paid: number; paid_date: string | null;
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" });
const shortMonth = (m: number) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "short" });

type PayFilter = "all" | "unpaid" | "paid";
type GroupBy = "none" | "supplier" | "dentist" | "month";
type ViewMode = "list" | "table";

export default function SupplierInvoicesPage() {
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [savedSuppliers, setSavedSuppliers] = useState<SavedSupplier[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [payFilter, setPayFilter] = useState<PayFilter>("all");
  const [filterSupplier, setFilterSupplier] = useState<string>("");
  const [filterDentist, setFilterDentist] = useState<string>("");

  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const [showAddRow, setShowAddRow] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ supplier_name: "", dentist_id: "", amount: "", description: "", invoice_number: "", date: new Date().toISOString().substring(0, 10) });
  const [uploading, setUploading] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);

  useEffect(() => { load(); }, [filterYear, filterMonth]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ year: String(filterYear) });
    if (filterMonth) params.set("month", String(filterMonth));
    const [invRes, dentistsRes, entitiesRes] = await Promise.all([
      fetch(`/api/bills/suppliers?${params}`), fetch("/api/dentists"), fetch("/api/bills/saved-entities"),
    ]);
    if (invRes.ok) { const d = await invRes.json(); setInvoices(d.invoices || []); }
    if (dentistsRes.ok) { const d = await dentistsRes.json(); setDentists(d.dentists || []); }
    if (entitiesRes.ok) { const d = await entitiesRes.json(); setSavedSuppliers(d.suppliers || []); }
    setLoading(false);
  }

  async function addInvoice() {
    if (!newInvoice.supplier_name || !newInvoice.amount || !newInvoice.date) return;
    let fileUrl: string | null = null;
    if (newFile) {
      const formData = new FormData();
      formData.append("file", newFile); formData.append("type", "supplier"); formData.append("entity_name", newInvoice.supplier_name);
      const uploadRes = await fetch("/api/bills/upload", { method: "POST", body: formData });
      if (uploadRes.ok) { const data = await uploadRes.json(); fileUrl = data.file_url; }
    }
    const res = await fetch("/api/bills/suppliers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newInvoice, amount: parseFloat(newInvoice.amount), dentist_id: newInvoice.dentist_id ? parseInt(newInvoice.dentist_id) : null, file_url: fileUrl }),
    });
    if (res.ok) {
      setNewInvoice({ supplier_name: "", dentist_id: "", amount: "", description: "", invoice_number: "", date: new Date().toISOString().substring(0, 10) });
      setNewFile(null); setShowAddRow(false); load();
    }
  }

  async function updateInvoice(id: number, updates: Record<string, unknown>) {
    await fetch("/api/bills/suppliers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) }); load();
  }

  async function deleteInvoice(id: number) {
    if (!confirm("Delete this invoice?")) return;
    await fetch(`/api/bills/suppliers?id=${id}`, { method: "DELETE" }); load();
  }

  async function uploadFile(invId: number, file: File, supplierName: string) {
    setUploading(invId);
    const formData = new FormData();
    formData.append("file", file); formData.append("type", "supplier"); formData.append("entity_name", supplierName);
    const res = await fetch("/api/bills/upload", { method: "POST", body: formData });
    if (res.ok) { const data = await res.json(); await updateInvoice(invId, { file_url: data.file_url }); }
    setUploading(null);
  }

  async function addNewSupplier() {
    if (!newSupplierName.trim()) return;
    const res = await fetch("/api/bills/saved-entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "supplier", name: newSupplierName.trim() }) });
    if (res.ok) { setSavedSuppliers([...savedSuppliers, { id: 0, name: newSupplierName.trim() }]); setNewInvoice({ ...newInvoice, supplier_name: newSupplierName.trim() }); setNewSupplierName(""); setShowNewSupplier(false); load(); }
  }

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (payFilter === "unpaid" && inv.paid) return false;
      if (payFilter === "paid" && !inv.paid) return false;
      if (filterSupplier && inv.supplier_name !== filterSupplier) return false;
      if (filterDentist && String(inv.dentist_id) !== filterDentist) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (!inv.supplier_name.toLowerCase().includes(q) && !(inv.dentist_name || "").toLowerCase().includes(q) && !inv.description.toLowerCase().includes(q) && !inv.invoice_number.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [invoices, payFilter, filterSupplier, filterDentist, searchTerm]);

  const totalAmount = filtered.reduce((s, inv) => s + inv.amount, 0);
  const paidAmount = filtered.filter(inv => inv.paid).reduce((s, inv) => s + inv.amount, 0);
  const unpaidAmount = totalAmount - paidAmount;
  const unpaidCount = filtered.filter(inv => !inv.paid).length;

  const uniqueSuppliers = [...new Set(invoices.map(inv => inv.supplier_name))].sort();
  const uniqueDentists = [...new Map(invoices.filter(inv => inv.dentist_id).map(inv => [inv.dentist_id, inv.dentist_name])).entries()].sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));

  const grouped = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map<string, SupplierInvoice[]>();
    for (const inv of filtered) {
      let key = "";
      if (groupBy === "supplier") key = inv.supplier_name;
      else if (groupBy === "dentist") key = inv.dentist_name || "Unassigned";
      else if (groupBy === "month") key = `${shortMonth(inv.month)} ${inv.year}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inv);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      key, items,
      total: items.reduce((s, inv) => s + inv.amount, 0),
      unpaidTotal: items.filter(inv => !inv.paid).reduce((s, inv) => s + inv.amount, 0),
      count: items.length,
      unpaidCount: items.filter(inv => !inv.paid).length,
    })).sort((a, b) => b.total - a.total);
  }, [filtered, groupBy]);

  function toggleGroup(key: string) {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsedGroups(next);
  }

  function clearFilters() { setSearchTerm(""); setPayFilter("all"); setFilterSupplier(""); setFilterDentist(""); }
  const hasActiveFilters = payFilter !== "all" || filterSupplier || filterDentist || searchTerm;

  function renderRow(inv: SupplierInvoice) {
    return (
      <tr key={inv.id} className={`border-b border-border last:border-0 hover:bg-surface-dim/50 transition ${inv.paid ? "bg-green-50/30" : ""} hidden md:table-row`}>
        <td className="px-3 py-2 text-text-subtle whitespace-nowrap text-xs">{inv.date}</td>
        <td className="px-3 py-2 font-medium text-sm">{inv.supplier_name}</td>
        <td className="px-3 py-2">
          <select value={inv.dentist_id || ""} onChange={e => updateInvoice(inv.id, { dentist_id: e.target.value ? parseInt(e.target.value) : null })}
            className="text-xs bg-transparent border-0 outline-none p-0 cursor-pointer text-text-muted hover:text-text w-full">
            <option value="">-</option>
            {dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </td>
        <td className="px-3 py-2 text-text-subtle text-xs">{inv.invoice_number || "-"}</td>
        <td className="px-3 py-2 text-text-subtle text-xs max-w-[160px] truncate">{inv.description || "-"}</td>
        <td className="px-3 py-2 text-right font-semibold text-sm tabular-nums">{fmt(inv.amount)}</td>
        <td className="px-3 py-2 text-center">
          {inv.file_url ? (
            <button onClick={() => setPreviewUrl(inv.file_url)} className="text-blue-600 hover:text-blue-700 p-1"><Eye size={16} /></button>
          ) : (
            <label className="cursor-pointer text-text-muted hover:text-primary-600 transition p-1">
              {uploading === inv.id ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadFile(inv.id, e.target.files[0], inv.supplier_name); }} />
            </label>
          )}
        </td>
        <td className="px-3 py-2 text-center">
          <button onClick={() => updateInvoice(inv.id, { paid: inv.paid ? 0 : 1, paid_date: inv.paid ? null : new Date().toISOString().substring(0, 10) })}
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${inv.paid ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400"}`}>
            {inv.paid ? <Check size={12} /> : null}
          </button>
        </td>
        <td className="px-3 py-2 text-center">
          <button onClick={() => deleteInvoice(inv.id)} className="text-text-muted hover:text-danger transition p-1"><Trash2 size={14} /></button>
        </td>
      </tr>
    );
  }

  function renderCard(inv: SupplierInvoice) {
    return (
      <div key={inv.id} className={`p-3.5 border-b border-border last:border-0 md:hidden ${inv.paid ? "bg-green-50/30" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{inv.supplier_name}</span>
              {inv.paid && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Paid</span>}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {inv.date}{inv.dentist_name ? ` · ${inv.dentist_name}` : ""}{inv.invoice_number ? ` · #${inv.invoice_number}` : ""}
            </div>
            {inv.description && <div className="text-xs text-text-subtle mt-0.5 truncate">{inv.description}</div>}
          </div>
          <span className="text-base font-bold tabular-nums whitespace-nowrap">{fmt(inv.amount)}</span>
        </div>
        <div className="flex items-center gap-3 mt-2.5 pt-2 border-t border-border/50">
          <select value={inv.dentist_id || ""} onChange={e => updateInvoice(inv.id, { dentist_id: e.target.value ? parseInt(e.target.value) : null })}
            className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white flex-1 min-w-0">
            <option value="">Assign dentist...</option>
            {dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            {inv.file_url ? (
              <button onClick={() => setPreviewUrl(inv.file_url)} className="p-2 text-blue-600 rounded-lg hover:bg-blue-50"><Eye size={18} /></button>
            ) : (
              <label className="cursor-pointer p-2 text-text-muted rounded-lg hover:bg-surface-muted transition">
                {uploading === inv.id ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,image/*" capture="environment" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) uploadFile(inv.id, e.target.files[0], inv.supplier_name); }} />
              </label>
            )}
            <button onClick={() => updateInvoice(inv.id, { paid: inv.paid ? 0 : 1, paid_date: inv.paid ? null : new Date().toISOString().substring(0, 10) })}
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition ${inv.paid ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400"}`}>
              {inv.paid ? <Check size={14} /> : null}
            </button>
            <button onClick={() => deleteInvoice(inv.id)} className="p-2 text-text-muted hover:text-danger rounded-lg hover:bg-red-50 transition"><Trash2 size={16} /></button>
          </div>
        </div>
      </div>
    );
  }

  function renderTableView() {
    const supplierNames = [...new Set(filtered.map(inv => inv.supplier_name))].sort();
    const monthKeys = [...new Set(filtered.map(inv => `${inv.year}-${String(inv.month).padStart(2, "0")}`))].sort();
    const lookup = new Map<string, Map<string, { total: number; paid: boolean }>>();
    for (const inv of filtered) {
      const mk = `${inv.year}-${String(inv.month).padStart(2, "0")}`;
      if (!lookup.has(mk)) lookup.set(mk, new Map());
      const row = lookup.get(mk)!;
      if (!row.has(inv.supplier_name)) row.set(inv.supplier_name, { total: 0, paid: true });
      const cell = row.get(inv.supplier_name)!;
      cell.total += inv.amount;
      if (!inv.paid) cell.paid = false;
    }
    const colTotals = new Map<string, number>();
    for (const sn of supplierNames) {
      let t = 0;
      for (const mk of monthKeys) { t += lookup.get(mk)?.get(sn)?.total || 0; }
      colTotals.set(sn, t);
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-dim">
              <th className="text-left px-3 py-2.5 font-semibold text-text-muted sticky left-0 bg-surface-dim z-10 min-w-[100px]">Month</th>
              {supplierNames.map(sn => <th key={sn} className="text-right px-3 py-2.5 font-semibold text-text-muted min-w-[90px] whitespace-nowrap">{sn}</th>)}
              <th className="text-right px-3 py-2.5 font-bold text-text min-w-[90px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {monthKeys.map(mk => {
              const [y, m] = mk.split("-").map(Number);
              const row = lookup.get(mk);
              const rowTotal = supplierNames.reduce((s, sn) => s + (row?.get(sn)?.total || 0), 0);
              return (
                <tr key={mk} className="border-b border-border hover:bg-surface-dim/50 transition">
                  <td className="px-3 py-2 font-medium sticky left-0 bg-white z-10">{shortMonth(m)} {y}</td>
                  {supplierNames.map(sn => {
                    const cell = row?.get(sn);
                    if (!cell) return <td key={sn} className="px-3 py-2 text-right text-text-subtle">-</td>;
                    return <td key={sn} className={`px-3 py-2 text-right font-medium tabular-nums ${cell.paid ? "text-green-700 bg-green-50/50" : "text-red-700 bg-red-50/50"}`}>{fmt(cell.total)}</td>;
                  })}
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-dim">
              <td className="px-3 py-2.5 font-bold sticky left-0 bg-surface-dim z-10">Total</td>
              {supplierNames.map(sn => <td key={sn} className="px-3 py-2.5 text-right font-bold tabular-nums">{fmt(colTotals.get(sn) || 0)}</td>)}
              <td className="px-3 py-2.5 text-right font-bold tabular-nums text-primary-700">{fmt(totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  return (
    <Shell>
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text">Supplier Invoices</h1>
            <p className="text-xs sm:text-sm text-text-muted mt-0.5">Track and manage supplier invoices</p>
          </div>
          <button onClick={() => setShowAddRow(true)} className="flex items-center justify-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-primary-700 transition w-full sm:w-auto">
            <Plus size={16} /> Add Invoice
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <button onClick={() => setPayFilter("all")} className={`rounded-xl border p-3 sm:p-3.5 text-left transition ${payFilter === "all" ? "border-primary-300 bg-primary-50 ring-1 ring-primary-200" : "border-border bg-white hover:border-primary-200"}`}>
            <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Total</p>
            <p className="text-lg sm:text-xl font-bold text-text mt-0.5">{fmt(totalAmount)}</p>
            <p className="text-[10px] text-text-subtle mt-0.5">{filtered.length} invoices</p>
          </button>
          <button onClick={() => setPayFilter("paid")} className={`rounded-xl border p-3 sm:p-3.5 text-left transition ${payFilter === "paid" ? "border-green-300 bg-green-50 ring-1 ring-green-200" : "border-border bg-white hover:border-green-200"}`}>
            <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wider">Paid</p>
            <p className="text-lg sm:text-xl font-bold text-green-600 mt-0.5">{fmt(paidAmount)}</p>
            <p className="text-[10px] text-text-subtle mt-0.5">{filtered.filter(inv => inv.paid).length} invoices</p>
          </button>
          <button onClick={() => setPayFilter("unpaid")} className={`rounded-xl border p-3 sm:p-3.5 text-left transition ${payFilter === "unpaid" ? "border-red-300 bg-red-50 ring-1 ring-red-200" : "border-border bg-white hover:border-red-200"}`}>
            <p className="text-[10px] text-red-600 font-semibold uppercase tracking-wider">Unpaid</p>
            <p className="text-lg sm:text-xl font-bold text-red-600 mt-0.5">{fmt(unpaidAmount)}</p>
            <p className="text-[10px] text-text-subtle mt-0.5">{unpaidCount} invoices</p>
          </button>
          <div className="rounded-xl border border-border bg-white p-3 sm:p-3.5">
            <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">With File</p>
            <p className="text-lg sm:text-xl font-bold text-text mt-0.5">{filtered.filter(inv => inv.file_url).length}<span className="text-sm font-normal text-text-muted">/{filtered.length}</span></p>
            <p className="text-[10px] text-text-subtle mt-0.5">{filtered.length > 0 ? Math.round(filtered.filter(inv => inv.file_url).length / filtered.length * 100) : 0}% uploaded</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-border p-3">
          {/* Mobile search */}
          <div className="relative mb-2 sm:hidden">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input type="text" placeholder="Search invoices..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-xl bg-surface-dim/50" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))} className="text-xs border border-border rounded-lg px-2.5 py-2 sm:py-1.5 bg-white font-medium">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={filterMonth || ""} onChange={e => setFilterMonth(e.target.value ? parseInt(e.target.value) : null)} className="text-xs border border-border rounded-lg px-2.5 py-2 sm:py-1.5 bg-white flex-1 sm:flex-none">
              <option value="">All Months</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
            </select>
            <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} className="text-xs border border-border rounded-lg px-2.5 py-2 sm:py-1.5 bg-white flex-1 sm:flex-none">
              <option value="">All Suppliers</option>
              {uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterDentist} onChange={e => setFilterDentist(e.target.value)} className="text-xs border border-border rounded-lg px-2.5 py-2 sm:py-1.5 bg-white flex-1 sm:flex-none">
              <option value="">All Dentists</option>
              {uniqueDentists.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
            </select>
            {hasActiveFilters && <button onClick={clearFilters} className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1.5">Clear</button>}

            {/* Desktop search */}
            <div className="relative flex-1 min-w-[120px] hidden sm:block">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg bg-white" />
            </div>

            <div className="hidden sm:block w-px h-5 bg-border mx-1" />

            <div className="hidden sm:flex items-center gap-1">
              <span className="text-[10px] text-text-muted font-medium uppercase">Group:</span>
              {(["none", "supplier", "dentist", "month"] as GroupBy[]).map(g => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`text-[10px] px-2 py-1 rounded-md font-medium transition ${groupBy === g ? "bg-primary-100 text-primary-700" : "text-text-muted hover:bg-surface-dim"}`}>
                  {g === "none" ? "None" : g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>

            <div className="hidden sm:block w-px h-5 bg-border mx-1" />

            <div className="flex items-center bg-surface-dim rounded-lg p-0.5">
              <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-md transition ${viewMode === "list" ? "bg-white text-text shadow-sm" : "text-text-muted"}`}><List size={14} /></button>
              <button onClick={() => setViewMode("table")} className={`p-1.5 rounded-md transition ${viewMode === "table" ? "bg-white text-text shadow-sm" : "text-text-muted"}`}><LayoutGrid size={14} /></button>
            </div>
          </div>

          {/* Mobile group-by */}
          <div className="flex items-center gap-1 mt-2 sm:hidden overflow-x-auto">
            <span className="text-[10px] text-text-muted font-medium uppercase shrink-0">Group:</span>
            {(["none", "supplier", "dentist", "month"] as GroupBy[]).map(g => (
              <button key={g} onClick={() => setGroupBy(g)}
                className={`text-[10px] px-2.5 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${groupBy === g ? "bg-primary-100 text-primary-700" : "text-text-muted hover:bg-surface-dim"}`}>
                {g === "none" ? "None" : g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-primary-600" /></div>
          ) : viewMode === "table" ? (
            renderTableView()
          ) : grouped ? (
            <div>
              {grouped.map(group => (
                <div key={group.key}>
                  <button onClick={() => toggleGroup(group.key)} className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-dim hover:bg-gray-100 transition border-b border-border">
                    <div className="flex items-center gap-2 min-w-0">
                      {collapsedGroups.has(group.key) ? <ChevronRight size={14} className="text-text-muted shrink-0" /> : <ChevronDown size={14} className="text-text-muted shrink-0" />}
                      <span className="font-semibold text-sm text-text truncate">{group.key}</span>
                      <span className="text-xs text-text-muted shrink-0">({group.count})</span>
                      {group.unpaidCount > 0 && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-semibold shrink-0 hidden sm:inline">{group.unpaidCount} unpaid</span>}
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 text-xs shrink-0">
                      {group.unpaidTotal > 0 && <span className="text-red-600 font-semibold hidden sm:inline">{fmt(group.unpaidTotal)}</span>}
                      <span className="font-bold text-text tabular-nums">{fmt(group.total)}</span>
                    </div>
                  </button>
                  {!collapsedGroups.has(group.key) && (
                    <>
                      <table className="w-full text-sm hidden md:table"><tbody>{group.items.map(renderRow)}</tbody></table>
                      <div className="md:hidden">{group.items.map(renderCard)}</div>
                    </>
                  )}
                </div>
              ))}
              {grouped.length === 0 && <p className="text-center py-8 text-text-muted text-sm">No invoices match your filters</p>}
              {grouped.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-surface-dim border-t-2 border-border">
                  <span className="font-bold text-xs sm:text-sm">Grand Total ({filtered.length})</span>
                  <div className="flex items-center gap-2 sm:gap-4 text-sm">
                    {unpaidAmount > 0 && <span className="text-red-600 font-semibold text-xs sm:text-sm">{fmt(unpaidAmount)}</span>}
                    <span className="font-bold text-primary-700 tabular-nums">{fmt(totalAmount)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Mobile add form */}
              {showAddRow && (
                <div className="p-4 border-b border-border bg-primary-50/60 space-y-3 md:hidden">
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={newInvoice.date} onChange={e => setNewInvoice({ ...newInvoice, date: e.target.value })} className="text-sm border border-border rounded-xl px-3 py-2 bg-white" />
                    <input type="number" step="0.01" placeholder="Amount" value={newInvoice.amount} onChange={e => setNewInvoice({ ...newInvoice, amount: e.target.value })} className="text-sm border border-border rounded-xl px-3 py-2 bg-white text-right" />
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={newInvoice.supplier_name} onChange={e => setNewInvoice({ ...newInvoice, supplier_name: e.target.value })} className="text-sm border border-border rounded-xl px-3 py-2 bg-white flex-1">
                      <option value="">Select supplier...</option>
                      {savedSuppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                    <button onClick={() => setShowNewSupplier(true)} className="p-2 text-primary-600 shrink-0"><Plus size={18} /></button>
                  </div>
                  {showNewSupplier && (
                    <div className="flex items-center gap-2">
                      <input type="text" placeholder="New supplier name" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} className="text-sm border border-border rounded-xl px-3 py-2 flex-1 bg-white" />
                      <button onClick={addNewSupplier} className="p-2 text-green-600"><Check size={18} /></button>
                      <button onClick={() => { setShowNewSupplier(false); setNewSupplierName(""); }} className="p-2 text-text-muted"><X size={18} /></button>
                    </div>
                  )}
                  <select value={newInvoice.dentist_id} onChange={e => setNewInvoice({ ...newInvoice, dentist_id: e.target.value })} className="text-sm border border-border rounded-xl px-3 py-2 bg-white w-full">
                    <option value="">Assign dentist...</option>
                    {dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="Invoice #" value={newInvoice.invoice_number} onChange={e => setNewInvoice({ ...newInvoice, invoice_number: e.target.value })} className="text-sm border border-border rounded-xl px-3 py-2 bg-white" />
                    <input type="text" placeholder="Description" value={newInvoice.description} onChange={e => setNewInvoice({ ...newInvoice, description: e.target.value })} className="text-sm border border-border rounded-xl px-3 py-2 bg-white" />
                  </div>
                  <label className="flex-1 cursor-pointer flex items-center justify-center gap-2 text-sm text-primary-600 border border-primary-200 bg-primary-50 rounded-xl px-3 py-2.5 font-medium">
                    <Upload size={16} />{newFile ? newFile.name.substring(0, 20) : "Attach photo or file"}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) setNewFile(e.target.files[0]); }} />
                  </label>
                  <div className="flex items-center gap-2">
                    <button onClick={addInvoice} className="flex-1 bg-primary-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-primary-700 transition">Save</button>
                    <button onClick={() => { setShowAddRow(false); setNewFile(null); }} className="flex-1 border border-border py-2.5 rounded-xl text-sm font-medium text-text-muted hover:bg-surface-dim transition">Cancel</button>
                  </div>
                </div>
              )}

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-dim">
                      <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Date</th>
                      <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Supplier</th>
                      <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Dentist</th>
                      <th className="text-left px-3 py-2.5 font-medium text-text-muted text-xs">Inv #</th>
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
                        <td className="px-3 py-1.5"><input type="date" value={newInvoice.date} onChange={e => setNewInvoice({ ...newInvoice, date: e.target.value })} className="text-xs border border-border rounded px-2 py-1 w-full bg-white" /></td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            <select value={newInvoice.supplier_name} onChange={e => setNewInvoice({ ...newInvoice, supplier_name: e.target.value })} className="text-xs border border-border rounded px-2 py-1 bg-white flex-1">
                              <option value="">Supplier...</option>
                              {savedSuppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                            </select>
                            <button onClick={() => setShowNewSupplier(true)} className="text-primary-600 shrink-0"><Plus size={14} /></button>
                          </div>
                          {showNewSupplier && (
                            <div className="flex items-center gap-1 mt-1">
                              <input type="text" placeholder="New supplier" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} className="text-[10px] border border-border rounded px-2 py-1 flex-1 bg-white" />
                              <button onClick={addNewSupplier} className="text-green-600"><Check size={12} /></button>
                              <button onClick={() => { setShowNewSupplier(false); setNewSupplierName(""); }} className="text-text-muted"><X size={12} /></button>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5"><select value={newInvoice.dentist_id} onChange={e => setNewInvoice({ ...newInvoice, dentist_id: e.target.value })} className="text-xs border border-border rounded px-2 py-1 bg-white w-full"><option value="">Dentist...</option>{dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>
                        <td className="px-3 py-1.5"><input type="text" placeholder="INV-001" value={newInvoice.invoice_number} onChange={e => setNewInvoice({ ...newInvoice, invoice_number: e.target.value })} className="text-xs border border-border rounded px-2 py-1 w-full bg-white" /></td>
                        <td className="px-3 py-1.5"><input type="text" placeholder="Description" value={newInvoice.description} onChange={e => setNewInvoice({ ...newInvoice, description: e.target.value })} className="text-xs border border-border rounded px-2 py-1 w-full bg-white" /></td>
                        <td className="px-3 py-1.5"><input type="number" step="0.01" placeholder="0.00" value={newInvoice.amount} onChange={e => setNewInvoice({ ...newInvoice, amount: e.target.value })} className="text-xs border border-border rounded px-2 py-1 w-20 text-right bg-white" /></td>
                        <td className="px-3 py-1.5 text-center">
                          <label className="cursor-pointer text-[10px] text-primary-600"><Upload size={12} /><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) setNewFile(e.target.files[0]); }} /></label>
                        </td>
                        <td className="px-3 py-1.5 text-center text-text-muted">-</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-0.5">
                            <button onClick={addInvoice} className="text-green-600"><Check size={14} /></button>
                            <button onClick={() => { setShowAddRow(false); setNewFile(null); }} className="text-text-muted"><X size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {filtered.map(renderRow)}
                    {filtered.length === 0 && !showAddRow && <tr><td colSpan={9} className="text-center py-8 text-text-muted text-sm">No invoices match your filters</td></tr>}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-surface-dim">
                        <td colSpan={5} className="px-3 py-2.5 font-bold text-xs">Total ({filtered.length} invoices)</td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-sm">{fmt(totalAmount)}</td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden">
                {filtered.map(renderCard)}
                {filtered.length === 0 && !showAddRow && <p className="text-center py-8 text-text-muted text-sm">No invoices match your filters</p>}
                {filtered.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 bg-surface-dim border-t-2 border-border">
                    <span className="text-xs font-bold">{filtered.length} invoices</span>
                    <span className="text-sm font-bold tabular-nums">{fmt(totalAmount)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {previewUrl && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4" onClick={() => setPreviewUrl(null)}>
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-text text-sm sm:text-base">Invoice Preview</h3>
              <button onClick={() => setPreviewUrl(null)} className="p-1.5 text-text-muted hover:text-text"><X size={20} /></button>
            </div>
            <div className="p-2 sm:p-4 overflow-auto max-h-[80vh]">
              {previewUrl.endsWith(".pdf") ? <iframe src={previewUrl} className="w-full h-[70vh] rounded-lg border" /> : <img src={previewUrl} alt="Invoice" className="max-w-full mx-auto rounded-lg" />}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
