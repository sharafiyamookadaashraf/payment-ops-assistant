import { readFile } from "node:fs/promises";
import { parseCsvText, validateRow } from "../src/csvProcessing.js";
import { loadSnapshot } from "../src/ops/analytics.js";
export async function evalSnapshot() {
  const csv = await readFile(new URL("../../../sample-data/ops-copilot-synthetic.csv", import.meta.url), "utf8");
  const rows = parseCsvText(csv).map((record, index) => validateRow(record, index + 2));
  return loadSnapshot(null, rows);
}
