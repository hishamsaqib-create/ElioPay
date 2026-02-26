"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import {
  Plus, Trash2, Download, Check, X, Loader2, Edit3, Save, Building2
} from "lucide-react";

interface SavedEntity {
  id: number; name: string; account_name: string; sort_code: string; account_number: string;
}

interface UnpaidBill {
  id: number; entity_name: string; type: string; amount: number; date: string;
  description: string; account_name: string; sort_code: string; account_number: string;
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function BulkPaymentsPage() {
  const [labs, setLabs] = useState<SavedEntity[]>([]);
  const [suppliers, setSuppliers] = useState<SavedEntity[]>([]);
  const [unpaidLabBills, setUnpaidLabBills] = useState<UnpaidBill[]>([]);
  const [unpaidSupplierInvoices, setUnpaidSupplierInvoices] = useState<UnpaidBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLab, setSelectedLab] = useState<Set<number>>(new Set());
  const [selectedSupplier, setSelectedSupplier] = useState<Set<number>>(new Set());
  const [editingEntity, setEditingEntity] = useState<{ type: string; id: number } | null>(null);
  const [editForm, setEditForm] = useState({ name: "", account_name: "", sort_code: "", account_number: "" });
  const [showAddEntity, setShowAddEntity] = useState<string | null>(null);
  const [newEntity, setNewEntity] = useState({ name: "", account_name: "", sort_code: "", account_number: "" });
  const [activeTab, setActiveTab] = useState<"bank_details" | "unpaid">("bank_details");
  const [marking, setMarking] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [entitiesRes, unpaidRes] = await Promise.all([
      fetch("/api/bills/saved-entities"),
      fetch("/api/bills/bulk-payment"),
    ]);

