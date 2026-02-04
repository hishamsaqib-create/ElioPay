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
    const navy = { r: 15, g: 23, b: 42 };           // #0F172A
    const slate700 = { r: 51, g: 65, b: 85 };      // #334155
    const slate500 = { r: 100, g: 116, b: 139 };   // #64748B
    const slate300 = { r: 203, g: 213, b: 225 };   // #CBD5E1
    const slate100 = { r: 241, g: 245, b: 249 };   // #F1F5F9
    const blue600 = { r: 37, g: 99, b: 235 };      // #2563EB
    const emerald600 = { r: 5, g: 150, b: 105 };   // #059669
    const emerald50 = { r: 236, g: 253, b: 245 };  // #ECFDF5
    const red600 = { r: 220, g: 38, b: 38 };       // #DC2626
    const red50 = { r: 254, g: 242, b: 242 };      // #FEF2F2
    const amber500 = { r: 245, g: 158, b: 11 };    // #F59E0B
    const white = { r: 255, g: 255, b: 255 };

    // Helper function for rounded rectangles with fill
    const drawCard = (x: number, yPos: number, w: number, h: number, fill: {r: number, g: number, b: number}, radius = 3) => {
      doc.setFillColor(fill.r, fill.g, fill.b);
      doc.roundedRect(x, yPos, w, h, radius, radius, "F");
    };

    // ========== PAGE 1: EXECUTIVE SUMMARY ==========

    // Top gradient bar
    doc.setFillColor(navy.r, navy.g, navy.b);
    doc.rect(0, 0, pageWidth, 8, "F");
    doc.setFillColor(blue600.r, blue600.g, blue600.b);
    doc.rect(0, 8, pageWidth, 2, "F");

    y = 25;

    // Header: Clinic name and document type
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(slate500.r, slate500.g, slate500.b);
    doc.text(clinicName.toUpperCase(), 20, y);

    // PAYSLIP badge
    drawCard(pageWidth - 55, y - 8, 40, 12, slate100);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(blue600.r, blue600.g, blue600.b);
    doc.text("PAYSLIP", pageWidth - 35, y - 1, { align: "center" });

    y += 15;

    // Dentist name - large and prominent
    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(navy.r, navy.g, navy.b);
    doc.text(entry.dentist_name, 20, y);

    y += 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(slate500.r, slate500.g, slate500.b);
    const subline: string[] = [];
    if (entry.performer_number) subline.push(`Performer No: ${entry.performer_number}`);
    subline.push(`${entry.split_percentage}% Revenue Split`);
    subline.push(`${getMonthName(entry.month)} ${entry.year}`);
    doc.text(subline.join("   •   "), 20, y);

    // ========== NET PAY HERO SECTION ==========
    y += 18;
    const heroHeight = 70;

    // Dark card background
    drawCard(20, y, pageWidth - 40, heroHeight, navy, 6);

    // Accent stripe on left
    doc.setFillColor(amber500.r, amber500.g, amber500.b);
    doc.rect(20, y + 8, 4, heroHeight - 16, "F");

    // NET PAY label
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(slate300.r, slate300.g, slate300.b);
    doc.text("NET PAY", 35, y + 20);

    // NET PAY amount - massive
    doc.setFontSize(42);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(white.r, white.g, white.b);
    doc.text(formatCurrency(calc.netPay), 35, y + 48);

    // Right side - Issue date
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(slate300.r, slate300.g, slate300.b);
    doc.text("ISSUED", pageWidth - 35, y + 20, { align: "right" });
    doc.setFontSize(11);
    doc.setTextColor(white.r, white.g, white.b);
    const today = new Date();
    doc.text(today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), pageWidth - 35, y + 32, { align: "right" });

    // Period
    doc.setFontSize(8);
    doc.setTextColor(slate300.r, slate300.g, slate300.b);
    doc.text("PERIOD", pageWidth - 35, y + 45, { align: "right" });
    doc.setFontSize(10);
    doc.setTextColor(white.r, white.g, white.b);
    const periodStart = new Date(entry.year, entry.month - 1, 1);
    const periodEnd = new Date(entry.year, entry.month, 0);
    const formatShort = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    doc.text(`${formatShort(periodStart)} - ${formatShort(periodEnd)}`, pageWidth - 35, y + 55, { align: "right" });

    y += heroHeight + 15;

    // ========== KEY METRICS CARDS ==========
    if (analytics && analytics.totalChairMins > 0) {
      const cardWidth = (pageWidth - 50) / 4;
      const cardHeight = 45;
      const cardGap = 3.3;
      let cardX = 20;

      const metrics = [
        { label: "CHAIR TIME", value: `${(analytics.totalChairMins / 60).toFixed(1)}h`, sub: `${analytics.totalChairMins} mins` },
        { label: "GROSS £/HOUR", value: formatCurrency(analytics.grossPerHour), sub: "before split" },
        { label: "NET £/HOUR", value: formatCurrency(analytics.netPerHour), sub: `at ${entry.split_percentage}%` },
        { label: "PATIENTS", value: String(analytics.totalPatients), sub: `${analytics.avgAppointmentMins}min avg` },
      ];

      for (const m of metrics) {
        drawCard(cardX, y, cardWidth, cardHeight, slate100, 4);

        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(slate500.r, slate500.g, slate500.b);
        doc.text(m.label, cardX + 8, y + 12);

        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(navy.r, navy.g, navy.b);
        doc.text(m.value, cardX + 8, y + 28);

        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(slate500.r, slate500.g, slate500.b);
        doc.text(m.sub, cardX + 8, y + 36);

        cardX += cardWidth + cardGap;
      }
      y += cardHeight + 15;
    }

    // ========== EARNINGS & DEDUCTIONS SIDE BY SIDE ==========
    const colWidth = (pageWidth - 50) / 2;
    const startY = y;

    // --- EARNINGS COLUMN ---
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(emerald600.r, emerald600.g, emerald600.b);
    doc.text("EARNINGS", 20, y);
    doc.setDrawColor(emerald600.r, emerald600.g, emerald600.b);
    doc.setLineWidth(1.5);
    doc.line(20, y + 2, 20 + doc.getTextWidth("EARNINGS"), y + 2);

    const earningsRows: [string, string][] = [
      ["Gross Private", formatCurrency(calc.grossPrivate)],
      [`Net Private (${calc.splitPercentage}%)`, formatCurrency(calc.netPrivate)],
    ];
    if (dentist.is_nhs) {
      earningsRows.push([`NHS (${calc.nhsUdas} UDAs)`, formatCurrency(calc.nhsIncome)]);
    }

    autoTable(doc, {
      startY: y + 5,
      body: earningsRows,
      theme: "plain",
      styles: { fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 0, right: 5 }, textColor: [slate700.r, slate700.g, slate700.b] },
      columnStyles: { 0: { cellWidth: colWidth - 45 }, 1: { halign: "right", fontStyle: "bold" } },
      margin: { left: 20, right: pageWidth - 20 - colWidth },
      tableWidth: colWidth,
    });

    // Total earnings
    const earningsEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    drawCard(20, earningsEndY + 2, colWidth, 20, emerald50, 3);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(emerald600.r, emerald600.g, emerald600.b);
    doc.text("Total Earnings", 25, earningsEndY + 14);
    doc.text(formatCurrency(calc.totalEarnings), 20 + colWidth - 5, earningsEndY + 14, { align: "right" });

    // --- DEDUCTIONS COLUMN ---
    const deductX = 20 + colWidth + 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(red600.r, red600.g, red600.b);
    doc.text("DEDUCTIONS", deductX, startY);
    doc.setDrawColor(red600.r, red600.g, red600.b);
    doc.setLineWidth(1.5);
    doc.line(deductX, startY + 2, deductX + doc.getTextWidth("DEDUCTIONS"), startY + 2);

    // Parse lab bills
    interface LabBill { lab_name: string; amount: number }
    const labBills: LabBill[] = entry.lab_bills_json ? JSON.parse(String(entry.lab_bills_json)) : [];

    const deductRows: [string, string][] = [];
    if (calc.labBillsTotal > 0) {
      deductRows.push([`Lab Bills (50%)`, formatCurrency(calc.labBillsDeduction)]);
    }
    if (calc.financeFeesDeduction > 0) {
      deductRows.push(["Finance Fees (50%)", formatCurrency(calc.financeFeesDeduction)]);
    }
    if (calc.therapyDeduction > 0) {
      deductRows.push([`Therapy (${calc.therapyMinutes}min)`, formatCurrency(calc.therapyDeduction)]);
    }
    for (const adj of calc.adjustments) {
      deductRows.push([adj.description, formatCurrency(adj.amount)]);
    }

    if (deductRows.length > 0) {
      autoTable(doc, {
        startY: startY + 5,
        body: deductRows,
        theme: "plain",
        styles: { fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 0, right: 5 }, textColor: [slate700.r, slate700.g, slate700.b] },
        columnStyles: { 0: { cellWidth: colWidth - 45 }, 1: { halign: "right", fontStyle: "bold" } },
        margin: { left: deductX, right: 20 },
        tableWidth: colWidth,
      });
    }

    // Total deductions
    drawCard(deductX, earningsEndY + 2, colWidth, 20, red50, 3);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(red600.r, red600.g, red600.b);
    doc.text("Total Deductions", deductX + 5, earningsEndY + 14);
    doc.text(formatCurrency(calc.totalDeductions), deductX + colWidth - 5, earningsEndY + 14, { align: "right" });

    y = earningsEndY + 30;

    // ========== NHS PERIOD INFO (if applicable) ==========
    if (dentist.is_nhs && entry.nhs_period_start && entry.nhs_period_end) {
      const nhsStart = new Date(entry.nhs_period_start + "T00:00:00");
      const nhsEnd = new Date(entry.nhs_period_end + "T00:00:00");
      const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

      drawCard(20, y, pageWidth - 40, 16, slate100, 3);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(slate500.r, slate500.g, slate500.b);
      doc.text(`NHS Schedule Period: ${formatDate(nhsStart)} - ${formatDate(nhsEnd)}`, pageWidth / 2, y + 10, { align: "center" });
      y += 25;
    }

    // ========== LAB BILLS DETAIL (if any) ==========
    if (labBills.length > 0 && y < 220) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(slate700.r, slate700.g, slate700.b);
      doc.text("Lab Bill Details", 20, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        head: [["Lab", "Amount"]],
        body: labBills.map(lb => [lb.lab_name, formatCurrency(lb.amount)]),
        theme: "plain",
        headStyles: { fillColor: [slate100.r, slate100.g, slate100.b], textColor: [slate500.r, slate500.g, slate500.b], fontSize: 7, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 3, textColor: [slate700.r, slate700.g, slate700.b] },
        columnStyles: { 1: { halign: "right" } },
        margin: { left: 20, right: pageWidth / 2 + 10 },
        tableWidth: (pageWidth - 40) / 2,
      });
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }

    // ========== THERAPY REFERRALS (if any) ==========
    interface TherapyItem { patientName: string; date: string; minutes: number; therapistName?: string; cost: number }
    const therapyBreakdown: TherapyItem[] = entry.therapy_breakdown_json ? JSON.parse(String(entry.therapy_breakdown_json)) : [];

    if (therapyBreakdown.length > 0 && y < 200) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(slate700.r, slate700.g, slate700.b);
      doc.text("Therapy Referrals", 20, y);
      y += 6;

      const therapyRows = therapyBreakdown.slice(0, 8).map(t => [
        t.patientName,
        new Date(t.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        `${t.minutes}min`,
        formatCurrency(t.cost),
      ]);
      const totalMins = therapyBreakdown.reduce((s, t) => s + t.minutes, 0);
      const totalCost = therapyBreakdown.reduce((s, t) => s + t.cost, 0);
      therapyRows.push(["TOTAL", "", `${totalMins}min`, formatCurrency(totalCost)]);

      autoTable(doc, {
        startY: y,
        head: [["Patient", "Date", "Duration", "Cost"]],
        body: therapyRows,
        theme: "plain",
        headStyles: { fillColor: [slate100.r, slate100.g, slate100.b], textColor: [slate500.r, slate500.g, slate500.b], fontSize: 7, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 3, textColor: [slate700.r, slate700.g, slate700.b] },
        columnStyles: { 2: { halign: "center" }, 3: { halign: "right" } },
        margin: { left: 20, right: 20 },
        didParseCell: (data) => {
          if (data.row.index === therapyRows.length - 1) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [slate100.r, slate100.g, slate100.b];
          }
        },
      });
    }

    // ========== PAGE 2+: PATIENT BREAKDOWN ==========
    interface PatientData {
      name: string; date: string; amount: number; finance: boolean;
      durationMins?: number; hourlyRate?: number; treatment?: string;
      status?: string; amountPaid?: number;
    }
    const patients: PatientData[] = JSON.parse(String(entry.private_patients_json) || "[]");

    if (patients.length > 0) {
      doc.addPage();

      // Page header
      doc.setFillColor(navy.r, navy.g, navy.b);
      doc.rect(0, 0, pageWidth, 8, "F");
      doc.setFillColor(blue600.r, blue600.g, blue600.b);
      doc.rect(0, 8, pageWidth, 2, "F");

      y = 25;

      // Summary stats bar
      const statsBarY = y;
      drawCard(20, statsBarY, pageWidth - 40, 35, slate100, 4);

      const totalAmount = patients.reduce((s, p) => s + p.amount, 0);
      const patientsWithDuration = patients.filter(p => p.durationMins && p.durationMins > 0);
      const avgHourlyRate = patientsWithDuration.length > 0
        ? patientsWithDuration.reduce((s, p) => s + (p.hourlyRate || 0), 0) / patientsWithDuration.length
        : 0;
      const totalMins = patientsWithDuration.reduce((s, p) => s + (p.durationMins || 0), 0);

      const statsX = 30;
      const statsWidth = (pageWidth - 80) / 4;

      // Stat 1: Total Patients
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(slate500.r, slate500.g, slate500.b);
      doc.text("PATIENTS", statsX, statsBarY + 12);
      doc.setFontSize(16);
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text(String(patients.length), statsX, statsBarY + 26);

      // Stat 2: Total Amount
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(slate500.r, slate500.g, slate500.b);
      doc.text("TOTAL BILLED", statsX + statsWidth, statsBarY + 12);
      doc.setFontSize(16);
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text(formatCurrency(totalAmount), statsX + statsWidth, statsBarY + 26);

      // Stat 3: Chair Time
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(slate500.r, slate500.g, slate500.b);
      doc.text("CHAIR TIME", statsX + statsWidth * 2, statsBarY + 12);
      doc.setFontSize(16);
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text(totalMins > 0 ? `${(totalMins / 60).toFixed(1)}h` : "N/A", statsX + statsWidth * 2, statsBarY + 26);

      // Stat 4: Avg £/Hour
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(slate500.r, slate500.g, slate500.b);
      doc.text("AVG £/HOUR", statsX + statsWidth * 3, statsBarY + 12);
      doc.setFontSize(16);
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text(avgHourlyRate > 0 ? formatCurrency(avgHourlyRate) : "N/A", statsX + statsWidth * 3, statsBarY + 26);

      y = statsBarY + 45;

      // Section title
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(navy.r, navy.g, navy.b);
      doc.text("PATIENT BREAKDOWN", 20, y);
      doc.setDrawColor(blue600.r, blue600.g, blue600.b);
      doc.setLineWidth(2);
      doc.line(20, y + 3, 20 + doc.getTextWidth("PATIENT BREAKDOWN"), y + 3);

      y += 10;

      // Check if we have rich data
      const hasRichData = patients.some(p => p.durationMins && p.durationMins > 0);

      if (hasRichData) {
        // Rich table with all data
        autoTable(doc, {
          startY: y,
          head: [["Patient", "Date", "Treatment", "Amount", "Mins", "£/hr"]],
          body: patients.map((p, idx) => [
            p.name.length > 22 ? p.name.substring(0, 20) + "..." : p.name,
            new Date(p.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
            (p.treatment || "").length > 25 ? (p.treatment || "").substring(0, 23) + "..." : (p.treatment || "-"),
            formatCurrency(p.amount),
            p.durationMins ? String(p.durationMins) : "-",
            p.hourlyRate ? formatCurrency(p.hourlyRate) : "-",
          ]),
          theme: "striped",
          headStyles: {
            fillColor: [navy.r, navy.g, navy.b],
            textColor: [255, 255, 255],
            fontSize: 8,
            fontStyle: "bold",
            cellPadding: 4,
          },
          bodyStyles: {
            fontSize: 8,
            cellPadding: 3,
          },
          alternateRowStyles: {
            fillColor: [slate100.r, slate100.g, slate100.b],
          },
          styles: {
            textColor: [slate700.r, slate700.g, slate700.b],
            lineColor: [slate300.r, slate300.g, slate300.b],
            lineWidth: 0.1,
          },
          columnStyles: {
            0: { cellWidth: 42 },
            1: { cellWidth: 22 },
            2: { cellWidth: 50 },
            3: { halign: "right", cellWidth: 25 },
            4: { halign: "center", cellWidth: 15 },
            5: { halign: "right", cellWidth: 22 },
          },
          margin: { left: 20, right: 20 },
          didParseCell: (data) => {
            // Highlight high earners
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
        // Simple table
        autoTable(doc, {
          startY: y,
          head: [["Patient", "Date", "Amount", "Finance"]],
          body: patients.map(p => [
            p.name.length > 28 ? p.name.substring(0, 26) + "..." : p.name,
            new Date(p.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
            formatCurrency(p.amount),
            p.finance ? "Yes" : "",
          ]),
          theme: "striped",
          headStyles: {
            fillColor: [navy.r, navy.g, navy.b],
            textColor: [255, 255, 255],
            fontSize: 9,
            fontStyle: "bold",
            cellPadding: 5,
          },
          bodyStyles: {
            fontSize: 9,
            cellPadding: 4,
          },
          alternateRowStyles: {
            fillColor: [slate100.r, slate100.g, slate100.b],
          },
          styles: {
            textColor: [slate700.r, slate700.g, slate700.b],
          },
          columnStyles: {
            0: { cellWidth: 70 },
            1: { cellWidth: 30 },
            2: { halign: "right", cellWidth: 35 },
            3: { halign: "center", cellWidth: 25 },
          },
          margin: { left: 20, right: 20 },
        });
      }
    }

    // ========== FOOTER ON ALL PAGES ==========
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const footerY = pageHeight - 12;

      // Footer line
      doc.setDrawColor(slate300.r, slate300.g, slate300.b);
      doc.setLineWidth(0.3);
      doc.line(20, footerY - 5, pageWidth - 20, footerY - 5);

      // Left: Clinic
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(slate500.r, slate500.g, slate500.b);
      doc.text(clinicName, 20, footerY);

      // Center: Website
      doc.text(clinicWebsite, pageWidth / 2, footerY, { align: "center" });

      // Right: Page number
      doc.setFont("helvetica", "bold");
      doc.text(`${i} / ${pageCount}`, pageWidth - 20, footerY, { align: "right" });

      // Bottom accent
      doc.setFillColor(blue600.r, blue600.g, blue600.b);
      doc.rect(0, pageHeight - 3, pageWidth, 3, "F");
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
