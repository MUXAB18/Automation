import { PageSkeleton } from "@/components/skeletons";

/**
 * Skeleton for LIST pages (re-exported as loading.tsx next to them). It is deliberately not placed
 * above record pages (clients/[id], projects/[id]): a loading boundary starts streaming before the
 * page can say "not found", which would turn a refused record into an HTTP 200 instead of a 404.
 */
export default function PageLoading() {
  return <PageSkeleton />;
}
