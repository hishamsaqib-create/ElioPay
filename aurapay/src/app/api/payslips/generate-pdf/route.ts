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
  let y = 20;

  doc.setFillColor(66, 99, 235);
  doc.rect(0, 0, pageWidth, 45, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("AuraPay", 15, 22);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Aura Dental Clinic", 15, 30);
  doc.text(`Payslip for ${getMonthName(entry.month)} ${entry.year}`, 15, 37);
  doc.setFontSize(12);
  doc.text(entry.dentist_name, pageWidth - 15, 22, { align: "right" });
  doc.setFontSize(9);
  if (entry.performer_number) {
    doc.text(`Performer: ${entry.performer_number}`, pageWidth - 15, 30, { align: "right" });
  }
  doc.text(`Split: ${entry.split_percentage}%`, pageWidth - 15, 37, { align: "right" });

  y = 55;
  doc.setFillColor(35, 40, 55);
  doc.roundedRect(15, y, pageWidth - 30, 22, 3, 3, "F");
  doc.setTextColor(251, 191, 36);
  doc.setFontSize(11);
  doc.text("NET PAY", 25, y + 10);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(formatCurrency(calc.netPay), pageWidth - 25, y + 15, { align: "right" });

  // NHS Period Banner (for NHS dentists)
  if (dentist.is_nhs && entry.nhs_period_start && entry.nhs_period_end) {
    y += 30;
    doc.setFillColor(59, 130, 246); // Blue
    doc.roundedRect(15, y, pageWidth - 30, 12, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const nhsStart = new Date(entry.nhs_period_start + "T00:00:00");
    const nhsEnd = new Date(entry.nhs_period_end + "T00:00:00");
    const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    doc.text(`NHS Period: ${formatDate(nhsStart)} - ${formatDate(nhsEnd)}`, pageWidth / 2, y + 8, { align: "center" });
    y += 15;
  } else {
    y += 32;
  }

  doc.setTextColor(50, 50, 50);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Earnings", 15, y);
  y += 3;

  const earningsData: string[][] = [
    ["Gross Private Income", formatCurrency(calc.grossPrivate)],
    [`Net Private (${calc.splitPercentage}%)`, formatCurrency(calc.netPrivate)],
  ];
  if (dentist.is_nhs) {
    earningsData.push([`NHS UDAs (${calc.nhsUdas} x ${formatCurrency(calc.udaRate)})`, formatCurrency(calc.nhsIncome)]);
  }
  earningsData.push(["Total Earnings", formatCurrency(calc.totalEarnings)]);

  autoTable(doc, {
    startY: y, head: [["Description", "Amount"]], body: earningsData, theme: "striped",
    headStyles: { fillColor: [66, 99, 235], fontSize: 9 }, styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 1: { halign: "right" } }, margin: { left: 15, right: 15 },
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Deductions", 15, y);
  y += 3;

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
      startY: y, head: [["Description", "Amount"]], body: deductionsData, theme: "striped",
      headStyles: { fillColor: [220, 53, 69], fontSize: 9 }, styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 1: { halign: "right" } }, margin: { left: 15, right: 15 },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
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
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text("Therapy Referrals Breakdown", 15, y);
    y += 3;

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
      theme: "striped",
      headStyles: { fillColor: [147, 51, 234], fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: 15, right: 15 },
      didParseCell: (data) => {
        // Make the last row bold
        if (data.row.index === therapyData.length - 1) {
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
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
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Performance Analytics", 15, y);
    y += 3;

    const totalHours = (analytics.totalChairMins / 60).toFixed(1);
    const analyticsData: string[][] = [
      ["Chair Time", `${totalHours} hours (${analytics.totalChairMins} mins)`],
      ["Gross £/Hour", formatCurrency(analytics.grossPerHour)],
      ["Net £/Hour", formatCurrency(analytics.netPerHour)],
      ["Utilization", `${analytics.utilizationPercent}%`],
      ["Avg Appointment", `${analytics.avgAppointmentMins} mins`],
    ];

    autoTable(doc, {
      startY: y, head: [["Metric", "Value"]], body: analyticsData, theme: "striped",
      headStyles: { fillColor: [99, 102, 241], fontSize: 9 }, styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 1: { halign: "right" } }, margin: { left: 15, right: 15 },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

    // Top Performers
    if (analytics.topPatientsByHourlyRate.length > 0 || analytics.topTreatmentsByHourlyRate.length > 0) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Top Performers", 15, y);
      y += 5;

      // Side by side tables
      const leftWidth = (pageWidth - 40) / 2;

      if (analytics.topPatientsByHourlyRate.length > 0) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text("By Patient (£/hour)", 15, y);
        autoTable(doc, {
          startY: y + 2,
          head: [["Patient", "£/hr"]],
          body: analytics.topPatientsByHourlyRate.slice(0, 5).map(p => [p.name.substring(0, 20), formatCurrency(p.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [229, 231, 235], textColor: [55, 65, 81], fontSize: 7 },
          styles: { fontSize: 7, cellPadding: 1.5 },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 15, right: pageWidth - 15 - leftWidth },
          tableWidth: leftWidth,
        });
      }

      if (analytics.topTreatmentsByHourlyRate.length > 0) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text("By Treatment (£/hour)", 15 + leftWidth + 10, y);
        autoTable(doc, {
          startY: y + 2,
          head: [["Treatment", "£/hr"]],
          body: analytics.topTreatmentsByHourlyRate.slice(0, 5).map(t => [t.treatment.substring(0, 20), formatCurrency(t.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [229, 231, 235], textColor: [55, 65, 81], fontSize: 7 },
          styles: { fontSize: 7, cellPadding: 1.5 },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 15 + leftWidth + 10, right: 15 },
          tableWidth: leftWidth,
        });
      }
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }
  }

  // Patient breakdown with duration and hourly rate
  interface PatientData { name: string; date: string; amount: number; finance: boolean; durationMins?: number; hourlyRate?: number }
  const patients: PatientData[] = JSON.parse(String(entry.private_patients_json) || "[]");
  if (patients.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Private Patient Breakdown", 15, y);
    y += 3;

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
        theme: "striped", headStyles: { fillColor: [66, 99, 235], fontSize: 7 },
        styles: { fontSize: 7, cellPadding: 1.5 },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "center" }, 4: { halign: "right" } },
        margin: { left: 15, right: 15 },
      });
    } else {
      autoTable(doc, {
        startY: y, head: [["Patient", "Date", "Amount", "Finance"]],
        body: patients.map((p) => [p.name, p.date, formatCurrency(p.amount), p.finance ? "Yes" : ""]),
        theme: "striped", headStyles: { fillColor: [66, 99, 235], fontSize: 8 },
        styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 2: { halign: "right" } }, margin: { left: 15, right: 15 },
      });
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Generated by AuraPay | aurapay.cloud | Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: "center" });
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
