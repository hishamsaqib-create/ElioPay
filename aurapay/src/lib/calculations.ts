import { Dentist, LabBillItem, AdjustmentItem, PayslipEntry, safeJsonParse, getSetting } from "./db";

export interface PayslipCalculation {
  grossPrivate: number;
  splitPercentage: number;
  netPrivate: number;
  nhsUdas: number;
  udaRate: number;
  nhsIncome: number;
  labBills: LabBillItem[];
  labBillsTotal: number;
  labBillsDeduction: number;
  financeFees: number;
  financeFeesDeduction: number;
  therapyMinutes: number;
  therapyRate: number;
  therapyDeduction: number;
  adjustments: AdjustmentItem[];
  adjustmentsTotal: number;
  totalDeductions: number;
  totalEarnings: number;
  netPay: number;
  // Warnings for edge cases
  warnings: string[];
  isNegative: boolean;
}

// Round to 2 decimal places consistently
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// Synchronous calculation (uses provided settings)
export function calculatePayslip(
  entry: PayslipEntry,
  dentist: Dentist,
  labBillSplit = 0.5,
  financeFeeSplit = 0.5
): PayslipCalculation {
  const warnings: string[] = [];

  // Safe parse JSON fields
  const labBills = safeJsonParse<LabBillItem[]>(entry.lab_bills_json, []);
  const adjustments = safeJsonParse<AdjustmentItem[]>(entry.adjustments_json, []);

  // Validate and clamp split percentage
  let splitPercentage = dentist.split_percentage;
  if (splitPercentage < 0 || splitPercentage > 100) {
    warnings.push(`Invalid split percentage (${splitPercentage}%), clamped to 0-100 range`);
    splitPercentage = Math.max(0, Math.min(100, splitPercentage));
  }

  // Calculate net private income — derive gross from patient amounts when available
  const patientAmounts = safeJsonParse<{ amount: number }[]>(entry.private_patients_json, []);
  const grossPrivate = patientAmounts.length > 0
    ? roundCurrency(patientAmounts.reduce((s, p) => s + (p.amount || 0), 0))
    : Math.max(0, entry.gross_private);
  const netPrivate = roundCurrency(grossPrivate * (splitPercentage / 100));

  // Calculate NHS income (only for NHS dentists)
  let nhsIncome = 0;
  const nhsUdas = Math.max(0, entry.nhs_udas);
  const udaRate = Math.max(0, dentist.uda_rate);

  if (dentist.is_nhs === 1) {
    nhsIncome = roundCurrency(nhsUdas * udaRate);
  } else if (nhsUdas > 0) {
    warnings.push(`UDAs (${nhsUdas}) entered for non-NHS dentist - not counted in income`);
  }

  // Calculate lab bills deduction
  const validLabBills = labBills.filter(b => b.amount > 0);
  const labBillsTotal = roundCurrency(validLabBills.reduce((s, b) => s + b.amount, 0));
  const labBillsDeduction = roundCurrency(labBillsTotal * labBillSplit);

  // Calculate finance fees deduction
  const financeFees = Math.max(0, entry.finance_fees);
  const financeFeesDeduction = roundCurrency(financeFees * financeFeeSplit);

  // Calculate therapy deduction
  const therapyMinutes = Math.max(0, entry.therapy_minutes);
  const therapyRate = entry.therapy_rate > 0 ? entry.therapy_rate : 0.5833;
  const therapyDeduction = roundCurrency(therapyMinutes * therapyRate);

  // Calculate adjustments
  let adjustmentsTotal = 0;
  for (const adj of adjustments) {
    if (typeof adj.amount !== "number" || adj.amount < 0) {
      warnings.push(`Invalid adjustment amount for "${adj.description}"`);
      continue;
    }
    if (adj.type === "addition") {
      adjustmentsTotal += adj.amount;
    } else if (adj.type === "deduction") {
      adjustmentsTotal -= adj.amount;
    }
  }
  adjustmentsTotal = roundCurrency(adjustmentsTotal);

  // Calculate totals
  const totalEarnings = roundCurrency(netPrivate + nhsIncome);
  const totalDeductions = roundCurrency(labBillsDeduction + financeFeesDeduction + therapyDeduction);
  const netPay = roundCurrency(totalEarnings - totalDeductions + adjustmentsTotal);

  // Check for negative pay
  const isNegative = netPay < 0;
  if (isNegative) {
    warnings.push(`WARNING: Net pay is negative (£${netPay.toFixed(2)}). Deductions exceed earnings.`);
  }

  return {
    grossPrivate,
    splitPercentage,
    netPrivate,
    nhsUdas,
    udaRate,
    nhsIncome,
    labBills: validLabBills,
    labBillsTotal,
    labBillsDeduction,
    financeFees,
    financeFeesDeduction,
    therapyMinutes,
    therapyRate,
    therapyDeduction,
    adjustments,
    adjustmentsTotal,
    totalDeductions,
    totalEarnings,
    netPay,
    warnings,
    isNegative,
  };
}

