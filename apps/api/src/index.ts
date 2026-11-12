import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { PrismaClient } from "../../../generated/prisma/client.js";
import { getImportStatus, type ImportStatus } from "./importService.js";
import { listImports } from "./importRepository.js";
import { type ImportSortField, type SortOrder } from "./importTypes.js";
import { getTransactionsSummary } from "./transactionsRepository.js";
import { listTransactions } from "./transactionsRepository.js";
import {
  REQUIRED_COLUMNS,
  splitCsvLine,
  parseCsvText,
  validateRow,
  findDuplicateTransactionId,
  type CsvRow,
  type TransactionInput,
  type ImportValidationError,
} from "./csvProcessing.js";

dotenv.config({ path: path.resolve(process.cwd(), "../..", ".env") });

const app = express();
const port = Number(process.env.PORT || 3001);
let prisma: PrismaClient | null = null;


type StoredImport = {
  id: string;
  filename: string;
  status: ImportStatus;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  createdAt: Date;
  importErrors: ImportValidationError[];
};

const localImports: StoredImport[] = [];
const localTransactions: TransactionInput[] = [];

async function initializePrisma() {
  try {
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const client = new PrismaClient({ adapter });

    await client.$connect();
    prisma = client;
    console.log("Prisma connected successfully");
  } catch (error) {
    console.warn("Prisma unavailable; falling back to in-memory storage.", error);
    prisma = null;
  }
}

initializePrisma();

// --- multer: replaces the old hand-rolled parseMultipartFile. Enforces
// file size + .csv type at the boundary instead of trusting raw parsing. ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");
    if (!isCsv) {
      cb(new Error("Only .csv files are accepted."));
      return;
    }
    cb(null, true);
  },
});

function handleUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ message: err.message || "File upload failed." });
      return;
    }
    next();
  });
}

async function handleImportUpload(req: express.Request, res: express.Response) {
  let importRecord: StoredImport | undefined;
  try {
    if (!req.file) {
      res.status(400).json({ message: "No file was uploaded. Send it as multipart/form-data under the 'file' field." });
      return;
    }

    const fileName = req.file.originalname;
    const buffer = req.file.buffer;

    importRecord = prisma
      ? (await prisma.import.create({
          data: {
            filename: fileName,
            status: "PROCESSING" as ImportStatus,
            totalRows: 0,
            successfulRows: 0,
            failedRows: 0,
          },
        })) as StoredImport
      : {
          id: crypto.randomUUID(),
          filename: fileName,
          status: "PROCESSING" as ImportStatus,
          totalRows: 0,
          successfulRows: 0,
          failedRows: 0,
          createdAt: new Date(),
          importErrors: [],
        };

    if (!prisma) {
      localImports.push(importRecord as StoredImport);
    }

    const records = parseCsvText(buffer.toString("utf8"));

    if (!records.length) {
      if (prisma) {
        await prisma.import.update({
          where: { id: importRecord!.id },
          data: {
            status: "FAILED" as ImportStatus,
            totalRows: 0,
            successfulRows: 0,
            failedRows: 0,
          },
        });

        await prisma.importError.createMany({
          data: [{
            importId: importRecord!.id,
            rowNumber: 1,
            message: "CSV file is empty",
          }],
        });
      } else {
        const stored = localImports.find((entry) => entry.id === importRecord!.id);
        if (stored) {
          stored.status = "FAILED" as ImportStatus;
          stored.totalRows = 0;
          stored.successfulRows = 0;
          stored.failedRows = 0;
          stored.importErrors.push({
            rowNumber: 1,
            message: "CSV file is empty",
          });
        }
      }

      res.status(400).json({ message: "CSV file is empty" });
      return;
    }

    const columns = Object.keys(records[0]);
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
    const validationErrors: ImportValidationError[] = [];
    const validTransactions: TransactionInput[] = [];

    if (missingColumns.length > 0) {
      validationErrors.push({
        rowNumber: 1,
        message: `Missing required CSV columns: ${missingColumns.join(", ")}`,
      });
    } else {
      // Duplicate detection: against rows already saved (DB or in-memory),
      // and against other rows in this same file.
      const candidateIds = records.map((r) => r.transactionId?.trim()).filter(Boolean);
      const existingIds = prisma
        ? new Set(
            (
              await prisma.transaction.findMany({
                where: { transactionId: { in: candidateIds } },
                select: { transactionId: true },
              })
            ).map((t) => t.transactionId),
          )
        : new Set(localTransactions.map((t) => t.transactionId));

      const seenInFile = new Set<string>();

      records.forEach((record, index) => {
        const rowNumber = index + 2;
        try {
          if (record.__columnCountMismatch) {
            throw new Error(
              `Row ${rowNumber}: expected ${columns.length} columns, got ${record.__columnCountMismatch}`,
            );
          }
          const parsed = validateRow(record, rowNumber);
          const duplicateReason = findDuplicateTransactionId(parsed.transactionId, seenInFile, existingIds);
          if (duplicateReason) {
            throw new Error(`Row ${rowNumber}: ${duplicateReason}`);
          }
          seenInFile.add(parsed.transactionId);
          validTransactions.push(parsed);
        } catch (error) {
          validationErrors.push({
            rowNumber,
            message: error instanceof Error ? error.message : "Unknown validation error",
          });
        }
      });
    }

    const successfulRows = validTransactions.length;
    const failedRows = validationErrors.length;

    if (prisma) {
      if (validTransactions.length > 0) {
        await prisma.transaction.createMany({
          data: validTransactions.map((t) => ({ ...t, importId: importRecord!.id })),
          skipDuplicates: true,
        });
      }
    } else {
      localTransactions.push(...validTransactions.map((transaction) => ({ ...transaction, importId: importRecord!.id })));
    }

    if (validationErrors.length > 0) {
      if (prisma) {
        await prisma.importError.createMany({
          data: validationErrors.map((error) => ({
            importId: importRecord!.id,
            rowNumber: error.rowNumber,
            message: error.message,
          })),
        });
      } else {
        const stored = localImports.find((entry) => entry.id === importRecord!.id);
        if (stored) {
          stored.importErrors.push(...validationErrors);
        }
      }
    }

    let updatedImport;

    if (prisma) {
      updatedImport = await prisma.import.update({
        where: { id: importRecord!.id },
        data: {
          status: getImportStatus(successfulRows, failedRows) as ImportStatus,
          totalRows: records.length,
          successfulRows,
          failedRows,
        },
      });
    } else {
      const stored = localImports.find((entry) => entry.id === importRecord!.id);
      if (stored) {
        stored.status = getImportStatus(successfulRows, failedRows);
        stored.totalRows = records.length;
        stored.successfulRows = successfulRows;
        stored.failedRows = failedRows;
        updatedImport = stored;
      }
    }

    const responseRecords = validTransactions.map((t) => ({
      id: t.transactionId,
      transactionId: t.transactionId,
      amount: t.amount,
      currency: t.currency,
      status: t.status,
      failureReason: t.failureReason,
      createdAt: t.createdAt.toISOString(),
    }));

    res.status(201).json({ ...updatedImport, records: responseRecords });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import transactions";

    if (importRecord) {
      if (prisma) {
        await prisma.import.update({
          where: { id: importRecord!.id },
          data: { status: "FAILED" as ImportStatus },
        }).catch(() => {});
      } else {
        const stored = localImports.find((entry) => entry.id === importRecord!.id);
        if (stored) stored.status = "FAILED" as ImportStatus;
      }
    }

    res.status(400).json({ message });
  }
}

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "payment-ops-api",
  });
});

