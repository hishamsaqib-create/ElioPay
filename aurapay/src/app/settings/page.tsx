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
          <Field label="Practice Address" k="practice_address" placeholder="East Avenue, Billingham, TS23 1BY" />
        </Section>

        <Section title="Calculation Rates">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Therapy Rate (per min)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle text-sm">£</span>
                <input
                  type="number"
                  step="0.01"
                  value={settings.therapy_rate || "0.5833"}
                  onChange={(e) => update("therapy_rate", e.target.value)}
                  className="w-full pl-7 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <p className="text-[10px] text-text-subtle mt-1">Default: £0.5833 (£35/hour)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Lab Bill Split</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  value={settings.lab_bill_split || "0.50"}
                  onChange={(e) => update("lab_bill_split", e.target.value)}
                  className="w-full pr-8 pl-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle text-xs">= 50%</span>
              </div>
              <p className="text-[10px] text-text-subtle mt-1">Dentist pays this fraction</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Finance Fee Split</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  value={settings.finance_fee_split || "0.50"}
                  onChange={(e) => update("finance_fee_split", e.target.value)}
                  className="w-full pr-8 pl-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle text-xs">= 50%</span>
              </div>
              <p className="text-[10px] text-text-subtle mt-1">Dentist pays this fraction</p>
            </div>
          </div>
          <div className="pt-2 border-t border-border mt-2">
            <p className="text-xs font-medium text-text-muted mb-2">Tabeo Finance Rates (by term)</p>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] text-text-muted mb-1">3 months</label>
                <input type="number" step="0.001" value={settings.finance_rate_3m || "0.045"} onChange={(e) => update("finance_rate_3m", e.target.value)} className="w-full px-2 py-1.5 border border-border rounded-lg text-xs" placeholder="0.045" />
              </div>
              <div>
                <label className="block text-[10px] text-text-muted mb-1">12 months</label>
                <input type="number" step="0.001" value={settings.finance_rate_12m || "0.08"} onChange={(e) => update("finance_rate_12m", e.target.value)} className="w-full px-2 py-1.5 border border-border rounded-lg text-xs" placeholder="0.08" />
              </div>
              <div>
                <label className="block text-[10px] text-text-muted mb-1">36 months</label>
                <input type="number" step="0.001" value={settings.finance_rate_36m || "0.034"} onChange={(e) => update("finance_rate_36m", e.target.value)} className="w-full px-2 py-1.5 border border-border rounded-lg text-xs" placeholder="0.034" />
              </div>
              <div>
                <label className="block text-[10px] text-text-muted mb-1">60 months</label>
                <input type="number" step="0.001" value={settings.finance_rate_60m || "0.037"} onChange={(e) => update("finance_rate_60m", e.target.value)} className="w-full px-2 py-1.5 border border-border rounded-lg text-xs" placeholder="0.037" />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Dentally Integration">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Site ID" k="dentally_site_id" placeholder="212f9c01-f4f2-446d-b7a3-0162b135e9d3" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-muted mb-1">Therapist IDs (comma-separated)</label>
              <input
                type="text"
                value={settings.therapist_ids || "189342,189343,189349,189358,191534,209545,288298"}
                onChange={(e) => update("therapist_ids", e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none font-mono text-xs"
              />
              <p className="text-[10px] text-text-subtle mt-1">Invoices from these IDs are excluded (therapists/hygienists)</p>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-muted mb-1">NHS Amounts to Exclude (comma-separated)</label>
              <input
                type="text"
                value={settings.nhs_amounts || "27.40,75.30,326.70,47.90,299.30,251.40,23.80,65.20,282.80"}
                onChange={(e) => update("nhs_amounts", e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none font-mono text-xs"
              />
              <p className="text-[10px] text-text-subtle mt-1">NHS Band charges - items with these exact amounts are excluded</p>
            </div>
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
