"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        router.push("/dashboard");
      } else if (res.status === 429) {
        setError("Too many login attempts. Please try again later.");
      } else {
        setError(data.error || "Invalid email or password");
      }
    } catch {
      setError("Connection error. Please try again.");
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg">
            <span className="text-3xl font-bold text-white">E</span>
          </div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight">
            ElioPay<sup className="text-sm font-medium align-super ml-0.5 opacity-60">™</sup>
          </h1>
          <p className="text-primary-200 mt-2 text-sm">Dental Payslip Portal</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl p-8 space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-text-muted mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition text-sm"
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text-muted mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition text-sm"
              placeholder="Password"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-danger text-sm font-medium text-center bg-red-50 p-2 rounded-lg">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition disabled:opacity-50 text-sm"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p className="text-primary-200 text-xs text-center mt-4 opacity-70">
          Secure payslip management system
        </p>
      </div>
    </div>
  );
}