    if (entitiesRes.ok) {
      const d = await entitiesRes.json();
      setLabs(d.labs || []);
      setSuppliers(d.suppliers || []);
    }
    if (unpaidRes.ok) {
      const d = await unpaidRes.json();
      setUnpaidLabBills(d.lab_bills || []);
      setUnpaidSupplierInvoices(d.supplier_invoices || []);
    }
    setLoading(false);
  }

  async function saveEntity(type: string, id: number) {
    await fetch("/api/bills/saved-entities", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id, ...editForm }),
    });
    setEditingEntity(null);
    load();
  }

  async function addEntity(type: string) {
    if (!newEntity.name.trim()) return;
    await fetch("/api/bills/saved-entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...newEntity }),
    });
    setNewEntity({ name: "", account_name: "", sort_code: "", account_number: "" });
    setShowAddEntity(null);
    load();
  }

  async function deleteEntity(type: string, id: number) {
    if (!confirm(`Delete this ${type}?`)) return;
    await fetch(`/api/bills/saved-entities?type=${type}&id=${id}`, { method: "DELETE" });
    load();
  }

  async function markPaid(type: string, ids: number[]) {
    if (ids.length === 0) return;
    setMarking(true);
    await fetch("/api/bills/bulk-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_paid", type, ids }),
    });
    if (type === "lab") setSelectedLab(new Set());
    else setSelectedSupplier(new Set());
    setMarking(false);
    load();
  }

  async function generateCsv() {
    // Aggregate unpaid bills by entity, summing amounts
    const selectedBills = [
      ...unpaidLabBills.filter(b => selectedLab.has(b.id)),
      ...unpaidSupplierInvoices.filter(b => selectedSupplier.has(b.id)),
    ];

    if (selectedBills.length === 0) {
      alert("Please select bills to include in the bulk payment.");
      return;
    }

    // Group by entity name and aggregate
    const grouped = new Map<string, { account_name: string; sort_code: string; account_number: string; amount: number; entity_name: string }>();
    for (const bill of selectedBills) {
      const key = bill.entity_name;
      const existing = grouped.get(key);
      if (existing) {
        existing.amount += bill.amount;
      } else {
        grouped.set(key, {
          account_name: bill.account_name || bill.entity_name,
          sort_code: bill.sort_code || "",
          account_number: bill.account_number || "",
          amount: bill.amount,
          entity_name: bill.entity_name,
        });
      }
    }

    const payments = Array.from(grouped.values()).map(p => ({
      ...p,
      reference: p.entity_name,
    }));

    const res = await fetch("/api/bills/bulk-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate_csv", payments }),
    });

    if (res.ok) {
      const data = await res.json();
      const blob = new Blob([data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bulk-payment-${new Date().toISOString().substring(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function toggleSelection(type: string, id: number) {
    if (type === "lab") {
      const next = new Set(selectedLab);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedLab(next);
    } else {
      const next = new Set(selectedSupplier);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedSupplier(next);
    }
  }

  function selectAll(type: string) {
    if (type === "lab") {
      if (selectedLab.size === unpaidLabBills.length) setSelectedLab(new Set());
      else setSelectedLab(new Set(unpaidLabBills.map(b => b.id)));
    } else {
      if (selectedSupplier.size === unpaidSupplierInvoices.length) setSelectedSupplier(new Set());
      else setSelectedSupplier(new Set(unpaidSupplierInvoices.map(b => b.id)));
    }
  }

  function renderEntityTable(type: string, entities: SavedEntity[]) {
    return (
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-dim">
          <h3 className="font-semibold text-text capitalize">{type === "lab" ? "Labs" : "Suppliers"} Bank Details</h3>
          <button onClick={() => setShowAddEntity(type)} className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium">
            <Plus size={14} /> Add {type === "lab" ? "Lab" : "Supplier"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Account Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Sort Code</th>
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Account Number</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {showAddEntity === type && (
                <tr className="border-b border-border bg-primary-50">
                  <td className="px-4 py-2"><input type="text" placeholder="Name" value={newEntity.name} onChange={e => setNewEntity({ ...newEntity, name: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /></td>
                  <td className="px-4 py-2"><input type="text" placeholder="Account name" value={newEntity.account_name} onChange={e => setNewEntity({ ...newEntity, account_name: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /></td>
                  <td className="px-4 py-2"><input type="text" placeholder="00-00-00" value={newEntity.sort_code} onChange={e => setNewEntity({ ...newEntity, sort_code: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /></td>
                  <td className="px-4 py-2"><input type="text" placeholder="12345678" value={newEntity.account_number} onChange={e => setNewEntity({ ...newEntity, account_number: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /></td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => addEntity(type)} className="text-green-600 hover:text-green-700"><Check size={16} /></button>
                      <button onClick={() => setShowAddEntity(null)} className="text-text-muted hover:text-text"><X size={16} /></button>
                    </div>
                  </td>
                </tr>
              )}
              {entities.length === 0 && !showAddEntity ? (
                <tr><td colSpan={5} className="text-center py-6 text-text-muted">No {type === "lab" ? "labs" : "suppliers"} added yet</td></tr>
              ) : (
                entities.map(entity => {
                  const isEditing = editingEntity?.type === type && editingEntity?.id === entity.id;
                  return (
                    <tr key={entity.id} className="border-b border-border last:border-0 hover:bg-surface-dim transition">
                      <td className="px-4 py-2.5">
                        {isEditing ? <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /> : <span className="font-medium">{entity.name}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? <input type="text" value={editForm.account_name} onChange={e => setEditForm({ ...editForm, account_name: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /> : <span className="text-text-subtle">{entity.account_name || "-"}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? <input type="text" value={editForm.sort_code} onChange={e => setEditForm({ ...editForm, sort_code: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /> : <span className="font-mono text-text-subtle">{entity.sort_code || "-"}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? <input type="text" value={editForm.account_number} onChange={e => setEditForm({ ...editForm, account_number: e.target.value })} className="text-sm border border-border rounded px-2 py-1 w-full bg-white" /> : <span className="font-mono text-text-subtle">{entity.account_number || "-"}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => saveEntity(type, entity.id)} className="text-green-600 hover:text-green-700"><Save size={14} /></button>
                            <button onClick={() => setEditingEntity(null)} className="text-text-muted hover:text-text"><X size={14} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setEditingEntity({ type, id: entity.id }); setEditForm({ name: entity.name, account_name: entity.account_name, sort_code: entity.sort_code, account_number: entity.account_number }); }} className="text-text-muted hover:text-primary-600"><Edit3 size={14} /></button>
                            <button onClick={() => deleteEntity(type, entity.id)} className="text-text-muted hover:text-danger"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderUnpaidTable(type: string, bills: UnpaidBill[], selected: Set<number>) {
    const total = bills.reduce((s, b) => s + b.amount, 0);
    const selectedTotal = bills.filter(b => selected.has(b.id)).reduce((s, b) => s + b.amount, 0);

    return (
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-dim">
          <div>
            <h3 className="font-semibold text-text">Unpaid {type === "lab" ? "Lab Bills" : "Supplier Invoices"}</h3>
            <p className="text-xs text-text-muted mt-0.5">{bills.length} unpaid totalling {fmt(total)}{selected.size > 0 && ` | ${selected.size} selected: ${fmt(selectedTotal)}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button onClick={() => markPaid(type, Array.from(selected))} disabled={marking}
                className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition">
                {marking ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Mark {selected.size} Paid
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 w-8">
                  <input type="checkbox" checked={selected.size === bills.length && bills.length > 0}
                    onChange={() => selectAll(type)} className="rounded" />
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Date</th>
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Description</th>
                <th className="text-left px-4 py-2.5 font-medium text-text-muted">Bank Details</th>
                <th className="text-right px-4 py-2.5 font-medium text-text-muted">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-text-muted">All {type === "lab" ? "lab bills" : "supplier invoices"} are paid</td></tr>
              ) : (
                bills.map(bill => (
                  <tr key={bill.id} className={`border-b border-border last:border-0 hover:bg-surface-dim transition ${selected.has(bill.id) ? "bg-primary-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={selected.has(bill.id)} onChange={() => toggleSelection(type, bill.id)} className="rounded" />
                    </td>
                    <td className="px-4 py-2.5 font-medium">{bill.entity_name}</td>
                    <td className="px-4 py-2.5 text-text-subtle">{bill.date}</td>
                    <td className="px-4 py-2.5 text-text-subtle max-w-[200px] truncate">{bill.description || "-"}</td>
                    <td className="px-4 py-2.5">
                      {bill.sort_code && bill.account_number ? (
                        <span className="font-mono text-xs text-text-subtle">{bill.sort_code} / {bill.account_number}</span>
                      ) : (
                        <span className="text-xs text-amber-600">No bank details</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{fmt(bill.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <Shell>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Bulk Payments</h1>
            <p className="text-sm text-text-muted mt-1">Manage bank details and generate bulk payment files for Starling</p>
          </div>
          {activeTab === "unpaid" && (selectedLab.size > 0 || selectedSupplier.size > 0) && (
            <button onClick={generateCsv} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition">
              <Download size={16} /> Export Starling CSV
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-surface-dim rounded-lg p-1">
          <button onClick={() => setActiveTab("bank_details")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "bank_details" ? "bg-white text-text shadow-sm" : "text-text-muted hover:text-text"}`}>
            <Building2 size={16} /> Bank Details
          </button>
          <button onClick={() => setActiveTab("unpaid")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "unpaid" ? "bg-white text-text shadow-sm" : "text-text-muted hover:text-text"}`}>
            <Download size={16} /> Unpaid Bills
            {(unpaidLabBills.length + unpaidSupplierInvoices.length) > 0 && (
              <span className="bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded-full font-semibold">
                {unpaidLabBills.length + unpaidSupplierInvoices.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary-600" />
          </div>
        ) : activeTab === "bank_details" ? (
          <div className="space-y-6">
            {renderEntityTable("lab", labs)}
            {renderEntityTable("supplier", suppliers)}
          </div>
        ) : (
          <div className="space-y-6">
            {renderUnpaidTable("lab", unpaidLabBills, selectedLab)}
            {renderUnpaidTable("supplier", unpaidSupplierInvoices, selectedSupplier)}
          </div>
        )}
      </div>
    </Shell>
  );
}
