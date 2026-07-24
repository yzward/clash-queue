"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import {
  createCourtAction,
  deleteCourtAction,
  renameCourtAction,
} from "@/app/t/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Court } from "@/lib/data/courts";

type OptimisticUpdate =
  | { type: "add"; court: Court }
  | { type: "rename"; courtId: string; name: string }
  | { type: "delete"; courtId: string };

function applyOptimisticUpdate(
  state: Court[],
  update: OptimisticUpdate
): Court[] {
  switch (update.type) {
    case "add":
      return [...state, update.court];
    case "rename":
      return state.map((court) =>
        court.id === update.courtId
          ? { ...court, name: update.name }
          : court
      );
    case "delete":
      return state.filter((court) => court.id !== update.courtId);
    default:
      return state;
  }
}

function CourtRow({
  court,
  tournamentId,
  onOptimistic,
  onRequestDelete,
}: {
  court: Court;
  tournamentId: string;
  onOptimistic: (update: OptimisticUpdate) => void;
  onRequestDelete: (court: Court) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(court.name);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setDraftName(court.name);
    }
  }, [court.name, editing]);

  const startRename = () => {
    setDraftName(court.name);
    setEditing(true);
  };

  const cancelRename = () => {
    setDraftName(court.name);
    setEditing(false);
  };

  const commitRename = () => {
    const next = draftName.trim();
    if (!next || next === court.name) {
      cancelRename();
      return;
    }

    setEditing(false);
    startTransition(async () => {
      onOptimistic({ type: "rename", courtId: court.id, name: next });
      const result = await renameCourtAction(court.id, next, tournamentId);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const inUse = court.current_match_id != null;

  return (
    <div
      className="flex items-center gap-3 rounded-[10px] px-3 py-3"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            ref={inputRef}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            disabled={pending}
            className="h-8 text-[13px] text-white"
            aria-label="Court name"
          />
        ) : (
          <button
            type="button"
            onClick={startRename}
            className="block w-full truncate text-left text-[13px] font-medium text-white hover:text-white/90"
          >
            {court.name}
          </button>
        )}
      </div>

      <span
        className="shrink-0 text-xs font-medium"
        style={{ color: inUse ? "#fbbf24" : "rgba(255,255,255,0.4)" }}
      >
        {inUse ? "In use" : "Free"}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-white"
            aria-label={`Court options for ${court.name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={startRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onRequestDelete(court)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function CourtsTab({
  initialCourts,
  tournamentId,
}: {
  initialCourts: Court[];
  tournamentId: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Court | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [optimisticCourts, applyOptimistic] = useOptimistic(
    initialCourts,
    applyOptimisticUpdate
  );

  const defaultName = `Court ${optimisticCourts.length + 1}`;

  const openAdd = () => {
    setNewName(defaultName);
    setAddOpen(true);
  };

  const submitAdd = () => {
    const name = newName.trim() || defaultName;
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticCourt: Court = {
      id: tempId,
      name,
      current_match_id: null,
      tournament_id: tournamentId,
      created_at: new Date().toISOString(),
    };

    setAddOpen(false);
    startTransition(async () => {
      applyOptimistic({ type: "add", court: optimisticCourt });
      const result = await createCourtAction(tournamentId, name);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const court = deleteTarget;
    setDeleteError(null);

    startTransition(async () => {
      applyOptimistic({ type: "delete", courtId: court.id });
      const result = await deleteCourtAction(court.id, tournamentId);
      if (!result.ok) {
        setDeleteError(result.error);
        toast.error(result.error);
        return;
      }
      setDeleteTarget(null);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white">Courts</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {optimisticCourts.length} configured
          </p>
        </div>
        {optimisticCourts.length > 0 ? (
          <Button type="button" onClick={openAdd} className="gap-1.5">
            <Plus className="size-3.5" />
            Add court
          </Button>
        ) : null}
      </div>

      {optimisticCourts.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-[10px] px-4 py-16 text-center"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <p className="max-w-sm text-sm text-muted-foreground">
            No courts yet - add one to enable tablet scoring
          </p>
          <Button type="button" onClick={openAdd} className="gap-1.5">
            <Plus className="size-3.5" />
            Add court
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {optimisticCourts.map((court) => (
            <CourtRow
              key={court.id}
              court={court}
              tournamentId={tournamentId}
              onOptimistic={applyOptimistic}
              onRequestDelete={(target) => {
                setDeleteError(null);
                setDeleteTarget(target);
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add court</DialogTitle>
            <DialogDescription>
              Tablets need at least one court to score on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="court-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Court name
            </label>
            <Input
              id="court-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Court 1"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitAdd();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submitAdd} disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete court</DialogTitle>
            <DialogDescription>
              Delete {deleteTarget?.name}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive">{deleteError}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
