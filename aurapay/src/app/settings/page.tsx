"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Save, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setSettings(d.settings || {}));
  }, []);

  async function save() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function update(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
      <h2 className="font-semibold text-text">{title}</h2>
      {children}
    </div>
  );

  const Field = ({ label, k, type = "text", placeholder = "" }: { label: string; k: string; type?: string; placeholder?: string }) => (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      <input
        type={type}
        value={settings[k] || ""}
        onChange={(e) => update(k, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
      />
    </div>
  );

  return (
    <Shell>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Settings</h1>
            <p className="text-sm text-text-muted mt-0.5">Configure AuraPay system settings</p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? "Saved!" : <><Save size={16} /> Save</>}
          </button>
        </div>

        <Section title="Practice">
          <Field label="Practice Name" k="practice_name" placeholder="Aura Dental Clinic" />
        </Section>

        <Section title="Calculation Rates">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Therapy Rate (per minute)" k="therapy_rate" type="number" />
            <Field label="Lab Bill Split (0.5 = 50%)" k="lab_bill_split" type="number" />
            <Field label="Finance Fee Split" k="finance_fee_split" type="number" />
          </div>
          <p className="text-xs text-text-subtle">Finance fee rates by term:</p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="3 months (%)" k="finance_rate_3m" type="number" />
            <Field label="6 months (%)" k="finance_rate_6m" type="number" />
            <Field label="10 months (%)" k="finance_rate_10m" type="number" />
            <Field label="12 months (%)" k="finance_rate_12m" type="number" />
          </div>
        </Section>

        <Section title="Email (SMTP)">
          <div className="grid grid-cols-2 gap-4">
            <Field label="SMTP Host" k="smtp_host" placeholder="smtp.gmail.com" />
            <Field label="SMTP Port" k="smtp_port" placeholder="587" />
            <Field label="SMTP Username" k="smtp_user" placeholder="you@gmail.com" />
            <Field label="SMTP Password" k="smtp_pass" type="password" placeholder="App password" />
            <div className="col-span-2">
              <Field label="From Address" k="email_from" placeholder="payslips@aurapay.cloud" />
            </div>
          </div>
          <p className="text-xs text-text-subtle">
            For Gmail, use an App Password (not your regular password). Enable 2FA first, then generate at myaccount.google.com.
          </p>
        </Section>
      </div>
    </Shell>
  );
}
