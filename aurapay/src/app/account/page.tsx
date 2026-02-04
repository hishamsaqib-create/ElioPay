"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { User, Mail, Shield, Key, Loader2, Save } from "lucide-react";

interface UserData {
  id: number;
  name: string;
  email: string;
  role: string;
}

export default function AccountPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) {
        setUser(d.user);
        setName(d.user.name);
        setEmail(d.user.email);
      }
    });
  }, []);

  async function updateProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setMessage({ type: "success", text: "Profile updated successfully" });
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to update profile" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update profile" });
    }

    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match" });
      return;
    }

    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "Password must be at least 8 characters" });
      return;
    }

    setChangingPassword(true);

    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Password changed successfully" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to change password" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to change password" });
    }

    setChangingPassword(false);
    setTimeout(() => setMessage(null), 3000);
  }

  if (!user) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      </Shell>
    );
  }

  const roleLabel = user.role === "owner" ? "Owner" : user.role === "manager" ? "Manager" : "Viewer";
  const roleColor = user.role === "owner" ? "bg-purple-50 text-purple-700" : user.role === "manager" ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-700";

  return (
    <Shell>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text">Account</h1>
          <p className="text-sm text-text-muted mt-0.5">Manage your account settings</p>
        </div>

        {message && (
          <div
            className={`px-4 py-3 rounded-lg text-sm font-medium ${
              message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Profile Overview */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-2xl font-bold">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text">{user.name}</h2>
              <p className="text-sm text-text-muted">{user.email}</p>
              <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${roleColor}`}>
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Update Profile */}
        <form onSubmit={updateProfile} className="bg-white rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <User size={18} className="text-primary-600" />
            <h2 className="font-semibold text-text">Profile Information</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                required
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>

        {/* Change Password */}
        <form onSubmit={changePassword} className="bg-white rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Key size={18} className="text-primary-600" />
            <h2 className="font-semibold text-text">Change Password</h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                required
                minLength={8}
              />
            </div>
          </div>

          <p className="text-xs text-text-subtle">Password must be at least 8 characters long.</p>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={changingPassword}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              {changingPassword ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
              {changingPassword ? "Changing..." : "Change Password"}
            </button>
          </div>
        </form>

        {/* Account Info */}
        <div className="bg-surface-dim rounded-xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={18} className="text-text-muted" />
            <h2 className="font-semibold text-text">Account Security</h2>
          </div>
          <div className="space-y-2 text-sm text-text-muted">
            <p>• Your session is secured with HTTP-only cookies</p>
            <p>• All data is encrypted in transit using TLS</p>
            <p>• Passwords are hashed using bcrypt with salt</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
