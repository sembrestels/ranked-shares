export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded-sm bg-sunken" style={{ width: `${90 - (i % 3) * 20}%` }} />
      ))}
    </div>
  );
}
