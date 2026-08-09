export function LabeledList({
  label,
  items,
  className,
}: {
  label: string;
  items: string[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-xs font-medium">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
