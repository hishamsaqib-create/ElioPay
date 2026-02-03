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

  // Clean, modern color palette
  const navy = { r: 17, g: 24, b: 39 };        // #111827 - Dark navy
  const accent = { r: 79, g: 70, b: 229 };     // #4F46E5 - Indigo accent
  const gray = { r: 107, g: 114, b: 128 };     // #6B7280 - Gray text
  const lightGray = { r: 243, g: 244, b: 246 }; // #F3F4F6 - Light background

  // Draw Aura logo (circle with stylized A)
  const logoX = 15;
  const logoY = y - 5;
  const logoSize = 12;
  const logoCenter = logoSize / 2;

  // Draw circle
  doc.setDrawColor(navy.r, navy.g, navy.b);
  doc.setLineWidth(0.6);
  doc.circle(logoX + logoCenter, logoY + logoCenter, logoCenter, "S");

  // Draw the "A" shape
  doc.setLineWidth(0.5);
  // Left leg of A
  doc.line(logoX + logoCenter, logoY + 2, logoX + 2.5, logoY + logoSize - 2);
  // Right leg of A
  doc.line(logoX + logoCenter, logoY + 2, logoX + logoSize - 2.5, logoY + logoSize - 2);
  // Curved crossbar (wave effect) - using a bezier-like approach with line
  doc.setLineWidth(0.6);
  const waveY = logoY + logoSize * 0.55;
  doc.line(logoX + 4, waveY + 1, logoX + logoCenter, waveY - 1);
  doc.line(logoX + logoCenter, waveY - 1, logoX + logoSize - 4, waveY + 1);

  // Clean header - Logo text next to icon
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(navy.r, navy.g, navy.b);
  doc.text("AURA", logoX + logoSize + 4, y + 2);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(gray.r, gray.g, gray.b);
  doc.text("DENTAL CLINIC", logoX + logoSize + 4, y + 7);

  // Period info - right aligned
  doc.setFontSize(10);
  doc.setTextColor(gray.r, gray.g, gray.b);
  doc.text("PAYSLIP", pageWidth - 15, y - 5, { align: "right" });
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(navy.r, navy.g, navy.b);
  doc.text(`${getMonthName(entry.month)} ${entry.year}`, pageWidth - 15, y + 3, { align: "right" });

  // Thin accent line
  y += 15;
  doc.setDrawColor(accent.r, accent.g, accent.b);
  doc.setLineWidth(0.5);
  doc.line(15, y, pageWidth - 15, y);

  // Dentist info section
  y += 12;
  doc.setFontSize(9);
  doc.setTextColor(gray.r, gray.g, gray.b);
  doc.text("DENTIST", 15, y);
  doc.text("DETAILS", pageWidth / 2 + 10, y);

  y += 8;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(navy.r, navy.g, navy.b);
  doc.text(entry.dentist_name, 15, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(gray.r, gray.g, gray.b);
  if (entry.performer_number) {
    doc.text(`Performer: ${entry.performer_number}`, pageWidth / 2 + 10, y);
  }
  y += 6;
  doc.text(`Split: ${entry.split_percentage}%`, pageWidth / 2 + 10, y);

  // NET PAY - Large, clean display
  y += 20;
  doc.setFillColor(navy.r, navy.g, navy.b);
  doc.roundedRect(15, y, pageWidth - 30, 35, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("NET PAY", 25, y + 14);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text(formatCurrency(calc.netPay), pageWidth - 25, y + 25, { align: "right" });

  y += 45;

  // NHS Period (if applicable)
  if (dentist.is_nhs && entry.nhs_period_start && entry.nhs_period_end) {
    const nhsStart = new Date(entry.nhs_period_start + "T00:00:00");
    const nhsEnd = new Date(entry.nhs_period_end + "T00:00:00");
    const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    doc.setFontSize(8);
    doc.setTextColor(gray.r, gray.g, gray.b);
    doc.text(`NHS Period: ${formatDate(nhsStart)} - ${formatDate(nhsEnd)}`, pageWidth / 2, y, { align: "center" });
    y += 10;
  }

  // Section styling
  const sectionHeader = (title: string, yPos: number) => {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(navy.r, navy.g, navy.b);
    doc.text(title.toUpperCase(), 15, yPos);
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.3);
    doc.line(15, yPos + 3, pageWidth - 15, yPos + 3);
    return yPos + 10;
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
    headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 8, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 4, textColor: [navy.r, navy.g, navy.b] },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      if (data.row.index === earningsData.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [240, 253, 244]; // Light green for total
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
      headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 4, textColor: [navy.r, navy.g, navy.b] },
      columnStyles: { 1: { halign: "right" } },
      margin: { left: 15, right: 15 },
      didParseCell: (data) => {
        if (data.row.index === deductionsData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [254, 242, 242]; // Light red for total
        }
        // Style rows with links
        const linkInfo = labBillLinks.find(l => l.row === data.row.index);
        if (linkInfo && data.column.index === 0) {
          data.cell.styles.textColor = [79, 70, 229]; // Indigo for links
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
      headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 7, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5, textColor: [navy.r, navy.g, navy.b] },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: 15, right: 15 },
      didParseCell: (data) => {
        if (data.row.index === therapyData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 253, 244];
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
      headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 3.5, textColor: [navy.r, navy.g, navy.b] },
      columnStyles: { 1: { halign: "right" } }, margin: { left: 15, right: 15 },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

    // Top Performers
    if (analytics.topPatientsByHourlyRate.length > 0 || analytics.topTreatmentsByHourlyRate.length > 0) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text("TOP PERFORMERS", 15, y);
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.3);
      doc.line(15, y + 3, pageWidth - 15, y + 3);
      y += 12;

      // Side by side tables
      const leftWidth = (pageWidth - 40) / 2;

      if (analytics.topPatientsByHourlyRate.length > 0) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(gray.r, gray.g, gray.b);
        doc.text("By Patient (£/hour)", 15, y);
        autoTable(doc, {
          startY: y + 2,
          head: [["Patient", "£/hr"]],
          body: analytics.topPatientsByHourlyRate.slice(0, 5).map(p => [p.name.substring(0, 20), formatCurrency(p.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 7, fontStyle: "bold" },
          styles: { fontSize: 7, cellPadding: 1.5, textColor: [navy.r, navy.g, navy.b] },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 15, right: pageWidth - 15 - leftWidth },
          tableWidth: leftWidth,
        });
      }

      if (analytics.topTreatmentsByHourlyRate.length > 0) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(gray.r, gray.g, gray.b);
        doc.text("By Treatment (£/hour)", 15 + leftWidth + 10, y);
        autoTable(doc, {
          startY: y + 2,
          head: [["Treatment", "£/hr"]],
          body: analytics.topTreatmentsByHourlyRate.slice(0, 5).map(t => [t.treatment.substring(0, 20), formatCurrency(t.hourlyRate)]),
          theme: "plain",
          headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 7, fontStyle: "bold" },
          styles: { fontSize: 7, cellPadding: 1.5, textColor: [navy.r, navy.g, navy.b] },
          columnStyles: { 1: { halign: "right" } },
          margin: { left: 15 + leftWidth + 10, right: 15 },
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
        headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 7, fontStyle: "bold" },
        styles: { fontSize: 7, cellPadding: 2, textColor: [navy.r, navy.g, navy.b] },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "center" }, 4: { halign: "right" } },
        margin: { left: 15, right: 15 },
      });
    } else {
      autoTable(doc, {
        startY: y, head: [["Patient", "Date", "Amount", "Finance"]],
        body: patients.map((p) => [p.name, p.date, formatCurrency(p.amount), p.finance ? "Yes" : ""]),
        theme: "plain",
        headStyles: { fillColor: [lightGray.r, lightGray.g, lightGray.b], textColor: [gray.r, gray.g, gray.b], fontSize: 8, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 2.5, textColor: [navy.r, navy.g, navy.b] },
        columnStyles: { 2: { halign: "right" } },
        margin: { left: 15, right: 15 },
      });
    }
  }

  // Clean, minimal footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const footerY = doc.internal.pageSize.getHeight() - 12;

    doc.setFontSize(7);
    doc.setTextColor(gray.r, gray.g, gray.b);
    doc.text("AURA DENTAL CLINIC", 15, footerY);
    doc.setFont("helvetica", "normal");
    doc.text("aurapay.cloud", pageWidth / 2, footerY, { align: "center" });
    doc.text(`${i} / ${pageCount}`, pageWidth - 15, footerY, { align: "right" });
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
