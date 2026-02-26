"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import {
  Shield, Users, Building2, FileText, UserPlus, Pencil, Trash2, X, Loader2, Check,
  Plus, Clock, Activity, ChevronDown, ChevronRight, Eye
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
  phone: string | null;
  active: number;
  created_at: string;
  user_count?: number;
  dentist_count?: number;
  dentally_site_id?: string | null;
}

interface AuditEntry {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: Record<string, unknown>;
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

type Tab = "users" | "clinics" | "audit";

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("users");

  // User Modal state
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [userFormData, setUserFormData] = useState({
    email: "",
    password: "",
    name: "",
    role: "manager",
    clinic_id: null as number | null,
  });

  // Clinic Modal state
  const [showClinicModal, setShowClinicModal] = useState(false);
  const [editingClinic, setEditingClinic] = useState<Clinic | null>(null);
  const [clinicSaving, setClinicSaving] = useState(false);
  const [clinicFormData, setClinicFormData] = useState({
    name: "",
    email: "",
    phone: "",
    dentally_site_id: "",
    dentally_api_token: "",
  });

  // Audit Details Modal
  const [showAuditDetails, setShowAuditDetails] = useState<AuditEntry | null>(null);

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

  async function fetchAuditLog() {
    try {
      const res = await fetch("/api/admin/audit?limit=100");
      if (res.ok) {
        const data = await res.json();
        setAuditLog(data.entries);
      }
    } catch (err) {
      console.error("Failed to fetch audit log:", err);
    }
  }

  useEffect(() => {
    if (activeTab === "audit" && auditLog.length === 0) {
      fetchAuditLog();
    }
  }, [activeTab]);

  // User functions
  function openCreateUser() {
    setEditingUser(null);
    setUserFormData({ email: "", password: "", name: "", role: "manager", clinic_id: null });
    setShowUserModal(true);
  }

  function openEditUser(user: User) {
    setEditingUser(user);
    setUserFormData({
      email: user.email,
      password: "",
      name: user.name,
      role: user.role,
      clinic_id: user.clinic_id,
    });
    setShowUserModal(true);
  }

