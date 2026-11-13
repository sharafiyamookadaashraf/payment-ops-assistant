// apps/api/src/csvProcessing.ts
//
// Pure CSV parsing/validation/duplicate-detection logic, extracted from
// index.ts so it can be unit tested without spinning up Express or a DB.

import { isSupportedCurrency, isValidStatus } from "./importValidation.js";

export const REQUIRED_COLUMNS = [
  "transactionId",
  "amount",
  "currency",
  "status",
  "createdAt",
] as const;

export type CsvRow = Record<string, string>;

export type TransactionInput = {
  transactionId: string;
  amount: number;
  merchantId?: string | null;
  importId?: string | null;
  currency: string;
  status: string;
  failureReason: string | null;
  createdAt: Date;
};

export type ImportValidationError = {
  rowNumber: number;
  message: string;
};

export function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
}

export function parseCsvText(csvText: string): CsvRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);

    const row = headers.reduce<CsvRow>((accumulator, header, index) => {
      accumulator[header] = values[index] ?? "";
      return accumulator;
    }, {});

    if (values.length !== headers.length) {
      row.__columnCountMismatch = String(values.length);
    }

    return row;
  });
}

export function validateRow(record: CsvRow, rowIndex: number): TransactionInput {
  const transactionId = record.transactionId?.trim();
  const currency = record.currency?.trim();
  const status = record.status?.trim();
  const amount = Number(record.amount);
  const createdAt = new Date(record.createdAt);
  const failureReason = record.failureReason?.trim() || null;
  const merchantId = record.merchantId?.trim() || null;

  if (!transactionId) {
    throw new Error(`Row ${rowIndex}: transactionId is required`);
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Row ${rowIndex}: amount must be a positive number`);
  }

  if (!/^\d+(\.\d{1,2})?$/.test(record.amount?.trim() ?? "") || amount > 9999999999.99) {
    throw new Error(`Row ${rowIndex}: amount must have at most two decimals and be <= 9999999999.99`);
  }
  if (merchantId && !/^[A-Za-z0-9_-]{1,80}$/.test(merchantId)) {
    throw new Error(`Row ${rowIndex}: merchantId must use letters, digits, underscores or hyphens (max 80)`);
  }
  if (transactionId.length > 120 || (failureReason?.length ?? 0) > 200) {
    throw new Error(`Row ${rowIndex}: transactionId or failureReason is too long`);
  }

  if (!currency) {
    throw new Error(`Row ${rowIndex}: currency is required`);
  }

  if (!isSupportedCurrency(currency)) {
    throw new Error(`Row ${rowIndex}: unsupported currency (${currency})`);
  }

  if (!status) {
    throw new Error(`Row ${rowIndex}: status is required`);
  }

  if (!isValidStatus(status)) {
    throw new Error(`Row ${rowIndex}: invalid status (${status})`);
  }

  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(`Row ${rowIndex}: createdAt must be a valid date`);
  }

  return {
    transactionId,
    amount,
    merchantId,
    currency: currency.toUpperCase(),
    status: status.toUpperCase(),
    failureReason,
    createdAt,
  };
}

// Mirrors the exact duplicate logic previously inline in index.ts's upload
// handler — extracted so it's independently testable.
export function findDuplicateTransactionId(
  transactionId: string,
  seenInFile: Set<string>,
  existingIds: Set<string>,
): string | null {
  if (seenInFile.has(transactionId)) {
    return `duplicate transactionId within file (${transactionId})`;
  }
  if (existingIds.has(transactionId)) {
    return `transactionId already exists (${transactionId})`;
  }
  return null;
}
