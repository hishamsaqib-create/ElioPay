import { Dentist, LabBillItem, AdjustmentItem, PayslipEntry } from "./db";

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
}

export function calculatePayslip(
  entry: PayslipEntry,
  dentist: Dentist,
  labBillSplit = 0.5,
  financeFeeSplit = 0.5
): PayslipCalculation {
  const labBills: LabBillItem[] = JSON.parse(entry.lab_bills_json || "[]");
  const adjustments: AdjustmentItem[] = JSON.parse(entry.adjustments_json || "[]");

  const splitPercentage = dentist.split_percentage;
  const netPrivate = entry.gross_private * (splitPercentage / 100);

  const nhsIncome = dentist.is_nhs ? entry.nhs_udas * dentist.uda_rate : 0;

  const labBillsTotal = labBills.reduce((s, b) => s + b.amount, 0);
  const labBillsDeduction = labBillsTotal * labBillSplit;

  const financeFeesDeduction = entry.finance_fees * financeFeeSplit;

  const therapyDeduction = entry.therapy_minutes * entry.therapy_rate;

  const adjustmentsTotal = adjustments.reduce(
    (s, a) => s + (a.type === "addition" ? a.amount : -a.amount),
    0
  );

  const totalEarnings = netPrivate + nhsIncome;
  const totalDeductions = labBillsDeduction + financeFeesDeduction + therapyDeduction;
  const netPay = totalEarnings - totalDeductions + adjustmentsTotal;

  return {
    grossPrivate: entry.gross_private,
    splitPercentage,
    netPrivate,
    nhsUdas: entry.nhs_udas,
    udaRate: dentist.uda_rate,
    nhsIncome,
    labBills,
    labBillsTotal,
    labBillsDeduction,
    financeFees: entry.finance_fees,
    financeFeesDeduction,
    therapyMinutes: entry.therapy_minutes,
    therapyRate: entry.therapy_rate,
    therapyDeduction,
    adjustments,
    adjustmentsTotal,
    totalDeductions,
    totalEarnings,
    netPay,
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

export function getMonthName(month: number): string {
  return new Date(2000, month - 1).toLocaleString("en-GB", { month: "long" });
}
