import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConditionalFormatOperator,
  ConditionalFormatRule,
  Spreadsheet,
  parseRef,
  toSref,
} from "@wafflebase/sheet";
import { toast } from "sonner";
import {
  IconBold,
  IconDropletOff,
  IconItalic,
  IconDropletHalf2Filled,
  IconPlus,
  IconTypography,
  IconX,
  IconBrush,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BG_COLORS, TEXT_COLORS } from "@/components/formatting-colors";

type ConditionalFormatPanelProps = {
  spreadsheet: Spreadsheet | undefined;
  open: boolean;
  onClose: () => void;
  getSelectionRange: () => string | null;
};

const OPERATOR_LABELS: Record<ConditionalFormatOperator, string> = {
  isEmpty: "Is empty",
  isNotEmpty: "Is not empty",
  textContains: "Text contains",
  greaterThan: "Greater than",
  between: "Is between",
  dateBefore: "Date before",
  dateAfter: "Date after",
};

const OPERATOR_OPTIONS: Array<{
  value: ConditionalFormatOperator;
  label: string;
}> = Object.entries(OPERATOR_LABELS).map(([value, label]) => ({
  value: value as ConditionalFormatOperator,
  label,
}));

function parseA1Range(input: string): ConditionalFormatRule["range"] | null {
  const tokens = input
    .toUpperCase()
    .replace(/\$/g, "")
    .split(":")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length !== 2) {
    return null;
  }

  try {
    const a = parseRef(tokens[0]);
    const b = parseRef(tokens[1]);
    return [
      { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
      { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
    ];
  } catch {
    return null;
  }
}

function formatA1Range(range: ConditionalFormatRule["range"]): string {
  return `${toSref(range[0])}:${toSref(range[1])}`;
}

function describeRule(rule: ConditionalFormatRule): string {
  if (rule.op === "between") {
    return `${OPERATOR_LABELS[rule.op]} ${rule.value ?? ""} and ${rule.value2 ?? ""}`.trim();
  }
  if (rule.op === "isEmpty" || rule.op === "isNotEmpty") {
    return OPERATOR_LABELS[rule.op];
  }
  return `${OPERATOR_LABELS[rule.op]} ${rule.value ?? ""}`.trim();
}

function requiresSingleValue(op: ConditionalFormatOperator): boolean {
  return (
    op === "textContains" ||
    op === "greaterThan" ||
    op === "dateBefore" ||
    op === "dateAfter"
  );
}

function summarizeStyle(rule: ConditionalFormatRule): string {
  const tokens: string[] = [];
  if (rule.style.b) tokens.push("B");
  if (rule.style.i) tokens.push("I");
  if (rule.style.u) tokens.push("U");
  if (rule.style.tc) tokens.push("Text");
  if (rule.style.bg) tokens.push("Fill");
  return tokens.length > 0 ? tokens.join(" · ") : "No style";
}

/**
 * Renders the ConditionalFormatPanel component.
 */
export function ConditionalFormatPanel({
  spreadsheet,
  open,
  onClose,
  getSelectionRange,
}: ConditionalFormatPanelProps) {
  const [rules, setRules] = useState<ConditionalFormatRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [rangeInput, setRangeInput] = useState("");

  useEffect(() => {
    if (!open || !spreadsheet) {
      return;
    }

    const loadedRules = spreadsheet.getConditionalFormats();
    setRules(loadedRules);
    setSelectedRuleId((current) => {
      if (current && loadedRules.some((rule) => rule.id === current)) {
        return current;
      }
      return loadedRules[0]?.id ?? null;
    });
  }, [open, spreadsheet]);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId),
    [rules, selectedRuleId],
  );

  useEffect(() => {
    setRangeInput(selectedRule ? formatA1Range(selectedRule.range) : "");
  }, [selectedRuleId, selectedRule]);

  const commitRules = useCallback(
    (nextRules: ConditionalFormatRule[]) => {
      setRules(nextRules);
      if (!spreadsheet) {
        return;
      }
      void spreadsheet.setConditionalFormats(nextRules);
    },
    [spreadsheet],
  );

  const updateRule = useCallback(
    (ruleId: string, patch: Partial<ConditionalFormatRule>) => {
      const nextRules = rules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              ...patch,
            }
          : rule,
      );
      commitRules(nextRules);
    },
    [commitRules, rules],
  );

  const updateRuleStyle = useCallback(
    (
      ruleId: string,
      patch: Partial<NonNullable<ConditionalFormatRule["style"]>>,
    ) => {
      const nextRules = rules.map((rule) => {
        if (rule.id !== ruleId) {
          return rule;
        }

        const style = {
          ...rule.style,
          ...patch,
        };

        return {
          ...rule,
          style,
        };
      });
      commitRules(nextRules);
    },
    [commitRules, rules],
  );

  if (!open) {
    return null;
  }

  const handleAddRule = () => {
    const selectionRange = getSelectionRange();
    const parsedRange = selectionRange ? parseA1Range(selectionRange) : null;
    const defaultRange = parsedRange || [
      { r: 1, c: 1 },
      { r: 1, c: 1 },
    ];

    const nextRule: ConditionalFormatRule = {
      id: `cf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      range: defaultRange,
      op: "isNotEmpty",
      style: {
        bg: "#fff59d",
      },
    };

    const nextRules = [...rules, nextRule];
    commitRules(nextRules);
    setSelectedRuleId(nextRule.id);
  };

  const handleDeleteRule = (ruleId: string) => {
    const nextRules = rules.filter((rule) => rule.id !== ruleId);
    commitRules(nextRules);
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(nextRules[0]?.id ?? null);
    }
  };

  const handleMoveRule = (ruleId: string, direction: -1 | 1) => {
    const index = rules.findIndex((rule) => rule.id === ruleId);
    if (index < 0) {
      return;
    }

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rules.length) {
      return;
    }

    const reordered = [...rules];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    commitRules(reordered);
  };

  const handleApplyRange = () => {
    if (!selectedRule) {
      return;
    }

    const parsed = parseA1Range(rangeInput);
    if (!parsed) {
      toast.error("Enter a valid A1 range like A1:D20.");
      return;
    }
    updateRule(selectedRule.id, { range: parsed });
  };

  const handleUseSelectionRange = () => {
    const selectionRange = getSelectionRange();
    if (!selectionRange) {
      toast.error("Select a cell range first.");
      return;
    }
    setRangeInput(selectionRange);
    if (!selectedRule) {
      return;
    }
    const parsed = parseA1Range(selectionRange);
    if (!parsed) {
      return;
    }
    updateRule(selectedRule.id, { range: parsed });
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[26rem] flex-col overflow-hidden border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconBrush size={16} className="text-primary" />
            <p className="text-sm font-semibold">Conditional formatting</p>
          </div>
          <p className="truncate pt-1 text-xs text-muted-foreground">
            Rules are applied from top to bottom.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Close conditional format panel"
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Rules
          </Label>
          <Button type="button" size="sm" className="gap-1" onClick={handleAddRule}>
            <IconPlus size={14} />
            Add
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Add a rule and choose a range to start formatting.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule, index) => (
              <div
                key={rule.id}
                className={`rounded-lg border bg-card px-3 py-2.5 transition ${
                  selectedRuleId === rule.id
                    ? "border-primary ring-1 ring-primary/20"
                    : "hover:border-muted-foreground/30"
                }`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setSelectedRuleId(rule.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1 text-[10px] font-semibold">
                          {index + 1}
                        </span>
                        <p className="truncate text-sm font-medium">
                          {OPERATOR_LABELS[rule.op]}
                        </p>
                      </div>
                      <p className="truncate pt-1 text-xs text-muted-foreground">
                        {describeRule(rule)}
                      </p>
                      <p className="truncate pt-1 text-xs text-muted-foreground">
                        {formatA1Range(rule.range)}
                      </p>
                    </div>
                    <div className="shrink-0 space-y-1">
                      <div className="flex justify-end gap-1">
                        {rule.style.tc && (
                          <span
                            className="h-3 w-3 rounded border"
                            style={{ backgroundColor: rule.style.tc }}
                          />
                        )}
                        {rule.style.bg && (
                          <span
                            className="h-3 w-3 rounded border"
                            style={{ backgroundColor: rule.style.bg }}
                          />
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {summarizeStyle(rule)}
                      </p>
                    </div>
                  </div>
                </button>
                <div className="mt-2 flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === 0}
                    onClick={() => handleMoveRule(rule.id, -1)}
                    aria-label="Move rule up"
                  >
                    <span className="text-sm leading-none">↑</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === rules.length - 1}
                    onClick={() => handleMoveRule(rule.id, 1)}
                    aria-label="Move rule down"
                  >
                    <span className="text-sm leading-none">↓</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteRule(rule.id)}
                    aria-label="Delete rule"
                  >
                    <IconX size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedRule && (
          <>
            <Separator />

            <section className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="cf-apply-range">Apply to range</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="cf-apply-range"
                  value={rangeInput}
                  onChange={(event) => setRangeInput(event.target.value)}
                  placeholder="A1:D20"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleApplyRange}>
                  Apply
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={handleUseSelectionRange}
              >
                Use selected range
              </Button>
            </section>

            <section className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="cf-operator">Format rules</Label>
              <Select
                value={selectedRule.op}
                onValueChange={(value) => {
                  const nextOp = value as ConditionalFormatOperator;
                  if (nextOp === "between") {
                    updateRule(selectedRule.id, {
                      op: nextOp,
                      value: selectedRule.value || "",
                      value2: selectedRule.value2 || "",
                    });
                    return;
                  }
                  if (requiresSingleValue(nextOp)) {
                    updateRule(selectedRule.id, {
                      op: nextOp,
                      value: selectedRule.value || "",
                      value2: undefined,
                    });
                    return;
                  }
                  updateRule(selectedRule.id, {
                    op: nextOp,
                    value: undefined,
                    value2: undefined,
                  });
                }}
              >
                <SelectTrigger id="cf-operator" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATOR_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {requiresSingleValue(selectedRule.op) && (
                <Input
                  value={selectedRule.value || ""}
                  placeholder={
                    selectedRule.op === "textContains"
                      ? "Enter text"
                      : selectedRule.op === "greaterThan"
                        ? "Enter number"
                        : "YYYY-MM-DD"
                  }
                  onChange={(event) =>
                    updateRule(selectedRule.id, {
                      value: event.target.value,
                    })
                  }
                />
              )}

              {selectedRule.op === "between" && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={selectedRule.value || ""}
                    placeholder="Min"
                    onChange={(event) =>
                      updateRule(selectedRule.id, {
                        value: event.target.value,
                      })
                    }
                  />
                  <Input
                    value={selectedRule.value2 || ""}
                    placeholder="Max"
                    onChange={(event) =>
                      updateRule(selectedRule.id, {
                        value2: event.target.value,
                      })
                    }
                  />
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-lg border p-3">
              <Label>Formatting style</Label>
              <div className="flex items-center gap-2">
                <Toggle
                  pressed={!!selectedRule.style.b}
                  size="sm"
                  className="h-8 w-8"
                  onPressedChange={() =>
                    updateRuleStyle(selectedRule.id, {
                      b: !selectedRule.style.b,
                    })
                  }
                  aria-label="Toggle bold"
                >
                  <IconBold size={14} />
                </Toggle>
                <Toggle
                  pressed={!!selectedRule.style.i}
                  size="sm"
                  className="h-8 w-8"
                  onPressedChange={() =>
                    updateRuleStyle(selectedRule.id, {
                      i: !selectedRule.style.i,
                    })
                  }
                  aria-label="Toggle italic"
                >
                  <IconItalic size={14} />
                </Toggle>
                <Toggle
                  pressed={!!selectedRule.style.u}
                  size="sm"
                  className="h-8 w-8"
                  onPressedChange={() =>
                    updateRuleStyle(selectedRule.id, {
                      u: !selectedRule.style.u,
                    })
                  }
                  aria-label="Toggle underline"
                >
                  <span className="text-xs font-semibold underline">U</span>
                </Toggle>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
                      aria-label="Text color"
                    >
                      <IconTypography size={16} />
                      <span
                        className="absolute mt-5 h-0.5 w-3.5 rounded"
                        style={{ backgroundColor: selectedRule.style.tc || "#000000" }}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-auto p-2">
                    <button
                      type="button"
                      className="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
                      onClick={() =>
                        updateRuleStyle(selectedRule.id, {
                          tc: undefined,
                        })
                      }
                    >
                      <IconDropletOff size={14} />
                      Reset
                    </button>
                    <div className="grid grid-cols-5 gap-1">
                      {TEXT_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="h-5 w-5 rounded border border-border hover:scale-125 transition-transform"
                          style={{ backgroundColor: color }}
                          onClick={() =>
                            updateRuleStyle(selectedRule.id, {
                              tc: color,
                            })
                          }
                          aria-label={`Set text color ${color}`}
                        />
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
                      aria-label="Background color"
                    >
                      <IconDropletHalf2Filled size={16} />
                      <span
                        className="absolute mt-5 h-0.5 w-3.5 rounded"
                        style={{
                          backgroundColor: selectedRule.style.bg || "transparent",
                          border: selectedRule.style.bg ? "none" : "1px solid #ccc",
                        }}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-auto p-2">
                    <button
                      type="button"
                      className="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
                      onClick={() =>
                        updateRuleStyle(selectedRule.id, {
                          bg: undefined,
                        })
                      }
                    >
                      <IconDropletOff size={14} />
                      Reset
                    </button>
                    <div className="grid grid-cols-5 gap-1">
                      {BG_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="h-5 w-5 rounded border border-border hover:scale-125 transition-transform"
                          style={{ backgroundColor: color }}
                          onClick={() =>
                            updateRuleStyle(selectedRule.id, {
                              bg: color,
                            })
                          }
                          aria-label={`Set background color ${color}`}
                        />
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
