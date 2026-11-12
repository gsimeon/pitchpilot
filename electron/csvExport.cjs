'use strict';

const columns = [
  'timestamp', 'elapsedSeconds', 'event', 'speechActivity',
  'expressionLabel', 'expressionConfidencePercent', 'faceFraming',
  'audioDurationSeconds', 'audioLowLevelPercent',
];
const stringFields = new Set(['timestamp', 'event', 'speechActivity', 'expressionLabel', 'faceFraming']);

function cell(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value !== 'string') return '';
  let safe = value.slice(0, 240).replace(/[\u0000-\u001f]/g, ' ');
  if (/^[=+\-@\t\r]/.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
}

function buildPerformanceCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10000) {
    throw new Error('CSV export requires between 1 and 10,000 log rows.');
  }
  const normalizedRows = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid CSV row.');
    return columns.map((column) => {
      const value = row[column];
      if (stringFields.has(column)) return typeof value === 'string' ? value : '';
      return typeof value === 'number' && Number.isFinite(value) ? value : '';
    });
  });
  const csv = '\uFEFF' + [columns, ...normalizedRows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
  if (Buffer.byteLength(csv, 'utf8') > 4 * 1024 * 1024) throw new Error('CSV export is larger than 4 MB.');
  return csv;
}

module.exports = { buildPerformanceCsv, columns };
