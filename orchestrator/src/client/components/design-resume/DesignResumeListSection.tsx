import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DesignResumeSection } from "./DesignResumeSection";
import type { ItemDefinition } from "./definitions";
import { getByPath, toBoolean, toText } from "./utils";

type DesignResumeListSectionProps = {
  definition: ItemDefinition;
  items: Record<string, unknown>[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onUpdateItems: (nextItems: Record<string, unknown>[]) => void;
  /** Item id → short description of its AI guidance (shows a sparkle). */
  aiHints?: Record<string, string>;
};

export function DesignResumeListSection({
  definition,
  items,
  onAdd,
  onEdit,
  onUpdateItems,
  aiHints,
}: DesignResumeListSectionProps) {
  const [pendingRemovalIndex, setPendingRemovalIndex] = useState<number | null>(
    null,
  );
  const pendingRemovalItem = useMemo(
    () =>
      pendingRemovalIndex == null ? null : (items[pendingRemovalIndex] ?? null),
    [items, pendingRemovalIndex],
  );
  const pendingRemovalLabel = toText(
    pendingRemovalItem
      ? getByPath(pendingRemovalItem, definition.primaryField)
      : null,
    "this item",
  );

  const confirmRemoval = () => {
    if (pendingRemovalIndex == null) return;
    onUpdateItems(
      items.filter((_, currentIndex) => currentIndex !== pendingRemovalIndex),
    );
    setPendingRemovalIndex(null);
  };

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const nextItems = [...items];
    const [currentItem] = nextItems.splice(index, 1);
    nextItems.splice(target, 0, currentItem);
    onUpdateItems(nextItems);
  };

  const iconButtonClass =
    "h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground";

  return (
    <DesignResumeSection
      value={definition.key}
      title={definition.title}
      subtitle={definition.description}
      badge={items.length === 0 ? "Empty" : `${items.length}`}
    >
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-5 text-center text-sm text-muted-foreground">
            No {definition.title.toLowerCase()} yet.
          </div>
        ) : (
          items.map((item, index) => {
            const hidden = toBoolean(item.hidden, false);
            const title = toText(
              getByPath(item, definition.primaryField),
              "Untitled",
            );
            const subtitle = definition.secondaryField
              ? toText(getByPath(item, definition.secondaryField))
              : "";
            const itemId = toText(item.id);
            const aiHint = itemId ? aiHints?.[itemId] : undefined;
            return (
              <div
                key={itemId || `${definition.key}-${index}`}
                className={cn(
                  "flex items-center gap-1 rounded-lg border border-border/60 bg-background/60 py-2 pl-3 pr-1.5 transition-opacity",
                  hidden && "opacity-55",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onEdit(index)}
                  title={`Edit ${title}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {title}
                    </span>
                    {aiHint ? (
                      <Sparkles
                        className="h-3.5 w-3.5 shrink-0 text-primary"
                        aria-label={aiHint}
                      >
                        <title>{aiHint}</title>
                      </Sparkles>
                    ) : null}
                    {hidden ? (
                      <span className="shrink-0 rounded-full border border-border/60 px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Hidden
                      </span>
                    ) : null}
                  </div>
                  {subtitle ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {subtitle}
                    </div>
                  ) : null}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={iconButtonClass}
                  aria-label="Move up"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={iconButtonClass}
                  aria-label="Move down"
                  title="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={iconButtonClass}
                  aria-label={hidden ? "Show" : "Hide"}
                  title={hidden ? "Show on CV" : "Hide from CV"}
                  onClick={() => {
                    const nextItems = [...items];
                    nextItems[index] = { ...nextItems[index], hidden: !hidden };
                    onUpdateItems(nextItems);
                  }}
                >
                  {hidden ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    iconButtonClass,
                    "hover:bg-rose-500/10 hover:text-rose-400",
                  )}
                  aria-label="Remove"
                  title={`Remove ${title}`}
                  onClick={() => setPendingRemovalIndex(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-dashed"
          onClick={onAdd}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add {definition.singularTitle.toLowerCase()}
        </Button>
      </div>

      <AlertDialog
        open={pendingRemovalIndex != null}
        onOpenChange={(open) => {
          if (!open) setPendingRemovalIndex(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {definition.singularTitle.toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {pendingRemovalLabel} from your Design Resume.
              You can add it again later, but this change will be saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemoval}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DesignResumeSection>
  );
}
