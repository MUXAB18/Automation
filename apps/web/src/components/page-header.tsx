import { Breadcrumbs, type Crumb } from "@/components/app/breadcrumbs";

/** Standard top of every page: breadcrumbs, title, description, optional badges and actions. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  badges,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
            {badges}
          </div>
          {description ? (
            <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
