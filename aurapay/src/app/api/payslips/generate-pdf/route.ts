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
    const clinicName = settings.get("clinic_name") || "ElioPay";
    const clinicWebsite = settings.get("clinic_website") || "eliopay.co.uk";

    // Parse analytics
    interface Analytics {
      totalChairMins: number;
      totalPatients: number;
      grossPerHour: number;
      netPerHour: number;
      utilizationPercent: number;
      avgAppointmentMins: number;
      topPatientsByHourlyRate: Array<{ name: string; amount: number; durationMins: number; hourlyRate: number }>;
      topTreatmentsByHourlyRate: Array<{ treatment: string; totalAmount: number; totalMins: number; hourlyRate: number; count: number }>;
    }
    const analytics: Analytics | null = entry.analytics_json ? JSON.parse(String(entry.analytics_json)) : null;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = 0;

    // Premium color palette
    const navy = { r: 15, g: 23, b: 42 };
    const slate700 = { r: 51, g: 65, b: 85 };
    const slate500 = { r: 100, g: 116, b: 139 };
    const slate300 = { r: 203, g: 213, b: 225 };
    const slate100 = { r: 241, g: 245, b: 249 };
    const blue600 = { r: 37, g: 99, b: 235 };
    const emerald600 = { r: 5, g: 150, b: 105 };
    const emerald50 = { r: 236, g: 253, b: 245 };
    const red600 = { r: 220, g: 38, b: 38 };
    const red50 = { r: 254, g: 242, b: 242 };
    const amber500 = { r: 245, g: 158, b: 11 };
    const amber50 = { r: 255, g: 251, b: 235 };
    const white = { r: 255, g: 255, b: 255 };

    // Helper function for rounded rectangles
    const drawCard = (x: number, yPos: number, w: number, h: number, fill: {r: number, g: number, b: number}, radius = 3) => {
      doc.setFillColor(fill.r, fill.g, fill.b);
      doc.roundedRect(x, yPos, w, h, radius, radius, "F");
    };

    // Parse patients data
    interface PatientData {
      name: string; date: string; amount: number; finance: boolean;
      financeFee?: number;
      durationMins?: number; hourlyRate?: number; treatment?: string;
    }
    const patients: PatientData[] = JSON.parse(String(entry.private_patients_json) || "[]");

    // Calculate additional analytics from patient data
    const patientsWithData = patients.filter(p => p.durationMins && p.durationMins > 0);
    const sortedByHourlyRate = [...patientsWithData].sort((a, b) => (b.hourlyRate || 0) - (a.hourlyRate || 0));
    const sortedByAmount = [...patients].sort((a, b) => b.amount - a.amount);
    const totalBilled = patients.reduce((s, p) => s + p.amount, 0);
    const avgTicket = patients.length > 0 ? totalBilled / patients.length : 0;
    const highestTicket = sortedByAmount[0];

    // Group by treatment
    const treatmentMap = new Map<string, { total: number; count: number; mins: number }>();
    for (const p of patients) {
      const treatment = p.treatment || "General";
      const existing = treatmentMap.get(treatment) || { total: 0, count: 0, mins: 0 };
      existing.total += p.amount;
      existing.count += 1;
      existing.mins += p.durationMins || 0;
      treatmentMap.set(treatment, existing);
    }
    const topTreatments = Array.from(treatmentMap.entries())
      .map(([name, data]) => ({ name, ...data, hourlyRate: data.mins > 0 ? (data.total / data.mins) * 60 : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // ========== PAGE 1: EXECUTIVE SUMMARY ==========

    // Top accent bar
    doc.setFillColor(navy.r, navy.g, navy.b);
    doc.rect(0, 0, pageWidth, 6, "F");
    doc.setFillColor(blue600.r, blue600.g, blue600.b);
    doc.rect(0, 6, pageWidth, 1.5, "F");

    y = 20;

    // Header row
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(slate500.r, slate500.g, slate500.b);
    doc.text(clinicName.toUpperCase(), 15, y);

    // PAYSLIP badge right side
    drawCard(pageWidth - 45, y - 6, 32, 10, slate100);
    doc.setFontSize(7);
    doc.setTextColor(blue600.r, blue600.g, blue600.b);
    doc.text("PAYSLIP", pageWidth - 29, y, { align: "center" });

    y += 12;

    // Dentist name
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(navy.r, navy.g, navy.b);
    doc.text(entry.dentist_name, 15, y);

    y += 7;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(slate500.r, slate500.g, slate500.b);
    const subline: string[] = [];
    if (entry.performer_number) subline.push(`Performer: ${entry.performer_number}`);
    subline.push(`${entry.split_percentage}% Split`);
    subline.push(`${getMonthName(entry.month)} ${entry.year}`);
    doc.text(subline.join("  |  "), 15, y);

    // ========== NET PAY HERO ==========
    y += 10;
    const heroHeight = 50;

    drawCard(15, y, pageWidth - 30, heroHeight, navy, 4);
    doc.setFillColor(amber500.r, amber500.g, amber500.b);
    doc.rect(15, y + 6, 3, heroHeight - 12, "F");

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(slate300.r, slate300.g, slate300.b);
    doc.text("NET PAY", 26, y + 14);

    doc.setFontSize(32);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(white.r, white.g, white.b);
    doc.text(formatCurrency(calc.netPay), 26, y + 36);

    // Right side info - period only
    doc.setFontSize(7);
    doc.setTextColor(slate300.r, slate300.g, slate300.b);
    doc.text("PERIOD", pageWidth - 25, y + 14, { align: "right" });
    doc.setFontSize(9);
    doc.setTextColor(white.r, white.g, white.b);
    const periodStart = new Date(entry.year, entry.month - 1, 1);
    const periodEnd = new Date(entry.year, entry.month, 0);
    doc.text(`${periodStart.getDate()}-${periodEnd.getDate()} ${getMonthName(entry.month).substring(0, 3)} ${entry.year}`, pageWidth - 25, y + 22, { align: "right" });

    y += heroHeight + 8;

    // ========== KEY PERFORMANCE METRICS ==========
    if (analytics && analytics.totalChairMins > 0) {
      const cardW = (pageWidth - 40) / 5;
      const cardH = 35;
      const gap = 2.5;
      let cardX = 15;

      const metrics = [
        { label: "CHAIR TIME", value: `${(analytics.totalChairMins / 60).toFixed(1)}h`, color: slate100 },
        { label: "GROSS/HR", value: formatCurrency(analytics.grossPerHour), color: slate100 },
        { label: "NET/HR", value: formatCurrency(analytics.netPerHour), color: emerald50, highlight: true },
        { label: "PATIENTS", value: String(analytics.totalPatients), color: slate100 },
        { label: "AVG TICKET", value: formatCurrency(avgTicket), color: slate100 },
      ];

      for (const m of metrics) {
        drawCard(cardX, y, cardW, cardH, m.color, 3);
        doc.setFontSize(6);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(slate500.r, slate500.g, slate500.b);
        doc.text(m.label, cardX + 5, y + 10);
        doc.setFontSize(13);
        doc.setTextColor(m.highlight ? emerald600.r : navy.r, m.highlight ? emerald600.g : navy.g, m.highlight ? emerald600.b : navy.b);
        doc.text(m.value, cardX + 5, y + 24);
        cardX += cardW + gap;
      }
      y += cardH + 10;
    }

    // ========== EARNINGS & DEDUCTIONS SIDE BY SIDE ==========
    const colWidth = (pageWidth - 40) / 2;
    const startY = y;

    // EARNINGS
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(emerald600.r, emerald600.g, emerald600.b);
    doc.text("EARNINGS", 15, y);
    doc.setDrawColor(emerald600.r, emerald600.g, emerald600.b);
    doc.setLineWidth(1);
    doc.line(15, y + 1.5, 15 + doc.getTextWidth("EARNINGS"), y + 1.5);

    const earningsRows: [string, string][] = [
      ["Gross Private Income", formatCurrency(calc.grossPrivate)],
      [`Net Private (${calc.splitPercentage}%)`, formatCurrency(calc.netPrivate)],
    ];
    if (dentist.is_nhs) {
      earningsRows.push([`NHS UDAs (${calc.nhsUdas} × £${calc.udaRate})`, formatCurrency(calc.nhsIncome)]);
    }

    autoTable(doc, {
      startY: y + 4,
      body: earningsRows,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 0, right: 3 }, textColor: [slate700.r, slate700.g, slate700.b] },
      columnStyles: { 0: { cellWidth: colWidth - 35 }, 1: { halign: "right", fontStyle: "bold" } },
      margin: { left: 15, right: pageWidth - 15 - colWidth },
      tableWidth: colWidth,
    });

    const earningsEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    drawCard(15, earningsEndY + 1, colWidth, 14, emerald50, 2);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(emerald600.r, emerald600.g, emerald600.b);
    doc.text("Total Earnings", 18, earningsEndY + 9);
    doc.text(formatCurrency(calc.totalEarnings), 15 + colWidth - 3, earningsEndY + 9, { align: "right" });

    // DEDUCTIONS
    const deductX = 15 + colWidth + 10;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(red600.r, red600.g, red600.b);
    doc.text("DEDUCTIONS", deductX, startY);
    doc.setDrawColor(red600.r, red600.g, red600.b);
    doc.setLineWidth(1);
    doc.line(deductX, startY + 1.5, deductX + doc.getTextWidth("DEDUCTIONS"), startY + 1.5);

    interface LabBill { lab_name: string; amount: number }
    const labBills: LabBill[] = entry.lab_bills_json ? JSON.parse(String(entry.lab_bills_json)) : [];

    const deductRows: [string, string][] = [];
    if (calc.labBillsTotal > 0) {
      const labSplitPct = Math.round((calc.labBillsDeduction / calc.labBillsTotal) * 100);
      for (const lb of labBills) {
        if (lb.amount > 0) {
          const lbDeduction = Math.round(lb.amount * (labSplitPct / 100) * 100) / 100;
          const name = lb.lab_name || "Lab Bill";
          deductRows.push([`${name} (${labSplitPct}%)`, formatCurrency(lbDeduction)]);
        }
      }
    }
    if (calc.financeFeesDeduction > 0) deductRows.push(["Finance Fees (50%)", formatCurrency(calc.financeFeesDeduction)]);
    if (calc.therapyDeduction > 0) deductRows.push([`Therapy (${calc.therapyMinutes}min)`, formatCurrency(calc.therapyDeduction)]);
    for (const adj of calc.adjustments) deductRows.push([adj.description, formatCurrency(adj.amount)]);

    if (deductRows.length > 0) {
      autoTable(doc, {
        startY: startY + 4,
        body: deductRows,
        theme: "plain",
        styles: { fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 0, right: 3 }, textColor: [slate700.r, slate700.g, slate700.b] },
        columnStyles: { 0: { cellWidth: colWidth - 35 }, 1: { halign: "right", fontStyle: "bold" } },
        margin: { left: deductX, right: 15 },
        tableWidth: colWidth,
      });
    }

    drawCard(deductX, earningsEndY + 1, colWidth, 14, red50, 2);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(red600.r, red600.g, red600.b);
    doc.text("Total Deductions", deductX + 3, earningsEndY + 9);
    doc.text(formatCurrency(calc.totalDeductions), deductX + colWidth - 3, earningsEndY + 9, { align: "right" });

    y = earningsEndY + 22;

    // ========== TOP PERFORMERS SECTION ==========
    if (sortedByHourlyRate.length > 0) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(amber500.r, amber500.g, amber500.b);
      doc.text("TOP PERFORMERS BY £/HOUR", 15, y);
      doc.setDrawColor(amber500.r, amber500.g, amber500.b);
      doc.setLineWidth(1);
      doc.line(15, y + 1.5, 15 + doc.getTextWidth("TOP PERFORMERS BY £/HOUR"), y + 1.5);

      y += 6;

      // Show top 5 patients by hourly rate
      const topPerformers = sortedByHourlyRate.slice(0, 5);
      autoTable(doc, {
        startY: y,
        head: [["#", "Patient", "Amount", "Time", "£/Hour"]],
        body: topPerformers.map((p, i) => [
          String(i + 1),
          p.name.length > 20 ? p.name.substring(0, 18) + "..." : p.name,
          formatCurrency(p.amount),
          `${p.durationMins}m`,
          formatCurrency(p.hourlyRate || 0),
        ]),
        theme: "plain",
        headStyles: { fillColor: [amber50.r, amber50.g, amber50.b], textColor: [amber500.r, amber500.g, amber500.b], fontSize: 7, fontStyle: "bold", cellPadding: 2 },
        bodyStyles: { fontSize: 7, cellPadding: 2 },
        styles: { textColor: [slate700.r, slate700.g, slate700.b] },
        columnStyles: {
          0: { cellWidth: 8, halign: "center" },
          1: { cellWidth: 45 },
          2: { halign: "right", cellWidth: 22 },
          3: { halign: "center", cellWidth: 15 },
          4: { halign: "right", cellWidth: 22, fontStyle: "bold", textColor: [emerald600.r, emerald600.g, emerald600.b] },
        },
        margin: { left: 15, right: pageWidth / 2 + 5 },
        tableWidth: (pageWidth - 40) / 2,
      });

      // TOP TREATMENTS on the right
      if (topTreatments.length > 0) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(blue600.r, blue600.g, blue600.b);
        doc.text("TOP TREATMENTS BY REVENUE", pageWidth / 2 + 5, y - 6);

        autoTable(doc, {
          startY: y,
          head: [["Treatment", "Revenue", "Count"]],
          body: topTreatments.map(t => [
            t.name.length > 22 ? t.name.substring(0, 20) + "..." : t.name,
            formatCurrency(t.total),
            String(t.count),
          ]),
          theme: "plain",
          headStyles: { fillColor: [slate100.r, slate100.g, slate100.b], textColor: [blue600.r, blue600.g, blue600.b], fontSize: 7, fontStyle: "bold", cellPadding: 2 },
          bodyStyles: { fontSize: 7, cellPadding: 2 },
          styles: { textColor: [slate700.r, slate700.g, slate700.b] },
          columnStyles: {
            0: { cellWidth: 50 },
            1: { halign: "right", cellWidth: 22, fontStyle: "bold" },
            2: { halign: "center", cellWidth: 15 },
          },
          margin: { left: pageWidth / 2 + 5, right: 15 },
          tableWidth: (pageWidth - 40) / 2,
        });
      }

      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    // ========== HIGHEST TICKET HIGHLIGHT ==========
    if (highestTicket && highestTicket.amount > 500) {
      drawCard(15, y, pageWidth - 30, 18, amber50, 3);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(amber500.r, amber500.g, amber500.b);
      doc.text("HIGHEST TICKET", 20, y + 7);
      doc.setFontSize(10);
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text(`${highestTicket.name} - ${formatCurrency(highestTicket.amount)}`, 20, y + 14);
      if (highestTicket.treatment) {
        doc.setFontSize(7);
        doc.setTextColor(slate500.r, slate500.g, slate500.b);
        doc.text(highestTicket.treatment, pageWidth - 20, y + 10, { align: "right" });
      }
      y += 22;
    }

    // ========== PAGE 2: COMPACT PATIENT BREAKDOWN ==========
    if (patients.length > 0) {
      doc.addPage();

      doc.setFillColor(navy.r, navy.g, navy.b);
      doc.rect(0, 0, pageWidth, 6, "F");
      doc.setFillColor(blue600.r, blue600.g, blue600.b);
      doc.rect(0, 6, pageWidth, 1.5, "F");

      y = 18;

      // Quick stats bar
      drawCard(15, y, pageWidth - 30, 22, slate100, 3);
      const qsX = 22;
      const qsW = (pageWidth - 50) / 4;
      const totalMins = patientsWithData.reduce((s, p) => s + (p.durationMins || 0), 0);
      const avgHr = patientsWithData.length > 0 ? patientsWithData.reduce((s, p) => s + (p.hourlyRate || 0), 0) / patientsWithData.length : 0;

      const quickStats = [
        { label: "PATIENTS", val: String(patients.length) },
        { label: "TOTAL BILLED", val: formatCurrency(totalBilled) },
        { label: "CHAIR TIME", val: totalMins > 0 ? `${(totalMins / 60).toFixed(1)}h` : "N/A" },
        { label: "AVG £/HR", val: avgHr > 0 ? formatCurrency(avgHr) : "N/A" },
      ];

      for (let i = 0; i < quickStats.length; i++) {
        doc.setFontSize(6);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(slate500.r, slate500.g, slate500.b);
        doc.text(quickStats[i].label, qsX + i * qsW, y + 8);
        doc.setFontSize(12);
        doc.setTextColor(navy.r, navy.g, navy.b);
        doc.text(quickStats[i].val, qsX + i * qsW, y + 17);
      }

      y += 28;

      // Section title
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text("PATIENT BREAKDOWN", 15, y);
      doc.setDrawColor(blue600.r, blue600.g, blue600.b);
      doc.setLineWidth(1.5);
      doc.line(15, y + 2, 15 + doc.getTextWidth("PATIENT BREAKDOWN"), y + 2);

      y += 6;

      const hasRichData = patients.some(p => p.durationMins && p.durationMins > 0);

      if (hasRichData) {
        // Compact rich table
        autoTable(doc, {
          startY: y,
          head: [["Patient", "Date", "Treatment", "Amount", "Mins", "£/hr"]],
          body: patients.map(p => [
            p.name.length > 18 ? p.name.substring(0, 16) + "..." : p.name,
            new Date(p.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }),
            (p.treatment || "-").length > 20 ? (p.treatment || "-").substring(0, 18) + "..." : (p.treatment || "-"),
            formatCurrency(p.amount),
            p.durationMins ? String(p.durationMins) : "-",
            p.hourlyRate ? formatCurrency(p.hourlyRate) : "-",
          ]),
          theme: "striped",
          headStyles: {
            fillColor: [navy.r, navy.g, navy.b],
            textColor: [255, 255, 255],
            fontSize: 6.5,
            fontStyle: "bold",
            cellPadding: 2,
          },
          bodyStyles: {
            fontSize: 6.5,
            cellPadding: 1.5,
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          styles: {
            textColor: [slate700.r, slate700.g, slate700.b],
            overflow: "ellipsize",
          },
          columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 18 },
            2: { cellWidth: 45 },
            3: { halign: "right", cellWidth: 22 },
            4: { halign: "center", cellWidth: 14 },
            5: { halign: "right", cellWidth: 20 },
          },
          margin: { left: 15, right: 15 },
          didParseCell: (data) => {
            if (data.section === "body" && data.column.index === 5) {
              const patient = patients[data.row.index];
              if (patient && patient.hourlyRate && patient.hourlyRate > 300) {
                data.cell.styles.textColor = [emerald600.r, emerald600.g, emerald600.b];
                data.cell.styles.fontStyle = "bold";
              }
            }
          },
        });
      } else {
        // Simple compact table
        autoTable(doc, {
          startY: y,
          head: [["Patient", "Date", "Amount", "Fin. Fee"]],
          body: patients.map(p => [
            p.name.length > 25 ? p.name.substring(0, 23) + "..." : p.name,
            new Date(p.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }),
            formatCurrency(p.amount),
            p.financeFee ? formatCurrency(p.financeFee) : "",
          ]),
          theme: "striped",
          headStyles: {
            fillColor: [navy.r, navy.g, navy.b],
            textColor: [255, 255, 255],
            fontSize: 7,
            fontStyle: "bold",
            cellPadding: 2.5,
          },
          bodyStyles: {
            fontSize: 7,
            cellPadding: 2,
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          styles: {
            textColor: [slate700.r, slate700.g, slate700.b],
          },
          columnStyles: {
            0: { cellWidth: 60 },
            1: { cellWidth: 22 },
            2: { halign: "right", cellWidth: 30 },
            3: { halign: "center", cellWidth: 20 },
          },
          margin: { left: 15, right: 15 },
        });
      }
    }

    // ========== FOOTER ON ALL PAGES ==========
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const footerY = pageHeight - 10;

      doc.setDrawColor(slate300.r, slate300.g, slate300.b);
      doc.setLineWidth(0.2);
      doc.line(15, footerY - 4, pageWidth - 15, footerY - 4);

      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(slate500.r, slate500.g, slate500.b);
      doc.text(clinicName, 15, footerY);
      doc.text(clinicWebsite, pageWidth / 2, footerY, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.text(`${i}/${pageCount}`, pageWidth - 15, footerY, { align: "right" });

      doc.setFillColor(blue600.r, blue600.g, blue600.b);
      doc.rect(0, pageHeight - 2, pageWidth, 2, "F");
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
