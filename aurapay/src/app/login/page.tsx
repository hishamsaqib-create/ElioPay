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
    <div className="min-h-screen flex items-center justify-center bg-surface-dim">
      <div className="w-full max-w-[360px] px-4">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-primary-500 to-primary-700 rounded-[18px] flex items-center justify-center shadow-lg shadow-primary-500/20">
            <span className="text-3xl font-bold text-white">A</span>
          </div>
          <h1 className="text-[28px] font-semibold text-text tracking-tight">
            AuraPay
          </h1>
          <p className="text-text-muted mt-1 text-sm">Dental Payslip Portal</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg shadow-black/5 border border-border/60 p-7 space-y-4">
          <div>
            <label htmlFor="email" className="block text-[13px] font-medium text-text mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-border rounded-xl bg-surface-dim/50 text-sm placeholder:text-text-subtle"
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-[13px] font-medium text-text mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-border rounded-xl bg-surface-dim/50 text-sm placeholder:text-text-subtle"
              placeholder="Password"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-danger text-[13px] font-medium text-center bg-red-50 p-2.5 rounded-xl">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-semibold rounded-xl transition-all disabled:opacity-50 text-sm shadow-sm"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Signing in...
              </span>
            ) : "Sign In"}
          </button>
        </form>
        <p className="text-text-subtle text-xs text-center mt-5">
          Secure payslip management system
        </p>
      </div>
    </div>
  );
}
