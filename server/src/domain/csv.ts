export type Cell = string | number | null | undefined;

/**
 * RFC 4180 CSV. A text cell that a spreadsheet would run as a formula (=, +, -, @, tab, CR)
 * is prefixed with a quote, because item names and reasons are typed in by staff.
 */
export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
