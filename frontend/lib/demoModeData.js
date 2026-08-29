// frontend/lib/demoModeData.js

export const DEMO_MODE_RESPONSE = {
  files: [
    { filename: "demo_report_main.csv", fileType: "csv", extractionMethod: "spreadsheet", rowCount: 19, error: null },
    { filename: "demo_report_q2_adjustments.csv", fileType: "csv", extractionMethod: "spreadsheet", rowCount: 6, error: null },
  ],
  extracted: {
    rowCount: 25,
    rows: [],
  },
  privacy: {
    maskedCount: 7,
    matches: [
      { field: "notes", rowId: "f0_row_2", type: "NAME" },
      { field: "notes", rowId: "f0_row_11", type: "NAME" },
      { field: "notes", rowId: "f0_row_12", type: "EMAIL" },
      { field: "notes", rowId: "f1_row_3", type: "EMAIL" },
      { field: "notes", rowId: "f0_row_18", type: "NAME" },
      { field: "notes", rowId: "f0_row_18", type: "IC" },
      { field: "notes", rowId: "f0_row_19", type: "NAME" },
    ],
  },
  insights: [
    {
      id: "insight_1",
      type: "variance",
      severity: "high",
      message: "Marketing spend up 340% from Q1 2026 to Q2 2026 (threshold: 50%)",
      sourceRowIds: ["f0_row_1", "f0_row_2"],
      metric: {
        category: "Marketing",
        previousPeriod: "Q1 2026",
        currentPeriod: "Q2 2026",
        previous: 45000,
        current: 198000,
        changePercent: 340,
        threshold: 50,
      },
    },
    {
      id: "insight_2",
      type: "outlier",
      severity: "high",
      message: "Unusual Vendor Sdn Bhd in Office Supplies is unusually above the category norm (RM8,500 vs typical RM510)",
      sourceRowIds: ["f0_row_11"],
      metric: { category: "Office Supplies", value: 8500, categoryMedian: 510 },
    },
    {
      id: "insight_3",
      type: "duplicate",
      severity: "warning",
      message: 'Possible duplicate entry: "Global Consulting Partners" appears in both files with matching amount (RM12,450)',
      sourceRowIds: ["f0_row_12", "f1_row_3"],
      metric: { vendor: "Global Consulting Partners", amount: 12450 },
    },
  ],
  summary: {
    totalInsights: 3,
    bySeverity: { high: 2, warning: 1, info: 0 },
  },
  _isDemoMode: true,
};