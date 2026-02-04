import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, PayslipEntry, Dentist, getSettings } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { calculatePayslip, formatCurrency, getMonthName } from "@/lib/calculations";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entryId = req.nextUrl.searchParams.get("entry_id");
  if (!entryId) return NextResponse.json({ error: "entry_id required" }, { status: 400 });

  try {
    const db = await getDb();
    const result = await db.execute({
      sql: `SELECT e.*, d.name as dentist_name, d.email as dentist_email,
              d.split_percentage, d.is_nhs, d.uda_rate, d.performer_number,
              p.month, p.year, p.nhs_period_start, p.nhs_period_end
       FROM payslip_entries e
       JOIN dentists d ON d.id = e.dentist_id
       JOIN pay_periods p ON p.id = e.period_id
       WHERE e.id = ?`,
      args: [entryId],
    });

    if (result.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  type EntryRow = PayslipEntry & {
    dentist_name: string; dentist_email: string | null;
    split_percentage: number; is_nhs: number; uda_rate: number;
    performer_number: string | null; month: number; year: number;
    nhs_period_start: string | null; nhs_period_end: string | null;
  };
  const entry = rowTo<EntryRow>(result.rows[0]);

  const dentist: Dentist = {
    id: entry.dentist_id, name: entry.dentist_name, email: entry.dentist_email,
    split_percentage: entry.split_percentage, is_nhs: entry.is_nhs,
    uda_rate: entry.uda_rate, performer_number: entry.performer_number,
    practitioner_id: null, active: 1,
  };
  const calc = calculatePayslip(entry, dentist);

  // Fetch clinic settings for dynamic branding
  const settings = await getSettings();
  const clinicName = settings.get("clinic_name") || "Your Dental Clinic";
  const clinicWebsite = settings.get("clinic_website") || "eliopay.co.uk";

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 0;

  // Professional corporate color palette
  const darkBlue = { r: 15, g: 23, b: 42 };      // #0F172A - Slate 900
  const brandBlue = { r: 30, g: 64, b: 175 };    // #1E40AF - Blue 800
  const accentGold = { r: 180, g: 144, b: 62 };  // #B4903E - Gold accent
  const textDark = { r: 30, g: 41, b: 59 };      // #1E293B - Slate 800
  const textMuted = { r: 100, g: 116, b: 139 };  // #64748B - Slate 500
  const borderLight = { r: 226, g: 232, b: 240 }; // #E2E8F0 - Slate 200
  const bgLight = { r: 248, g: 250, b: 252 };    // #F8FAFC - Slate 50

  // === HEADER SECTION ===
  // Top accent bar
  doc.setFillColor(brandBlue.r, brandBlue.g, brandBlue.b);
  doc.rect(0, 0, pageWidth, 4, "F");

  y = 20;

  // Company branding - left side
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(darkBlue.r, darkBlue.g, darkBlue.b);
  doc.text(clinicName.toUpperCase(), 20, y);

  // Document type badge - right side
  doc.setFillColor(bgLight.r, bgLight.g, bgLight.b);
  doc.roundedRect(pageWidth - 60, y - 10, 45, 16, 2, 2, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(brandBlue.r, brandBlue.g, brandBlue.b);
  doc.text("PAYSLIP", pageWidth - 37.5, y - 1, { align: "center" });

  // Period below badge
  y += 8;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
  doc.text(`${getMonthName(entry.month)} ${entry.year}`, pageWidth - 37.5, y, { align: "center" });

  // Divider line
  y += 10;
  doc.setDrawColor(borderLight.r, borderLight.g, borderLight.b);
  doc.setLineWidth(0.5);
  doc.line(20, y, pageWidth - 20, y);

  // === RECIPIENT INFO SECTION ===
  y += 15;

  // Left column - Dentist details
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
  doc.text("PAYEE DETAILS", 20, y);

  y += 8;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(textDark.r, textDark.g, textDark.b);
  doc.text(entry.dentist_name, 20, y);

  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
  const details: string[] = [];
  if (entry.performer_number) details.push(`Performer No: ${entry.performer_number}`);
  details.push(`Revenue Split: ${entry.split_percentage}%`);
  doc.text(details.join("  |  "), 20, y);

  // Right column - Pay period info box
  const infoBoxX = pageWidth - 75;
  const infoBoxY = y - 22;
  doc.setFillColor(bgLight.r, bgLight.g, bgLight.b);
  doc.roundedRect(infoBoxX, infoBoxY, 55, 25, 2, 2, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
  doc.text("PAY PERIOD", infoBoxX + 5, infoBoxY + 7);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(textDark.r, textDark.g, textDark.b);
  const periodStart = new Date(entry.year, entry.month - 1, 1);
  const periodEnd = new Date(entry.year, entry.month, 0);
  const formatShortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  doc.text(`${formatShortDate(periodStart)} - ${formatShortDate(periodEnd)}`, infoBoxX + 5, infoBoxY + 15);
  doc.text(String(entry.year), infoBoxX + 5, infoBoxY + 21);

  // === NET PAY HIGHLIGHT BOX ===
  y += 18;
  const netPayBoxHeight = 50;

  // Gradient-like effect with two rectangles
  doc.setFillColor(darkBlue.r, darkBlue.g, darkBlue.b);
  doc.roundedRect(20, y, pageWidth - 40, netPayBoxHeight, 4, 4, "F");

  // Gold accent line on left
  doc.setFillColor(accentGold.r, accentGold.g, accentGold.b);
  doc.rect(20, y, 4, netPayBoxHeight, "F");
  // Round the corners manually
  doc.setFillColor(darkBlue.r, darkBlue.g, darkBlue.b);
  doc.rect(20, y, 4, 4, "F");
  doc.rect(20, y + netPayBoxHeight - 4, 4, 4, "F");

  // Net pay label
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 180, 180);
  doc.text("NET PAY", 35, y + 18);

  // Net pay amount
  doc.setFontSize(32);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(formatCurrency(calc.netPay), 35, y + 38);

  // Pay date on the right
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 180, 180);
  doc.text("ISSUED", pageWidth - 35, y + 18, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  const today = new Date();
  doc.text(today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), pageWidth - 35, y + 28, { align: "right" });

  y += netPayBoxHeight + 15;

  // NHS Period (if applicable)
  if (dentist.is_nhs && entry.nhs_period_start && entry.nhs_period_end) {
    const nhsStart = new Date(entry.nhs_period_start + "T00:00:00");
    const nhsEnd = new Date(entry.nhs_period_end + "T00:00:00");
    const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

    doc.setFillColor(bgLight.r, bgLight.g, bgLight.b);
    doc.roundedRect(20, y - 5, pageWidth - 40, 14, 2, 2, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
    doc.text(`NHS Schedule Period: ${formatDate(nhsStart)} - ${formatDate(nhsEnd)}`, pageWidth / 2, y + 3, { align: "center" });
    y += 18;
  }

  // Section header styling function
  const sectionHeader = (title: string, yPos: number) => {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(textDark.r, textDark.g, textDark.b);
    doc.text(title.toUpperCase(), 20, yPos);

    // Accent underline
    const textWidth = doc.getTextWidth(title.toUpperCase());
    doc.setDrawColor(brandBlue.r, brandBlue.g, brandBlue.b);
    doc.setLineWidth(1.5);
    doc.line(20, yPos + 2, 20 + textWidth, yPos + 2);

    return yPos + 12;
  };

  y = sectionHeader("Earnings", y);

  const earningsData: string[][] = [
    ["Gross Private Income", formatCurrency(calc.grossPrivate)],
    [`Net Private (${calc.splitPercentage}%)`, formatCurrency(calc.netPrivate)],
  ];
  if (dentist.is_nhs) {
    earningsData.push([`NHS UDAs (${calc.nhsUdas} x ${formatCurrency(calc.udaRate)})`, formatCurrency(calc.nhsIncome)]);
  }
  earningsData.push(["Total Earnings", formatCurrency(calc.totalEarnings)]);

  autoTable(doc, {
    startY: y,
    head: [["Description", "Amount"]],
    body: earningsData,
    theme: "plain",
    headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 8, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 5, textColor: [textDark.r, textDark.g, textDark.b], lineColor: [borderLight.r, borderLight.g, borderLight.b], lineWidth: 0.1 },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    margin: { left: 20, right: 20 },
    didParseCell: (data) => {
      if (data.row.index === earningsData.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [236, 253, 245]; // Light green for total
        data.cell.styles.textColor = [22, 101, 52]; // Green text
      }
    },
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  y = sectionHeader("Deductions", y);

  // Parse lab bills with file URLs
  interface LabBillWithFile {
    lab_name: string;
    amount: number;
    description?: string;
    file_url?: string;
  }
  const labBillsWithFiles: LabBillWithFile[] = entry.lab_bills_json
    ? JSON.parse(String(entry.lab_bills_json))
    : [];

  const deductionsData: string[][] = [];
  const labBillLinks: { row: number; url: string }[] = [];
  let rowIndex = 0;

  for (const lb of labBillsWithFiles) {
    const label = lb.file_url ? `Lab: ${lb.lab_name} (view bill)` : `Lab: ${lb.lab_name}`;
    deductionsData.push([label, formatCurrency(lb.amount)]);
    if (lb.file_url) {
      labBillLinks.push({ row: rowIndex, url: lb.file_url });
    }
    rowIndex++;
  }
  if (calc.labBillsTotal > 0) {
    deductionsData.push([`Lab Bills (50% of ${formatCurrency(calc.labBillsTotal)})`, formatCurrency(calc.labBillsDeduction)]);
    rowIndex++;
  }
  if (calc.financeFeesDeduction > 0) {
    deductionsData.push([`Finance Fees (50%)`, formatCurrency(calc.financeFeesDeduction)]);
    rowIndex++;
  }
  if (calc.therapyDeduction > 0) {
    deductionsData.push([`Therapy (${calc.therapyMinutes} min x ${formatCurrency(calc.therapyRate)}/min)`, formatCurrency(calc.therapyDeduction)]);
    rowIndex++;
  }
  for (const adj of calc.adjustments) {
    deductionsData.push([`${adj.type === "deduction" ? "-" : "+"} ${adj.description}`, formatCurrency(adj.amount)]);
    rowIndex++;
  }
  deductionsData.push(["Total Deductions", formatCurrency(calc.totalDeductions)]);

  if (deductionsData.length > 1) {
    autoTable(doc, {
      startY: y,
      head: [["Description", "Amount"]],
      body: deductionsData,
      theme: "plain",
      headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 5, textColor: [textDark.r, textDark.g, textDark.b], lineColor: [borderLight.r, borderLight.g, borderLight.b], lineWidth: 0.1 },
      columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
      margin: { left: 20, right: 20 },
      didParseCell: (data) => {
        if (data.row.index === deductionsData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [254, 242, 242]; // Light red for total
          data.cell.styles.textColor = [153, 27, 27]; // Red text
        }
        // Style rows with links
        const linkInfo = labBillLinks.find(l => l.row === data.row.index);
        if (linkInfo && data.column.index === 0) {
          data.cell.styles.textColor = [brandBlue.r, brandBlue.g, brandBlue.b];
        }
      },
      didDrawCell: (data) => {
        // Add clickable links for lab bills with file URLs
        const linkInfo = labBillLinks.find(l => l.row === data.row.index);
        if (linkInfo && data.column.index === 0 && data.cell.section === "body") {
          doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: linkInfo.url });
        }
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;
  }

  // Parse therapy breakdown
  interface TherapyBreakdownItem {
    patientName: string;
    patientId: string;
    date: string;
    minutes: number;
    treatment?: string;
    therapistName?: string;
    cost: number;
  }
  const therapyBreakdown: TherapyBreakdownItem[] = entry.therapy_breakdown_json ? JSON.parse(String(entry.therapy_breakdown_json)) : [];

  // Therapy Breakdown Section
  if (therapyBreakdown.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }
    y = sectionHeader("Therapy Referrals", y);

    const therapyData: string[][] = therapyBreakdown.map(t => [
      t.patientName,
      new Date(t.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      t.therapistName || "Therapist",
      `${t.minutes}`,
      formatCurrency(t.cost),
    ]);

    // Add total row
    const totalMins = therapyBreakdown.reduce((sum, t) => sum + t.minutes, 0);
    const totalCost = therapyBreakdown.reduce((sum, t) => sum + t.cost, 0);
    therapyData.push(["Total", "", "", `${totalMins}`, formatCurrency(totalCost)]);

    autoTable(doc, {
      startY: y,
      head: [["Patient", "Date", "Therapist", "Mins", "Cost"]],
      body: therapyData,
      theme: "plain",
      headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 7, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 3, textColor: [textDark.r, textDark.g, textDark.b], lineColor: [borderLight.r, borderLight.g, borderLight.b], lineWidth: 0.1 },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: 20, right: 20 },
      didParseCell: (data) => {
        if (data.row.index === therapyData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [bgLight.r, bgLight.g, bgLight.b];
        }
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;
  }

  // Parse analytics
  interface Analytics {
    totalChairMins: number;
    grossPerHour: number;
    netPerHour: number;
    utilizationPercent: number;
    avgAppointmentMins: number;
    topPatientsByHourlyRate: Array<{ name: string; amount: number; durationMins: number; hourlyRate: number }>;
    topTreatmentsByHourlyRate: Array<{ treatment: string; totalAmount: number; totalMins: number; hourlyRate: number; count: number }>;
  }
  const analytics: Analytics | null = entry.analytics_json ? JSON.parse(String(entry.analytics_json)) : null;

  // Performance Analytics Section
  if (analytics && analytics.totalChairMins > 0) {
    if (y > 200) { doc.addPage(); y = 20; }
    y = sectionHeader("Performance Analytics", y);

    const totalHours = (analytics.totalChairMins / 60).toFixed(1);
    const analyticsData: string[][] = [
      ["Chair Time", `${totalHours} hours (${analytics.totalChairMins} mins)`],
      ["Gross £/Hour", formatCurrency(analytics.grossPerHour)],
      ["Net £/Hour", formatCurrency(analytics.netPerHour)],
      ["Utilization", `${analytics.utilizationPercent}%`],
      ["Avg Appointment", `${analytics.avgAppointmentMins} mins`],
    ];

    autoTable(doc, {
      startY: y, head: [["Metric", "Value"]], body: analyticsData, theme: "plain",
      headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 4, textColor: [textDark.r, textDark.g, textDark.b], lineColor: [borderLight.r, borderLight.g, borderLight.b], lineWidth: 0.1 },
      columnStyles: { 1: { halign: "right", fontStyle: "bold" } }, margin: { left: 20, right: 20 },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

    // Top Performers
    if (analytics.topPatientsByHourlyRate.length > 0 || analytics.topTreatmentsByHourlyRate.length > 0) {
      if (y > 220) { doc.addPage(); y = 20; }
      y = sectionHeader("Top Performers", y);

      // Side by side tables
      const leftWidth = (pageWidth - 50) / 2;

      if (analytics.topPatientsByHourlyRate.length > 0) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
        doc.text("By Patient (£/hour)", 20, y);
        autoTable(doc, {
          startY: y + 3,
          head: [["Patient", "£/hr"]],
          body: analytics.topPatientsByHourlyRate.slice(0, 5).map(p => [p.name.substring(0, 20), formatCurrency(p.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 7, fontStyle: "bold" },
          styles: { fontSize: 7, cellPadding: 2, textColor: [textDark.r, textDark.g, textDark.b] },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 20, right: pageWidth - 20 - leftWidth },
          tableWidth: leftWidth,
        });
      }

      if (analytics.topTreatmentsByHourlyRate.length > 0) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
        doc.text("By Treatment (£/hour)", 20 + leftWidth + 10, y);
        autoTable(doc, {
          startY: y + 3,
          head: [["Treatment", "£/hr"]],
          body: analytics.topTreatmentsByHourlyRate.slice(0, 5).map(t => [t.treatment.substring(0, 20), formatCurrency(t.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 7, fontStyle: "bold" },
          styles: { fontSize: 7, cellPadding: 2, textColor: [textDark.r, textDark.g, textDark.b] },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 20 + leftWidth + 10, right: 20 },
          tableWidth: leftWidth,
        });
      }
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;
    }
  }

  // Patient breakdown with duration and hourly rate
  interface PatientData { name: string; date: string; amount: number; finance: boolean; durationMins?: number; hourlyRate?: number }
  const patients: PatientData[] = JSON.parse(String(entry.private_patients_json) || "[]");
  if (patients.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }
    y = sectionHeader("Private Patient Breakdown", y);

    // Check if we have duration data
    const hasDurationData = patients.some(p => p.durationMins && p.durationMins > 0);

    if (hasDurationData) {
      autoTable(doc, {
        startY: y, head: [["Patient", "Date", "Amount", "Mins", "£/hr", "Fin"]],
        body: patients.map((p) => [
          p.name,
          p.date,
          formatCurrency(p.amount),
          p.durationMins ? String(p.durationMins) : "-",
          p.hourlyRate ? formatCurrency(p.hourlyRate) : "-",
          p.finance ? "Y" : ""
        ]),
        theme: "plain",
        headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 7, fontStyle: "bold" },
        styles: { fontSize: 7, cellPadding: 2.5, textColor: [textDark.r, textDark.g, textDark.b], lineColor: [borderLight.r, borderLight.g, borderLight.b], lineWidth: 0.1 },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "center" }, 4: { halign: "right" } },
        margin: { left: 20, right: 20 },
      });
    } else {
      autoTable(doc, {
        startY: y, head: [["Patient", "Date", "Amount", "Finance"]],
        body: patients.map((p) => [p.name, p.date, formatCurrency(p.amount), p.finance ? "Yes" : ""]),
        theme: "plain",
        headStyles: { fillColor: [bgLight.r, bgLight.g, bgLight.b], textColor: [textMuted.r, textMuted.g, textMuted.b], fontSize: 8, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 3, textColor: [textDark.r, textDark.g, textDark.b], lineColor: [borderLight.r, borderLight.g, borderLight.b], lineWidth: 0.1 },
        columnStyles: { 2: { halign: "right" } },
        margin: { left: 20, right: 20 },
      });
    }
  }

  // Professional footer with branding
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const footerY = pageHeight - 15;

    // Footer divider line
    doc.setDrawColor(borderLight.r, borderLight.g, borderLight.b);
    doc.setLineWidth(0.5);
    doc.line(20, footerY - 5, pageWidth - 20, footerY - 5);

    // Left: Clinic name
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(textMuted.r, textMuted.g, textMuted.b);
    doc.text(clinicName, 20, footerY);

    // Center: Website
    doc.setFont("helvetica", "normal");
    doc.text(clinicWebsite, pageWidth / 2, footerY, { align: "center" });

    // Right: Page number with styling
    doc.setFillColor(bgLight.r, bgLight.g, bgLight.b);
    doc.roundedRect(pageWidth - 35, footerY - 5, 15, 8, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(textDark.r, textDark.g, textDark.b);
    doc.text(`${i}/${pageCount}`, pageWidth - 27.5, footerY, { align: "center" });

    // Bottom accent bar
    doc.setFillColor(brandBlue.r, brandBlue.g, brandBlue.b);
    doc.rect(0, pageHeight - 4, pageWidth, 4, "F");
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `${entry.dentist_name.replace(/\s+/g, "_")}_${getMonthName(entry.month)}_${entry.year}.pdf`;

  return new NextResponse(pdfBuffer, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
  });
  } catch (error) {
    console.error("[PDF] Generation error:", error);
    return NextResponse.json({
      error: "PDF generation failed",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}
