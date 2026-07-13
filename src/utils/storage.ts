import { baseColumns } from "../data/library";
import type { ColumnConfig } from "../types";

export const parseColumns = (raw: string): ColumnConfig[] => {
  try {
    const parsed = JSON.parse(raw) as ColumnConfig[];
    const savedByKey = new Map(parsed.map((column) => [column.key, column]));
    const ordered = parsed
      .map((column) => {
        const base = baseColumns.find((item) => item.key === column.key);
        if (!base) {
          return null;
        }
        return { ...base, ...column, labelKey: base.labelKey };
      })
      .filter((column): column is ColumnConfig => column !== null);
    const missing = baseColumns.filter((column) => !savedByKey.has(column.key));
    return [...ordered, ...missing];
  } catch {
    return baseColumns;
  }
};

export const parseNumber = (fallback: number) => (raw: string) => {
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const parseDetailWidth = (raw: string) => {
  const parsed = Number(raw);
  const saved = Number.isNaN(parsed) ? 320 : parsed;
  return saved <= 56 ? 320 : saved;
};
