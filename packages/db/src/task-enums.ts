// Plain value lists for validation (the generated Prisma enums are types plus objects; zod wants tuples).
export const TASK_TYPES_LIST = ["general", "seo_fix", "content", "social", "reporting"] as const;
export const PRIORITIES_LIST = ["low", "medium", "high", "urgent"] as const;
