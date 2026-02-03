"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Plus, Pencil, X, Check } from "lucide-react";

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

  useEffect(() => { loadDentists(); }, []);

  async function loadDentists() {
    const r = await fetch("/api/dentists");
    const d = await r.json();
    setDentists(d.dentists || []);
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
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Dentists</h1>
            <p className="text-sm text-text-muted mt-0.5">Manage dentist profiles, splits, and rates</p>
          </div>
          <button
            onClick={() => { setEditing({ ...empty }); setIsNew(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition"
          >
            <Plus size={16} /> Add Dentist
          </button>
        </div>

        {/* Edit modal */}
        {editing && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{isNew ? "Add Dentist" : "Edit Dentist"}</h2>
                <button onClick={() => { setEditing(null); setIsNew(false); }} className="text-text-muted hover:text-text">
                  <X size={20} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
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

        {/* Table */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-dim border-b border-border">
                <th className="text-left px-5 py-3 font-medium text-text-muted">Name</th>
                <th className="text-left px-5 py-3 font-medium text-text-muted">Email</th>
                <th className="text-center px-5 py-3 font-medium text-text-muted">Split</th>
                <th className="text-center px-5 py-3 font-medium text-text-muted">NHS</th>
                <th className="text-center px-5 py-3 font-medium text-text-muted">UDA Rate</th>
                <th className="text-center px-5 py-3 font-medium text-text-muted">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dentists.map((d) => (
                <tr key={d.id} className="hover:bg-surface-dim transition">
                  <td className="px-5 py-3 font-medium text-text">{d.name}</td>
                  <td className="px-5 py-3 text-text-muted">{d.email || "-"}</td>
                  <td className="px-5 py-3 text-center">{d.split_percentage}%</td>
                  <td className="px-5 py-3 text-center">
                    {d.is_nhs ? <Check size={16} className="mx-auto text-success" /> : <span className="text-text-subtle">-</span>}
                  </td>
                  <td className="px-5 py-3 text-center">{d.uda_rate > 0 ? `£${d.uda_rate}` : "-"}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${d.active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {d.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
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
