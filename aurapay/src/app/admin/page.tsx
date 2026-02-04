"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import {
  Shield, Users, Building2, FileText, UserPlus, Pencil, Trash2, X, Loader2, Check
} from "lucide-react";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  clinic_id: number | null;
  clinic_name: string | null;
  is_super_admin: boolean;
  created_at: string;
}

interface Clinic {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  active: number;
  created_at: string;
}

interface Stats {
  totalClinics: number;
  activeClinics: number;
  totalUsers: number;
  superAdmins: number;
  totalPayslips: number;
  totalDentists: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);

  // Modal state
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    role: "manager",
    clinic_id: null as number | null,
  });

  useEffect(() => {
    fetchAdminData();
  }, []);

  async function fetchAdminData() {
    try {
      const res = await fetch("/api/admin");
      if (res.status === 403) {
        router.replace("/dashboard");
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch admin data");

      const data = await res.json();
      setStats(data.stats);
      setUsers(data.users);
      setClinics(data.clinics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }

  function openCreateUser() {
    setEditingUser(null);
    setFormData({ email: "", password: "", name: "", role: "manager", clinic_id: null });
    setShowUserModal(true);
  }

  function openEditUser(user: User) {
    setEditingUser(user);
    setFormData({
      email: user.email,
      password: "",
      name: user.name,
      role: user.role,
      clinic_id: user.clinic_id,
    });
    setShowUserModal(true);
  }

  async function handleSaveUser() {
    setSaving(true);
    try {
      const url = "/api/admin/users";
      const method = editingUser ? "PUT" : "POST";
      const body = editingUser
        ? { id: editingUser.id, ...formData, password: formData.password || undefined }
        : formData;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save user");
      }

      setShowUserModal(false);
      fetchAdminData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save user");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteUser(user: User) {
    if (!confirm(`Are you sure you want to delete ${user.name}?`)) return;

    try {
      const res = await fetch(`/api/admin/users?id=${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete user");
      }
      fetchAdminData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 text-amber-700 rounded-lg flex items-center justify-center">
              <Shield size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text">Admin Zone</h1>
              <p className="text-sm text-text-muted">ElioPay platform management</p>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={<Building2 size={20} />} label="Clinics" value={stats.totalClinics} color="blue" />
            <StatCard icon={<Users size={20} />} label="Users" value={stats.totalUsers} color="green" />
            <StatCard icon={<FileText size={20} />} label="Payslips" value={stats.totalPayslips} color="purple" />
            <StatCard icon={<Shield size={20} />} label="Super Admins" value={stats.superAdmins} color="amber" />
          </div>
        )}

        {/* Users Section */}
        <div className="bg-white rounded-xl border border-border">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-text flex items-center gap-2">
              <Users size={18} /> User Management
            </h2>
            <button
              onClick={openCreateUser}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition"
            >
              <UserPlus size={16} /> Add User
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-dim text-text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Clinic</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-dim/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text">{u.name}</span>
                        {u.is_super_admin && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded">
                            SUPER
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                        u.role === "owner" ? "bg-purple-100 text-purple-700" :
                        u.role === "manager" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">{u.clinic_name || "—"}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditUser(u)}
                          className="p-1.5 text-text-muted hover:text-primary-600 hover:bg-primary-50 rounded transition"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {!u.is_super_admin && (
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded transition"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* User Modal */}
        {showUserModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-text">
                  {editingUser ? "Edit User" : "Create User"}
                </h3>
                <button onClick={() => setShowUserModal(false)} className="text-text-muted hover:text-text">
                  <X size={20} />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder="John Smith"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder="john@clinic.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Password {editingUser && "(leave blank to keep current)"}
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder={editingUser ? "••••••••" : "Min 8 characters"}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Clinic (optional)</label>
                  <select
                    value={formData.clinic_id || ""}
                    onChange={(e) => setFormData({ ...formData, clinic_id: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  >
                    <option value="">No clinic assigned</option>
                    {clinics.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-2">
                <button
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveUser}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {editingUser ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    purple: "bg-purple-50 text-purple-600",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${colors[color]}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-text">{value.toLocaleString()}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}