  async function handleSaveUser() {
    setUserSaving(true);
    try {
      const url = "/api/admin/users";
      const method = editingUser ? "PUT" : "POST";
      const body = editingUser
        ? { id: editingUser.id, ...userFormData, password: userFormData.password || undefined }
        : userFormData;

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
      setUserSaving(false);
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

  // Clinic functions
  function openCreateClinic() {
    setEditingClinic(null);
    setClinicFormData({ name: "", email: "", phone: "", dentally_site_id: "", dentally_api_token: "" });
    setShowClinicModal(true);
  }

  function openEditClinic(clinic: Clinic) {
    setEditingClinic(clinic);
    setClinicFormData({
      name: clinic.name,
      email: clinic.email || "",
      phone: clinic.phone || "",
      dentally_site_id: clinic.dentally_site_id || "",
      dentally_api_token: "",
    });
    setShowClinicModal(true);
  }

  async function handleSaveClinic() {
    setClinicSaving(true);
    try {
      const url = "/api/admin/clinics";
      const method = editingClinic ? "PUT" : "POST";
      const body = editingClinic
        ? { id: editingClinic.id, ...clinicFormData }
        : clinicFormData;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save clinic");
      }

      setShowClinicModal(false);
      fetchAdminData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save clinic");
    } finally {
      setClinicSaving(false);
    }
  }

  async function handleDeleteClinic(clinic: Clinic) {
    if (!confirm(`Are you sure you want to delete ${clinic.name}?`)) return;

    try {
      const res = await fetch(`/api/admin/clinics?id=${clinic.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete clinic");
      }
      fetchAdminData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete clinic");
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
              <p className="text-sm text-text-muted">AuraPay platform management</p>
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

        {/* Tabs */}
        <div className="border-b border-border">
          <nav className="flex gap-1">
            <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")} icon={<Users size={16} />}>
              Users
            </TabButton>
            <TabButton active={activeTab === "clinics"} onClick={() => setActiveTab("clinics")} icon={<Building2 size={16} />}>
              Clinics
            </TabButton>
            <TabButton active={activeTab === "audit"} onClick={() => setActiveTab("audit")} icon={<Activity size={16} />}>
              Audit Log
            </TabButton>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === "users" && (
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
        )}

        {activeTab === "clinics" && (
          <div className="bg-white rounded-xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-text flex items-center gap-2">
                <Building2 size={18} /> Clinic Management
              </h2>
              <button
                onClick={openCreateClinic}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition"
              >
                <Plus size={16} /> Add Clinic
              </button>
            </div>

            {clinics.length === 0 ? (
              <div className="p-8 text-center text-text-muted">
                <Building2 size={32} className="mx-auto mb-2 opacity-50" />
                <p>No clinics yet. Create your first clinic to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-dim text-text-muted">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Clinic Name</th>
                      <th className="text-left px-4 py-3 font-medium">Email</th>
                      <th className="text-left px-4 py-3 font-medium">Dentally Site ID</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium">Created</th>
                      <th className="text-right px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clinics.map((c) => (
                      <tr key={c.id} className="hover:bg-surface-dim/50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-text">{c.name}</span>
                        </td>
                        <td className="px-4 py-3 text-text-muted">{c.email || "—"}</td>
                        <td className="px-4 py-3 text-text-muted font-mono text-xs">{c.dentally_site_id || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                            c.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                          }`}>
                            {c.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-text-muted text-xs">
                          {new Date(c.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditClinic(c)}
                              className="p-1.5 text-text-muted hover:text-primary-600 hover:bg-primary-50 rounded transition"
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteClinic(c)}
                              className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded transition"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "audit" && (
          <div className="bg-white rounded-xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-text flex items-center gap-2">
                <Activity size={18} /> Audit Log
              </h2>
              <button
                onClick={fetchAuditLog}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-text text-sm font-medium rounded-lg transition"
              >
                <Clock size={16} /> Refresh
              </button>
            </div>

            {auditLog.length === 0 ? (
              <div className="p-8 text-center text-text-muted">
                <Activity size={32} className="mx-auto mb-2 opacity-50" />
                <p>No audit log entries yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-dim text-text-muted">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                      <th className="text-left px-4 py-3 font-medium">User</th>
                      <th className="text-left px-4 py-3 font-medium">Action</th>
                      <th className="text-left px-4 py-3 font-medium">Entity</th>
                      <th className="text-right px-4 py-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditLog.map((entry) => (
                      <tr key={entry.id} className="hover:bg-surface-dim/50">
                        <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-text">{entry.user_name || "System"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <ActionBadge action={entry.action} />
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {entry.entity_type} {entry.entity_id ? `#${entry.entity_id}` : ""}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setShowAuditDetails(entry)}
                            className="p-1.5 text-text-muted hover:text-primary-600 hover:bg-primary-50 rounded transition"
                            title="View Details"
                          >
                            <Eye size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

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
                    value={userFormData.name}
                    onChange={(e) => setUserFormData({ ...userFormData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder="John Smith"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={userFormData.email}
                    onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
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
                    value={userFormData.password}
                    onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder={editingUser ? "••••••••" : "Min 8 characters"}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Role</label>
                  <select
                    value={userFormData.role}
                    onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })}
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
                    value={userFormData.clinic_id || ""}
                    onChange={(e) => setUserFormData({ ...userFormData, clinic_id: e.target.value ? Number(e.target.value) : null })}
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
                  disabled={userSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                >
                  {userSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {editingUser ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Clinic Modal */}
        {showClinicModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-text">
                  {editingClinic ? "Edit Clinic" : "Create Clinic"}
                </h3>
                <button onClick={() => setShowClinicModal(false)} className="text-text-muted hover:text-text">
                  <X size={20} />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Clinic Name *</label>
                  <input
                    type="text"
                    value={clinicFormData.name}
                    onChange={(e) => setClinicFormData({ ...clinicFormData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder="Aura Dental"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={clinicFormData.email}
                    onChange={(e) => setClinicFormData({ ...clinicFormData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder="info@clinic.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Phone</label>
                  <input
                    type="text"
                    value={clinicFormData.phone}
                    onChange={(e) => setClinicFormData({ ...clinicFormData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    placeholder="+44 1onal number"
                  />
                </div>

                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">Dentally Integration</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Dentally Site ID</label>
                      <input
                        type="text"
                        value={clinicFormData.dentally_site_id}
                        onChange={(e) => setClinicFormData({ ...clinicFormData, dentally_site_id: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary-500 outline-none"
                        placeholder="e.g. 12345"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">
                        Dentally API Token {editingClinic && "(leave blank to keep current)"}
                      </label>
                      <input
                        type="password"
                        value={clinicFormData.dentally_api_token}
                        onChange={(e) => setClinicFormData({ ...clinicFormData, dentally_api_token: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-2">
                <button
                  onClick={() => setShowClinicModal(false)}
                  className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveClinic}
                  disabled={clinicSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                >
                  {clinicSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {editingClinic ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Audit Details Modal */}
        {showAuditDetails && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-text">Audit Entry Details</h3>
                <button onClick={() => setShowAuditDetails(null)} className="text-text-muted hover:text-text">
                  <X size={20} />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-text-muted">Timestamp</label>
                    <p className="font-medium">{new Date(showAuditDetails.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">User</label>
                    <p className="font-medium">{showAuditDetails.user_name || "System"}</p>
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">Action</label>
                    <p><ActionBadge action={showAuditDetails.action} /></p>
                  </div>
                  <div>
                    <label className="text-xs text-text-muted">Entity</label>
                    <p className="font-medium">{showAuditDetails.entity_type} #{showAuditDetails.entity_id}</p>
                  </div>
                </div>

                <div className="border-t border-border pt-3">
                  <label className="text-xs text-text-muted block mb-2">Details</label>
                  <pre className="bg-surface-dim rounded-lg p-3 text-xs overflow-auto max-h-48 font-mono">
                    {JSON.stringify(showAuditDetails.details, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="p-4 border-t border-border flex justify-end">
                <button
                  onClick={() => setShowAuditDetails(null)}
                  className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text transition"
                >
                  Close
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

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
        active
          ? "border-primary-600 text-primary-600"
          : "border-transparent text-text-muted hover:text-text hover:border-gray-300"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    user_created: "bg-green-100 text-green-700",
    user_updated: "bg-blue-100 text-blue-700",
    user_deleted: "bg-red-100 text-red-700",
    clinic_created: "bg-green-100 text-green-700",
    clinic_updated: "bg-blue-100 text-blue-700",
    clinic_deleted: "bg-red-100 text-red-700",
    login: "bg-gray-100 text-gray-700",
    logout: "bg-gray-100 text-gray-700",
  };

  const labels: Record<string, string> = {
    user_created: "User Created",
    user_updated: "User Updated",
    user_deleted: "User Deleted",
    clinic_created: "Clinic Created",
    clinic_updated: "Clinic Updated",
    clinic_deleted: "Clinic Deleted",
    login: "Login",
    logout: "Logout",
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[action] || "bg-gray-100 text-gray-700"}`}>
      {labels[action] || action}
    </span>
  );
}