// Async calculation that loads settings from database
export async function calculatePayslipWithSettings(
  entry: PayslipEntry,
  dentist: Dentist
): Promise<PayslipCalculation> {
  const labBillSplit = await getSetting("lab_bill_split", 0.5);
  const financeFeeSplit = await getSetting("finance_fee_split", 0.5);

  return calculatePayslip(entry, dentist, labBillSplit, financeFeeSplit);
}

// Format currency for display
export function formatCurrency(amount: number): string {
  // Handle edge cases
  if (!isFinite(amount)) return "£0.00";

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Get month name with validation
export function getMonthName(month: number): string {
  // Validate month
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    console.warn(`Invalid month: ${month}, defaulting to January`);
    month = 1;
  }
  return new Date(2000, month - 1).toLocaleString("en-GB", { month: "long" });
}

// Calculate summary statistics
export interface PayslipSummary {
  totalGrossPrivate: number;
  totalNetPrivate: number;
  totalNhsIncome: number;
  totalLabBills: number;
  totalFinanceFees: number;
  totalTherapy: number;
  totalDeductions: number;
  totalEarnings: number;
  totalNetPay: number;
  dentistCount: number;
  hasWarnings: boolean;
}

export function calculatePeriodSummary(calculations: PayslipCalculation[]): PayslipSummary {
  const summary: PayslipSummary = {
    totalGrossPrivate: 0,
    totalNetPrivate: 0,
    totalNhsIncome: 0,
    totalLabBills: 0,
    totalFinanceFees: 0,
    totalTherapy: 0,
    totalDeductions: 0,
    totalEarnings: 0,
    totalNetPay: 0,
    dentistCount: calculations.length,
    hasWarnings: false,
  };

  for (const calc of calculations) {
    summary.totalGrossPrivate += calc.grossPrivate;
    summary.totalNetPrivate += calc.netPrivate;
    summary.totalNhsIncome += calc.nhsIncome;
    summary.totalLabBills += calc.labBillsTotal;
    summary.totalFinanceFees += calc.financeFees;
    summary.totalTherapy += calc.therapyDeduction;
    summary.totalDeductions += calc.totalDeductions;
    summary.totalEarnings += calc.totalEarnings;
    summary.totalNetPay += calc.netPay;
    if (calc.warnings.length > 0) {
      summary.hasWarnings = true;
    }
  }

  // Round all totals
  summary.totalGrossPrivate = roundCurrency(summary.totalGrossPrivate);
  summary.totalNetPrivate = roundCurrency(summary.totalNetPrivate);
  summary.totalNhsIncome = roundCurrency(summary.totalNhsIncome);
  summary.totalLabBills = roundCurrency(summary.totalLabBills);
  summary.totalFinanceFees = roundCurrency(summary.totalFinanceFees);
  summary.totalTherapy = roundCurrency(summary.totalTherapy);
  summary.totalDeductions = roundCurrency(summary.totalDeductions);
  summary.totalEarnings = roundCurrency(summary.totalEarnings);
  summary.totalNetPay = roundCurrency(summary.totalNetPay);

  return summary;
}
