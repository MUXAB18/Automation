import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@automation/db";

/**
 * Turn "no access" and "no permission" from the data layer into a real 404 page. Not seeing a record
 * and not being allowed to open it look the same to the user, so ids cannot be probed.
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}
