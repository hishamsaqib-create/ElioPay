"use client";
import { useEffect, useState, useRef } from "react";
import Shell from "@/components/Shell";
import { Save, Loader2, Upload, X, Building2, Image as ImageIcon } from "lucide-react";

// Move Section outside the component to prevent re-renders
function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-primary-600">{icon}</span>}
        <h2 className="font-semibold text-text">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// Reusable input field component
function SettingsField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  span = 1
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  span?: number;
}) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
      />
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be less than 2MB");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/settings/logo", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        update("clinic_logo_url", data.url);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to upload logo");
      }
    } catch {
      alert("Failed to upload logo");
    }
    setUploading(false);
  }

  function removeLogo() {
    update("clinic_logo_url", "");
  }

  return (
    <Shell>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Settings</h1>
            <p className="text-sm text-text-muted mt-0.5">Configure AuraPay™ system settings</p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? "Saved!" : <><Save size={16} /> Save</>}
          </button>
        </div>

        {/* Clinic Branding Section */}
        <Section title="Clinic Branding" icon={<Building2 size={18} />}>
          <div className="grid grid-cols-2 gap-4">
            {/* Logo Upload */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-muted mb-2">Clinic Logo</label>
              <div className="flex items-center gap-4">
                {settings.clinic_logo_url ? (
                  <div className="relative">
                    <img
                      src={settings.clinic_logo_url}
                      alt="Clinic logo"
                      className="w-20 h-20 object-contain border border-border rounded-lg bg-white"
                    />
                    <button
                      onClick={removeLogo}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex items-center justify-center bg-surface-dim">
                    <ImageIcon size={24} className="text-text-subtle" />
                  </div>
                )}
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-surface-dim transition disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploading ? "Uploading..." : "Upload Logo"}
                  </button>
                  <p className="text-[10px] text-text-subtle mt-1">PNG, JPG, or SVG. Max 2MB.</p>
                </div>
              </div>
            </div>

            <SettingsField label="Clinic Name" value={settings.clinic_name || ""} onChange={(v) => update("clinic_name", v)} placeholder="Your Dental Clinic" span={2} />
            <SettingsField label="Address Line 1" value={settings.clinic_address_line1 || ""} onChange={(v) => update("clinic_address_line1", v)} placeholder="123 High Street" />
            <SettingsField label="Address Line 2" value={settings.clinic_address_line2 || ""} onChange={(v) => update("clinic_address_line2", v)} placeholder="Suite 100" />
            <SettingsField label="City" value={settings.clinic_city || ""} onChange={(v) => update("clinic_city", v)} placeholder="London" />
            <SettingsField label="Postcode" value={settings.clinic_postcode || ""} onChange={(v) => update("clinic_postcode", v)} placeholder="SW1A 1AA" />
            <SettingsField label="Phone" value={settings.clinic_phone || ""} onChange={(v) => update("clinic_phone", v)} placeholder="+44 20 1234 5678" />
            <SettingsField label="Email" value={settings.clinic_email || ""} onChange={(v) => update("clinic_email", v)} placeholder="info@clinic.com" />
            <SettingsField label="Website" value={settings.clinic_website || ""} onChange={(v) => update("clinic_website", v)} placeholder="aurapay.co.uk" span={2} />
          </div>
        </Section>

        {/* Therapy Calculator Section */}
        <Section title="Therapy Calculator" icon={<span className="text-lg">🧮</span>}>
          <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-lg p-4 border border-primary-100">
            <div className="grid grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-text mb-1">Hourly Rate</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm font-medium">£</span>
                  <input
                    type="number"
                    step="1"
                    value={settings.therapy_hourly_rate || "35"}
                    onChange={(e) => {
                      const hourly = parseFloat(e.target.value) || 0;
                      update("therapy_hourly_rate", e.target.value);
                      update("therapy_rate", (hourly / 60).toFixed(4));
                    }}
                    placeholder="35"
                    className="w-full pl-7 pr-12 py-2.5 border border-primary-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white font-semibold"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">/hour</span>
                </div>
              </div>
              <div className="flex items-center justify-center">
                <div className="text-2xl text-primary-400">=</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Per Minute Rate</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm font-medium">£</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={settings.therapy_rate || "0.5833"}
                    onChange={(e) => {
                      const perMin = parseFloat(e.target.value) || 0;
                      update("therapy_rate", e.target.value);
                      update("therapy_hourly_rate", (perMin * 60).toFixed(2));
                    }}
                    className="w-full pl-7 pr-12 py-2.5 border border-primary-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white font-semibold"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">/min</span>
                </div>
              </div>
            </div>
            {/* Quick reference examples */}
            <div className="mt-4 pt-3 border-t border-primary-100">
              <p className="text-xs font-medium text-text-muted mb-2">Quick Reference</p>
              <div className="grid grid-cols-4 gap-2">
                {[15, 30, 45, 60].map((mins) => {
                  const rate = parseFloat(settings.therapy_rate || "0.5833");
                  const cost = (rate * mins).toFixed(2);
                  return (
                    <div key={mins} className="bg-white rounded-md px-3 py-2 text-center border border-primary-100">
                      <div className="text-xs text-text-muted">{mins} mins</div>
                      <div className="text-sm font-bold text-primary-700">£{cost}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-text-subtle mt-2">
            This rate is charged to dentists for therapy/hygienist appointments referred by them. The cost is deducted from their payslip.
          </p>
        </Section>

        <Section title="Calculation Rates">
          <div className="grid grid-cols-2 gap-4">
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
            <SettingsField label="Site ID" value={settings.dentally_site_id || ""} onChange={(v) => update("dentally_site_id", v)} placeholder="Your Dentally Site ID (UUID)" span={2} />
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-muted mb-1">Therapist/Hygienist IDs (comma-separated)</label>
              <input
                type="text"
                value={settings.therapist_ids || ""}
                onChange={(e) => update("therapist_ids", e.target.value)}
                placeholder="e.g., 189342,189343,189349"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none font-mono text-xs"
              />
              <p className="text-[10px] text-text-subtle mt-1">Practitioner IDs from Dentally for therapists/hygienists. Their invoices are excluded from dentist earnings.</p>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-muted mb-1">NHS Amounts to Exclude (comma-separated)</label>
              <input
                type="text"
                value={settings.nhs_amounts || ""}
                onChange={(e) => update("nhs_amounts", e.target.value)}
                placeholder="e.g., 27.40,75.30,326.70"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none font-mono text-xs"
              />
              <p className="text-[10px] text-text-subtle mt-1">NHS Band charge amounts to exclude (leave empty to rely on keyword detection only)</p>
            </div>
          </div>
        </Section>

        <Section title="Email (SMTP)">
          <div className="grid grid-cols-2 gap-4">
            <SettingsField label="SMTP Host" value={settings.smtp_host || ""} onChange={(v) => update("smtp_host", v)} placeholder="smtp.gmail.com" />
            <SettingsField label="SMTP Port" value={settings.smtp_port || ""} onChange={(v) => update("smtp_port", v)} placeholder="587" />
            <SettingsField label="SMTP Username" value={settings.smtp_user || ""} onChange={(v) => update("smtp_user", v)} placeholder="you@gmail.com" />
            <SettingsField label="SMTP Password" value={settings.smtp_pass || ""} onChange={(v) => update("smtp_pass", v)} type="password" placeholder="App password" />
            <SettingsField label="From Address" value={settings.email_from || ""} onChange={(v) => update("email_from", v)} placeholder="payslips@aurapay.co.uk" span={2} />
          </div>
          <p className="text-xs text-text-subtle">
            For Gmail, use an App Password (not your regular password). Enable 2FA first, then generate at myaccount.google.com.
          </p>
        </Section>
      </div>
    </Shell>
  );
}
