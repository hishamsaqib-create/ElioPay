import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, PayslipEntry, Dentist } from "@/lib/db";
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

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 0;

  // Aura Dental brand colors
  const teal = { r: 15, g: 118, b: 110 };      // #0F766E - Deep teal
  const tealLight = { r: 20, g: 184, b: 166 }; // #14B8A6 - Light teal
  const gold = { r: 212, g: 175, b: 55 };      // #D4AF37 - Gold
  const charcoal = { r: 31, g: 41, b: 55 };    // #1F2937 - Dark charcoal
  const slate = { r: 71, g: 85, b: 105 };      // #475569 - Slate

  // Elegant header with gradient effect (simulated with two rectangles)
  doc.setFillColor(teal.r, teal.g, teal.b);
  doc.rect(0, 0, pageWidth, 50, "F");

  // Subtle gold accent line at bottom of header
  doc.setFillColor(gold.r, gold.g, gold.b);
  doc.rect(0, 50, pageWidth, 2, "F");

  // Logo area - "AURA" text with elegant styling
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("AURA", 15, 24);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(tealLight.r, tealLight.g, tealLight.b);
  doc.text("DENTAL CLINIC", 15, 32);

  // Payslip title with gold accent
  doc.setTextColor(gold.r, gold.g, gold.b);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("PAYSLIP", 15, 44);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${getMonthName(entry.month)} ${entry.year}`, 42, 44);

  // Dentist info on right side
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(entry.dentist_name, pageWidth - 15, 22, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(tealLight.r, tealLight.g, tealLight.b);
  if (entry.performer_number) {
    doc.text(`Performer: ${entry.performer_number}`, pageWidth - 15, 32, { align: "right" });
  }
  doc.text(`Split: ${entry.split_percentage}%`, pageWidth - 15, 40, { align: "right" });

  y = 62;

  // Net Pay card with elegant styling
  doc.setFillColor(charcoal.r, charcoal.g, charcoal.b);
  doc.roundedRect(15, y, pageWidth - 30, 28, 4, 4, "F");

  // Gold accent on left edge of net pay card
  doc.setFillColor(gold.r, gold.g, gold.b);
  doc.roundedRect(15, y, 4, 28, 2, 2, "F");
  doc.rect(17, y, 2, 28, "F"); // overlap to make left side rounded, right side straight

  doc.setTextColor(180, 180, 180);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("NET PAY", 28, y + 12);
  doc.setTextColor(gold.r, gold.g, gold.b);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(formatCurrency(calc.netPay), pageWidth - 25, y + 19, { align: "right" });

  // NHS Period Banner (for NHS dentists)
  if (dentist.is_nhs && entry.nhs_period_start && entry.nhs_period_end) {
    y += 36;
    doc.setFillColor(teal.r, teal.g, teal.b);
    doc.roundedRect(15, y, pageWidth - 30, 12, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const nhsStart = new Date(entry.nhs_period_start + "T00:00:00");
    const nhsEnd = new Date(entry.nhs_period_end + "T00:00:00");
    const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    doc.text(`NHS Period: ${formatDate(nhsStart)} - ${formatDate(nhsEnd)}`, pageWidth / 2, y + 8, { align: "center" });
    y += 18;
  } else {
    y += 38;
  }

  // Section header styling function
  const sectionHeader = (title: string, yPos: number) => {
    doc.setFillColor(teal.r, teal.g, teal.b);
    doc.rect(15, yPos, 3, 14, "F");
    doc.setTextColor(charcoal.r, charcoal.g, charcoal.b);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(title, 22, yPos + 10);
    return yPos + 16;
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
    startY: y, head: [["Description", "Amount"]], body: earningsData, theme: "plain",
    headStyles: { fillColor: [teal.r, teal.g, teal.b], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 4, textColor: [charcoal.r, charcoal.g, charcoal.b] },
    columnStyles: { 1: { halign: "right" } }, margin: { left: 15, right: 15 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      if (data.row.index === earningsData.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [240, 253, 250];
      }
    },
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  y = sectionHeader("Deductions", y);

  const deductionsData: string[][] = [];
  for (const lb of calc.labBills) {
    deductionsData.push([`Lab: ${lb.lab_name}`, formatCurrency(lb.amount)]);
  }
  if (calc.labBillsTotal > 0) deductionsData.push([`Lab Bills (50% of ${formatCurrency(calc.labBillsTotal)})`, formatCurrency(calc.labBillsDeduction)]);
  if (calc.financeFeesDeduction > 0) deductionsData.push([`Finance Fees (50%)`, formatCurrency(calc.financeFeesDeduction)]);
  if (calc.therapyDeduction > 0) deductionsData.push([`Therapy (${calc.therapyMinutes} min x ${formatCurrency(calc.therapyRate)}/min)`, formatCurrency(calc.therapyDeduction)]);
  for (const adj of calc.adjustments) {
    deductionsData.push([`${adj.type === "deduction" ? "-" : "+"} ${adj.description}`, formatCurrency(adj.amount)]);
  }
  deductionsData.push(["Total Deductions", formatCurrency(calc.totalDeductions)]);

  if (deductionsData.length > 1) {
    autoTable(doc, {
      startY: y, head: [["Description", "Amount"]], body: deductionsData, theme: "plain",
      headStyles: { fillColor: [slate.r, slate.g, slate.b], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 4, textColor: [charcoal.r, charcoal.g, charcoal.b] },
      columnStyles: { 1: { halign: "right" } }, margin: { left: 15, right: 15 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.row.index === deductionsData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [254, 242, 242];
        }
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
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
      headStyles: { fillColor: [tealLight.r, tealLight.g, tealLight.b], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5, textColor: [charcoal.r, charcoal.g, charcoal.b] },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: 15, right: 15 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.row.index === therapyData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 253, 250];
        }
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
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
      headStyles: { fillColor: [teal.r, teal.g, teal.b], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 3.5, textColor: [charcoal.r, charcoal.g, charcoal.b] },
      columnStyles: { 1: { halign: "right" } }, margin: { left: 15, right: 15 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

    // Top Performers
    if (analytics.topPatientsByHourlyRate.length > 0 || analytics.topTreatmentsByHourlyRate.length > 0) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setFillColor(gold.r, gold.g, gold.b);
      doc.rect(15, y, 3, 12, "F");
      doc.setTextColor(charcoal.r, charcoal.g, charcoal.b);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("Top Performers", 22, y + 8);
      y += 14;

      // Side by side tables
      const leftWidth = (pageWidth - 40) / 2;

      if (analytics.topPatientsByHourlyRate.length > 0) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(slate.r, slate.g, slate.b);
        doc.text("By Patient (£/hour)", 15, y);
        autoTable(doc, {
          startY: y + 2,
          head: [["Patient", "£/hr"]],
          body: analytics.topPatientsByHourlyRate.slice(0, 5).map(p => [p.name.substring(0, 20), formatCurrency(p.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [240, 253, 250], textColor: [teal.r, teal.g, teal.b], fontSize: 7, fontStyle: "bold" },
          styles: { fontSize: 7, cellPadding: 1.5, textColor: [charcoal.r, charcoal.g, charcoal.b] },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 15, right: pageWidth - 15 - leftWidth },
          tableWidth: leftWidth,
        });
      }

      if (analytics.topTreatmentsByHourlyRate.length > 0) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(slate.r, slate.g, slate.b);
        doc.text("By Treatment (£/hour)", 15 + leftWidth + 10, y);
        autoTable(doc, {
          startY: y + 2,
          head: [["Treatment", "£/hr"]],
          body: analytics.topTreatmentsByHourlyRate.slice(0, 5).map(t => [t.treatment.substring(0, 20), formatCurrency(t.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [240, 253, 250], textColor: [teal.r, teal.g, teal.b], fontSize: 7, fontStyle: "bold" },
          styles: { fontSize: 7, cellPadding: 1.5, textColor: [charcoal.r, charcoal.g, charcoal.b] },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 15 + leftWidth + 10, right: 15 },
          tableWidth: leftWidth,
        });
      }
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
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
        headStyles: { fillColor: [teal.r, teal.g, teal.b], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
        styles: { fontSize: 7, cellPadding: 2, textColor: [charcoal.r, charcoal.g, charcoal.b] },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "center" }, 4: { halign: "right" } },
        margin: { left: 15, right: 15 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    } else {
      autoTable(doc, {
        startY: y, head: [["Patient", "Date", "Amount", "Finance"]],
        body: patients.map((p) => [p.name, p.date, formatCurrency(p.amount), p.finance ? "Yes" : ""]),
        theme: "plain",
        headStyles: { fillColor: [teal.r, teal.g, teal.b], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 2.5, textColor: [charcoal.r, charcoal.g, charcoal.b] },
        columnStyles: { 2: { halign: "right" } },
        margin: { left: 15, right: 15 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
    }
  }

  // Elegant footer with teal accent
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const footerY = doc.internal.pageSize.getHeight() - 15;

    // Subtle teal line above footer
    doc.setDrawColor(teal.r, teal.g, teal.b);
    doc.setLineWidth(0.5);
    doc.line(15, footerY, pageWidth - 15, footerY);

    doc.setFontSize(7);
    doc.setTextColor(slate.r, slate.g, slate.b);
    doc.text("Generated by", 15, footerY + 6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(teal.r, teal.g, teal.b);
    doc.text("AURA", 38, footerY + 6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(slate.r, slate.g, slate.b);
    doc.text("| aurapay.cloud", 50, footerY + 6);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 15, footerY + 6, { align: "right" });
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