app.post("/api/imports", handleUpload, handleImportUpload);
app.post("/transactions/upload", handleUpload, handleImportUpload);

app.get("/api/imports", async (req, res) => {
  const query = {
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 10),
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    status:
      typeof req.query.status === "string" &&
      ["PROCESSING", "COMPLETED", "PARTIALLY_COMPLETED", "FAILED"].includes(req.query.status)
        ? (req.query.status as ImportStatus)
        : undefined,
    sortBy:
      typeof req.query.sortBy === "string" &&
      ["createdAt", "filename", "status", "totalRows", "successfulRows", "failedRows"].includes(req.query.sortBy)
        ? (req.query.sortBy as ImportSortField)
        : undefined,
    sortOrder:
      typeof req.query.sortOrder === "string" && ["asc", "desc"].includes(req.query.sortOrder)
        ? (req.query.sortOrder as SortOrder)
        : undefined,
  };

  const imports = await listImports(prisma, query);
  res.json(imports);
});

app.get("/api/imports/:id", async (req, res) => {
  if (prisma) {
    const importRecord = await prisma.import.findUnique({
      where: { id: req.params.id },
      include: {
        importErrors: {
          orderBy: {
            rowNumber: "asc",
          },
        },
      },
    });

    if (!importRecord) {
      res.status(404).json({ message: "Import not found" });
      return;
    }

    res.json(importRecord);
    return;
  }

  const importRecord = localImports.find((entry) => entry.id === req.params.id);

  if (!importRecord) {
    res.status(404).json({ message: "Import not found" });
    return;
  }

  res.json(importRecord);
});

app.get("/api/transactions/summary", async (_req, res) => {
  const summary = await getTransactionsSummary(prisma, localTransactions);
  res.json(summary);
});
app.get("/api/transactions", async (req, res) => {
  const query = {
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 10),
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    currency: typeof req.query.currency === "string" ? req.query.currency : undefined,
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
    sortBy: typeof req.query.sortBy === "string" ? (req.query.sortBy as any) : undefined,
    sortOrder: typeof req.query.sortOrder === "string" ? (req.query.sortOrder as any) : undefined,
  };
  const result = await listTransactions(prisma, localTransactions, query);
  res.json(result);
});
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
