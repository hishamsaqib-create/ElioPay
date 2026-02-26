"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Plus, Pencil, X, Check, RefreshCw, AlertCircle } from "lucide-react";

interface Dentist {
  id: number; name: string; email: string | null; split_percentage: number;
  is_nhs: number; uda_rate: number; performer_number: string | null;
  practitioner_id: string | null; active: number;
}

const empty: Partial<Dentist> = {
  name: "", email: "", split_percentage: 50, is_nhs: 0, uda_rate: 0,
  performer_number: "", practitioner_id: "", active: 1,
};

export default function DentistsPage() {
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [editing, setEditing] = useState<Partial<Dentist> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [dentallyIds, setDentallyIds] = useState<string[]>([]);
  const [loadingIds, setLoadingIds] = useState(false);

  useEffect(() => { loadDentists(); }, []);

  async function loadDentists() {
    const r = await fetch("/api/dentists");
    const d = await r.json();
    setDentists(d.dentists || []);
  }

  async function fetchDentallyIds() {
    setLoadingIds(true);
    try {
      const r = await fetch("/api/dentally/debug");
      const data = await r.json();
      if (data.raw_first_invoice) {
        // Extract practitioner IDs from the sample
        const ids: string[] = [];
        const inv = data.raw_first_invoice;
        if (inv.practitioner_id) ids.push(String(inv.practitioner_id));
        if (inv.practitioner) ids.push(String(inv.practitioner));
        if (inv.invoice_items) {
          for (const item of inv.invoice_items) {
            if (item.practitioner_id) ids.push(String(item.practitioner_id));
          }
        }
        setDentallyIds([...new Set(ids)]);
      }
    } catch (e) {
      console.error("Failed to fetch Dentally IDs", e);
    }
    setLoadingIds(false);
  }

  async function save() {
    if (!editing?.name) return;
    const method = isNew ? "POST" : "PUT";
    await fetch("/api/dentists", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setEditing(null);
    setIsNew(false);
    loadDentists();
  }

  return (
    <Shell>
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text">Dentists</h1>
            <p className="text-xs sm:text-sm text-text-muted mt-0.5">Manage dentist profiles, splits, and rates</p>
          </div>
          <button
            onClick={() => { setEditing({ ...empty }); setIsNew(true); }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition w-full sm:w-auto"
          >
            <Plus size={16} /> Add Dentist
          </button>
        </div>

        {/* Edit modal */}
        {editing && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{isNew ? "Add Dentist" : "Edit Dentist"}</h2>
                <button onClick={() => { setEditing(null); setIsNew(false); }} className="p-1.5 text-text-muted hover:text-text">
                  <X size={20} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-text-muted mb-1">Full Name</label>
                  <input
                    value={editing.name || ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={editing.email || ""}
                    onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Split %</label>
                  <input
                    type="number"
                    value={editing.split_percentage ?? 50}
                    onChange={(e) => setEditing({ ...editing, split_percentage: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">UDA Rate</label>
                  <input
                    type="number"
                    value={editing.uda_rate ?? 0}
                    onChange={(e) => setEditing({ ...editing, uda_rate: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Performer #</label>
                  <input
                    value={editing.performer_number || ""}
                    onChange={(e) => setEditing({ ...editing, performer_number: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Practitioner ID</label>
                  <input
                    value={editing.practitioner_id || ""}
                    onChange={(e) => setEditing({ ...editing, practitioner_id: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!editing.is_nhs}
                      onChange={(e) => setEditing({ ...editing, is_nhs: e.target.checked ? 1 : 0 })}
                      className="w-4 h-4 rounded border-border text-primary-600 focus:ring-primary-500"
                    />
                    NHS Dentist
                  </label>
                </div>
                {!isNew && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!editing.active}
                        onChange={(e) => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })}
                        className="w-4 h-4 rounded border-border text-primary-600 focus:ring-primary-500"
                      />
                      Active
                    </label>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setEditing(null); setIsNew(false); }}
                  className="px-4 py-2 text-sm text-text-muted hover:bg-surface-muted rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition"
                >
                  {isNew ? "Add Dentist" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dentally ID Helper */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">Dentally Practitioner IDs</p>
              <p className="text-xs text-amber-700 mt-1">
                Each dentist needs a Practitioner ID from Dentally to auto-fetch invoice data.
                Click &quot;Fetch from Dentally&quot; on a payslip to see which IDs are found.
                Then edit each dentist below to enter their correct ID.
              </p>
              <button
                onClick={fetchDentallyIds}
                disabled={loadingIds}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900"
              >
                <RefreshCw size={12} className={loadingIds ? "animate-spin" : ""} />
                {loadingIds ? "Checking..." : "Check Dentally connection"}
              </button>
              {dentallyIds.length > 0 && (
                <div className="mt-2 text-xs text-amber-700">
                  <span className="font-medium">Sample IDs from Dentally:</span> {dentallyIds.join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="bg-surface-dim border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-text-muted">Name</th>
                <th className="text-left px-4 py-3 font-medium text-text-muted">Email</th>
                <th className="text-center px-4 py-3 font-medium text-text-muted">Dentally ID</th>
                <th className="text-center px-4 py-3 font-medium text-text-muted">Split</th>
                <th className="text-center px-4 py-3 font-medium text-text-muted">NHS</th>
                <th className="text-center px-4 py-3 font-medium text-text-muted">UDA</th>
                <th className="text-center px-4 py-3 font-medium text-text-muted">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dentists.map((d) => (
                <tr key={d.id} className="hover:bg-surface-dim transition">
                  <td className="px-4 py-3 font-medium text-text">{d.name}</td>
                  <td className="px-4 py-3 text-text-muted text-xs">{d.email || "-"}</td>
                  <td className="px-4 py-3 text-center">
                    {d.practitioner_id ? (
                      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{d.practitioner_id}</code>
                    ) : (
                      <span className="text-xs text-amber-600 font-medium">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">{d.split_percentage}%</td>
                  <td className="px-4 py-3 text-center">
                    {d.is_nhs ? <Check size={16} className="mx-auto text-success" /> : <span className="text-text-subtle">-</span>}
                  </td>
                  <td className="px-4 py-3 text-center">{d.uda_rate > 0 ? `£${d.uda_rate}` : "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${d.active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {d.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setEditing({ ...d }); setIsNew(false); }}
                      className="text-text-subtle hover:text-primary-600 transition"
                    >
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
