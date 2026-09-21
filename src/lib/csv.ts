/**
 * CSV export.
 *
 * Two details that matter in practice and are easy to get wrong:
 *
 *  1. **A leading `=`, `+`, `-` or `@` is escaped.** Spreadsheets treat those
 *     as formulas, which turns an exported field into code the moment someone
 *     opens the file. Prefixing with a single quote defuses it.
 *  2. **A UTF-8 BOM is prepended.** Without it, Excel on Windows renders Tamil,
 *     Telugu and Kannada as mojibake — which makes a multilingual product's
 *     exports useless to exactly the people it was built for.
 *
 * Exports are also scoped by RLS, so a manager exporting "all trips" gets
 * their depot's trips and nothing else. The server decides that, not this file.
 */

export interface CsvColumn<Row> {
  /** Header text — already translated by the caller. */
  header: string;
  value: (row: Row) => string | number | null | undefined;
}

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function escapeCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  let text = String(value);

  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCell(column.value(row))).join(','));
  return [header, ...body].join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  // U+FEFF is the byte-order mark Excel needs to read the file as UTF-8.
  // Written as an escape: a literal BOM in source is invisible and gets
  // stripped by well-meaning editors.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick: revoking synchronously cancels the download in
  // some Android WebViews.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `trck-attendance-2026-09-21.csv` */
export function exportFilename(report: string, date = new Date()): string {
  return `trck-${report}-${date.toISOString().slice(0, 10)}.csv`;
}
