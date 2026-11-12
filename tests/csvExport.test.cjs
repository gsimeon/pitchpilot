const { buildPerformanceCsv } = require('../electron/csvExport.cjs');

function row(overrides = {}) {
  return {
    timestamp: '2026-11-12T11:00:00.000Z',
    elapsedSeconds: 12,
    event: 'face_metrics',
    speechActivity: 'speaking',
    expressionLabel: 'Happy',
    expressionConfidencePercent: 84.5,
    faceFraming: 'Face centered in frame',
    audioDurationSeconds: null,
    audioLowLevelPercent: null,
    ...overrides,
  };
}

describe('main-process CSV serializer', () => {
  test('emits a UTF-8 BOM, a fixed header, and quoted values', () => {
    const csv = buildPerformanceCsv([row({ faceFraming: 'Center, then say "hello"' })]);
    expect(csv.startsWith('\uFEFF"timestamp","elapsedSeconds","event"')).toBe(true);
    expect(csv).toContain('"Center, then say ""hello"""');
    expect(csv).toContain('84.5');
  });

  test('prefixes formula-like strings before writing a spreadsheet-compatible CSV', () => {
    const csv = buildPerformanceCsv([row({ expressionLabel: '=HYPERLINK("https://example.invalid")' })]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
  });

  test('rejects empty payloads, invalid rows, and excessive row counts', () => {
    expect(() => buildPerformanceCsv([])).toThrow('between 1 and 10,000');
    expect(() => buildPerformanceCsv(Array(10001).fill(row()))).toThrow('between 1 and 10,000');
    expect(() => buildPerformanceCsv([null])).toThrow('Invalid CSV row');
  });

  test('caps the generated export at 4 MB', () => {
    const longText = 'x'.repeat(240);
    const largeRows = Array.from({ length: 10000 }, () => row({
      timestamp: longText,
      event: longText,
      speechActivity: longText,
      expressionLabel: longText,
      faceFraming: longText,
    }));
    expect(() => buildPerformanceCsv(largeRows)).toThrow('larger than 4 MB');
  });
});
