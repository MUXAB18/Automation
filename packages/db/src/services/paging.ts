export const PAGE_SIZE = 20;

export type Paged<T> = { rows: T[]; total: number; page: number; pageCount: number };

export const clampPage = (page: number | undefined) => Math.max(1, Math.floor(page ?? 1) || 1);

export const paged = <T>(rows: T[], total: number, page: number): Paged<T> => ({
  rows,
  total,
  page,
  pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
});
