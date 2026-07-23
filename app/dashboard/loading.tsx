export default function DashboardLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div
        className="flex h-14 items-center gap-6 px-4 sm:px-6"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="h-7 w-28 animate-pulse rounded-sm bg-muted" />
        <div className="ml-auto flex items-center gap-5">
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-14 animate-pulse rounded bg-muted" />
          <div className="size-8 animate-pulse rounded-full bg-muted" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-44 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-9 w-36 animate-pulse rounded-sm bg-muted" />
        </div>

        <div className="mt-8 space-y-2.5">
          <div className="mb-3 h-3 w-32 animate-pulse rounded bg-muted" />
          <div className="h-[68px] animate-pulse rounded-lg bg-muted/80" />
          <div className="h-[68px] animate-pulse rounded-lg bg-muted/60" />
          <div className="h-[68px] animate-pulse rounded-lg bg-muted/40" />
        </div>
      </div>
    </div>
  );
}
