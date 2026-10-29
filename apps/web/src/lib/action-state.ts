import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ScopeViolationError,
  ValidationError,
} from "@automation/db";

export type FormState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

/** Turn expected domain errors into form state; rethrow anything unexpected. */
export function toFormState(error: unknown): FormState {
  if (error instanceof ValidationError) {
    return { error: "Please fix the highlighted fields", fieldErrors: error.fieldErrors };
  }
  if (
    error instanceof ConflictError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError
  ) {
    return { error: error.message };
  }
  if (error instanceof ScopeViolationError) return { error: "That action is outside your access" };
  throw error;
}

/** One readable sentence for toasts and dialogs: the first field message of a validation error, or the error's own text. */
export function errorMessage(error: unknown): string {
  if (error instanceof ValidationError) {
    return Object.values(error.fieldErrors).flat()[0] ?? "Please check the form";
  }
  return toFormState(error).error ?? "Something went wrong";
}
