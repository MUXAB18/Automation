export type RoleOption = { key: string; name: string; scope?: string; description?: string | null };

/** A group of role checkboxes (a person can hold several). Posts as repeated `roleKeys` fields. */
export function RoleCheckboxes({
  roles,
  selected = [],
  idPrefix,
}: {
  roles: RoleOption[];
  selected?: string[];
  idPrefix: string;
}) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">Roles</legend>
      {roles.map((r) => (
        <label
          key={r.key}
          htmlFor={`${idPrefix}-${r.key}`}
          className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
        >
          <input
            id={`${idPrefix}-${r.key}`}
            type="checkbox"
            name="roleKeys"
            value={r.key}
            defaultChecked={selected.includes(r.key)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{r.name}</span>
            {r.description ? (
              <span className="block text-xs text-muted-foreground">{r.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
