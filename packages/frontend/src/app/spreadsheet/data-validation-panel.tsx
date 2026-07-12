import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataValidationRule,
  DataValidationKind,
  DataValidationOperator,
  validationOperandCount,
  Range,
  Spreadsheet,
  parseRef,
  toSref,
  normalizeListOptions,
} from "@wafflebase/sheets";
import { toast } from "sonner";
import { IconPlus, IconX, IconListCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DataValidationPanelProps = {
  spreadsheet: Spreadsheet | undefined;
  open: boolean;
  onClose: () => void;
  getSelectionRange: () => string | null;
};

// A1-range parsing/formatting — same shape as ConditionalFormatPanel.
function parseA1Ranges(input: string): Range[] | null {
  const segments = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  const ranges: Range[] = [];
  for (const segment of segments) {
    const tokens = segment
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
      ranges.push([
        { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
        { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
      ]);
    } catch {
      return null;
    }
  }
  return ranges;
}

function formatA1Ranges(ranges: Range[]): string {
  return ranges.map((r) => `${toSref(r[0])}:${toSref(r[1])}`).join(", ");
}

const DATE_OPERATORS: { value: DataValidationOperator; label: string }[] = [
  { value: "dateValid", label: "is a valid date" },
  { value: "dateEquals", label: "date is" },
  { value: "dateBefore", label: "date is before" },
  { value: "dateOnOrBefore", label: "date is on or before" },
  { value: "dateAfter", label: "date is after" },
  { value: "dateOnOrAfter", label: "date is on or after" },
  { value: "dateBetween", label: "date is between" },
  { value: "dateNotBetween", label: "date is not between" },
];

const NUMBER_OPERATORS: { value: DataValidationOperator; label: string }[] = [
  { value: "numberValid", label: "is a valid number" },
  { value: "numberEquals", label: "is equal to" },
  { value: "numberNotEquals", label: "is not equal to" },
  { value: "numberGreater", label: "greater than" },
  { value: "numberGreaterEq", label: "greater than or equal to" },
  { value: "numberLess", label: "less than" },
  { value: "numberLessEq", label: "less than or equal to" },
  { value: "numberBetween", label: "between" },
  { value: "numberNotBetween", label: "not between" },
];

const TEXT_OPERATORS: { value: DataValidationOperator; label: string }[] = [
  { value: "textContains", label: "contains" },
  { value: "textNotContains", label: "does not contain" },
  { value: "textEquals", label: "is exactly" },
  { value: "textIsEmail", label: "is valid email" },
  { value: "textIsUrl", label: "is valid URL" },
];

// The date / number / text kinds share one editor shape: an operator select +
// 0/1/2 operand inputs + an on-invalid radio. This config drives the shared
// section so the three comparison kinds stay in lockstep.
const COMPARISON_KINDS: Record<
  "date" | "number" | "text",
  {
    operators: { value: DataValidationOperator; label: string }[];
    inputType: "date" | "number" | "text";
    defaultOp: DataValidationOperator;
    label: string;
  }
> = {
  date: {
    operators: DATE_OPERATORS,
    inputType: "date",
    defaultOp: "dateValid",
    label: "Date",
  },
  number: {
    operators: NUMBER_OPERATORS,
    inputType: "number",
    defaultOp: "numberValid",
    label: "Number",
  },
  text: {
    operators: TEXT_OPERATORS,
    inputType: "text",
    defaultOp: "textContains",
    label: "Text",
  },
};

function isComparisonKind(
  kind: DataValidationKind,
): kind is "date" | "number" | "text" {
  return kind === "date" || kind === "number" || kind === "text";
}

function kindLabel(rule: DataValidationRule): string {
  if (rule.kind === "checkbox") return "Checkbox";
  if (isComparisonKind(rule.kind)) {
    const config = COMPARISON_KINDS[rule.kind];
    const op = config.operators.find(
      (o) => o.value === (rule.operator ?? config.defaultOp),
    );
    return `${config.label} (${op?.label ?? config.operators[0].label})`;
  }
  const opts = rule.list ?? [];
  if (opts.length === 0) return "Dropdown";
  const shown = opts.slice(0, 3).join(", ");
  return `Dropdown (${shown}${opts.length > 3 ? ", …" : ""})`;
}

/**
 * `DataValidationPanel` manages the current sheet's checkbox / dropdown rules,
 * mirroring `ConditionalFormatPanel`. Panel state is the working copy; each edit
 * writes the full rule array via `setDataValidations` (which normalizes on the
 * engine side — an in-progress dropdown with no options is kept in the panel for
 * the session but not persisted until it has at least one option).
 */
export function DataValidationPanel({
  spreadsheet,
  open,
  onClose,
  getSelectionRange,
}: DataValidationPanelProps) {
  const [rules, setRules] = useState<DataValidationRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [rangeInput, setRangeInput] = useState("");
  const [optionsText, setOptionsText] = useState("");

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId),
    [rules, selectedRuleId],
  );

  const commitRules = useCallback(
    (nextRules: DataValidationRule[]) => {
      setRules(nextRules);
      if (!spreadsheet) return;
      // A list rule with no usable options is normalized away on write, which
      // would drop the cell's existing rule while the user is still filling in
      // options (e.g. right after switching criteria to Dropdown). Persist such
      // an in-progress rule as its last-persisted form instead — or omit it if
      // it is brand new — so every OTHER rule (and unrelated deletes/edits)
      // still persists normally.
      const persistedById = new Map(
        spreadsheet.getDataValidations().map((r) => [r.id, r]),
      );
      const toPersist = nextRules.flatMap((r) => {
        const incomplete =
          r.kind === "list" && !(r.list ?? []).some((o) => o.trim());
        if (!incomplete) return [r];
        const previous = persistedById.get(r.id);
        return previous ? [previous] : [];
      });
      void spreadsheet.setDataValidations(toPersist);
    },
    [spreadsheet],
  );

  const updateRule = useCallback(
    (ruleId: string, patch: Partial<DataValidationRule>) => {
      const nextRules = rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule,
      );
      commitRules(nextRules);
    },
    [commitRules, rules],
  );

  const addRule = useCallback(
    (kind: DataValidationKind): string => {
      const selectionRange = getSelectionRange();
      const parsed = selectionRange ? parseA1Ranges(selectionRange) : null;
      const ranges: Range[] = parsed || [
        [
          { r: 1, c: 1 },
          { r: 1, c: 1 },
        ],
      ];
      const id = `dv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const rule: DataValidationRule =
        kind === "list"
          ? { id, kind: "list", ranges, list: [], showArrow: true, onInvalid: "warning" }
          : kind === "date"
            ? { id, kind: "date", ranges, operator: "dateValid", onInvalid: "warning" }
            : { id, kind: "checkbox", ranges };
      commitRules([...rules, rule]);
      setSelectedRuleId(id);
      return id;
    },
    [commitRules, getSelectionRange, rules],
  );

  // Load rules whenever the panel opens; select the rule (any kind) at the
  // active cell if there is one, else keep/pick the first rule.
  useEffect(() => {
    if (!open || !spreadsheet) {
      return;
    }
    const loaded = spreadsheet.getDataValidations();
    setRules(loaded);
    const existing = spreadsheet.getDataValidationAt();
    if (existing) {
      setSelectedRuleId(existing.id);
    } else {
      setSelectedRuleId((current) =>
        current && loaded.some((r) => r.id === current)
          ? current
          : loaded[0]?.id ?? null,
      );
    }
  }, [open, spreadsheet]);

  // Sync editor fields when the selected rule changes. Keyed on selectedRuleId
  // only — not selectedRule — because selectedRule is a new object reference
  // on every updateRule() call (switch toggle, radio change, options blur),
  // and re-running this effect on those would overwrite in-progress edits.
  useEffect(() => {
    setRangeInput(selectedRule ? formatA1Ranges(selectedRule.ranges) : "");
    setOptionsText(
      selectedRule?.kind === "list" ? (selectedRule.list ?? []).join("\n") : "",
    );
    // Only re-run when the selected rule changes, not on every field edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRuleId, selectedRule?.kind]);

  if (!open) {
    return null;
  }

  const handleApplyRange = () => {
    if (!selectedRule) return;
    const parsed = parseA1Ranges(rangeInput);
    if (!parsed) {
      toast.error("Enter valid A1 ranges like A1:D20 or A1:B10, D1:E10.");
      return;
    }
    updateRule(selectedRule.id, { ranges: parsed });
  };

  const handleUseSelectionRange = () => {
    const selectionRange = getSelectionRange();
    if (!selectionRange) {
      toast.error("Select a cell range first.");
      return;
    }
    setRangeInput(selectionRange);
    if (!selectedRule) return;
    const parsed = parseA1Ranges(selectionRange);
    if (parsed) updateRule(selectedRule.id, { ranges: parsed });
  };

  const handleCommitOptions = () => {
    if (!selectedRule || selectedRule.kind !== "list") return;
    const options = normalizeListOptions(optionsText.split("\n"));
    updateRule(selectedRule.id, { list: options });
  };

  const handleChangeKind = (kind: DataValidationKind) => {
    if (!selectedRule) return;
    if (kind === "list") {
      updateRule(selectedRule.id, {
        kind: "list",
        list: selectedRule.list ?? [],
        showArrow: selectedRule.showArrow ?? true,
        onInvalid: selectedRule.onInvalid ?? "warning",
      });
    } else if (isComparisonKind(kind)) {
      // Operators are kind-prefixed (`date*` / `number*` / `text*`). If the
      // current operator already belongs to the target kind (e.g. a
      // checkbox↔date round-trip preserved it), keep it and its operands;
      // otherwise reset to the kind default and clear the now cross-type
      // operands (a date's "2026-07-12" must not bleed into a text "contains").
      const keepsOperator = (selectedRule.operator ?? "").startsWith(kind);
      updateRule(selectedRule.id, {
        kind,
        operator: keepsOperator
          ? selectedRule.operator
          : COMPARISON_KINDS[kind].defaultOp,
        values: keepsOperator ? selectedRule.values : undefined,
        onInvalid: selectedRule.onInvalid ?? "warning",
      });
    } else {
      // Keep list/comparison fields so switching back restores them (the engine
      // ignores them for a checkbox rule).
      updateRule(selectedRule.id, { kind: "checkbox" });
    }
  };

  const handleDeleteRule = (ruleId: string) => {
    const next = rules.filter((r) => r.id !== ruleId);
    commitRules(next);
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(next[0]?.id ?? null);
    }
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[26rem] flex-col overflow-hidden border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconListCheck size={16} className="text-primary" />
            <p className="text-sm font-semibold">Data validation</p>
          </div>
          <p className="truncate pt-1 text-xs text-muted-foreground">
            Checkbox, dropdown, date, number, and text rules for this sheet.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Close data validation panel"
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Rules
          </Label>
          <Button
            type="button"
            size="sm"
            className="gap-1"
            onClick={() => addRule("list")}
          >
            <IconPlus size={14} />
            Add
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Add a rule and choose a range to validate.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
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
                  className="w-full cursor-pointer text-left"
                  onClick={() => setSelectedRuleId(rule.id)}
                >
                  <p className="truncate text-sm font-medium">{kindLabel(rule)}</p>
                  <p className="truncate pt-1 text-xs text-muted-foreground">
                    {formatA1Ranges(rule.ranges)}
                  </p>
                </button>
                <div className="mt-2 flex items-center justify-end">
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
              <Label htmlFor="dv-apply-range">Apply to range</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="dv-apply-range"
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  placeholder="A1:B10, D1:E10"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplyRange}
                >
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

            <section className="space-y-3 rounded-lg border p-3">
              <div className="space-y-2">
                <Label htmlFor="dv-criteria">Criteria</Label>
                <Select
                  value={selectedRule.kind}
                  onValueChange={(v) => handleChangeKind(v as DataValidationKind)}
                >
                  <SelectTrigger id="dv-criteria">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="list">Dropdown</SelectItem>
                    <SelectItem value="checkbox">Checkbox</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {selectedRule.kind === "list" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="dv-options">Options (one per line)</Label>
                    <textarea
                      id="dv-options"
                      value={optionsText}
                      onChange={(e) => setOptionsText(e.target.value)}
                      onBlur={handleCommitOptions}
                      rows={5}
                      placeholder={"Red\nGreen\nBlue"}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="dv-show-arrow" className="font-normal">
                      Show dropdown arrow
                    </Label>
                    <Switch
                      id="dv-show-arrow"
                      checked={selectedRule.showArrow !== false}
                      onCheckedChange={(checked) =>
                        updateRule(selectedRule.id, { showArrow: checked })
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>If the data is invalid</Label>
                    <RadioGroup
                      value={selectedRule.onInvalid ?? "warning"}
                      onValueChange={(v) =>
                        updateRule(selectedRule.id, {
                          onInvalid: v as "reject" | "warning",
                        })
                      }
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="warning" id="dv-warning" />
                        <Label htmlFor="dv-warning" className="font-normal">
                          Show a warning
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="reject" id="dv-reject" />
                        <Label htmlFor="dv-reject" className="font-normal">
                          Reject the input
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </>
              )}

              {isComparisonKind(selectedRule.kind) &&
                (() => {
                  const config = COMPARISON_KINDS[selectedRule.kind];
                  const op = selectedRule.operator ?? config.defaultOp;
                  const operandCount = validationOperandCount(op);
                  return (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="dv-cmp-op">Condition</Label>
                        <Select
                          value={op}
                          onValueChange={(v) =>
                            updateRule(selectedRule.id, {
                              operator: v as DataValidationOperator,
                            })
                          }
                        >
                          <SelectTrigger id="dv-cmp-op">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {config.operators.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {operandCount >= 1 && (
                        <div className="flex items-center gap-2">
                          <Input
                            type={config.inputType}
                            aria-label="Value"
                            value={selectedRule.values?.[0] ?? ""}
                            onChange={(e) => {
                              const next = [...(selectedRule.values ?? [])];
                              next[0] = e.target.value;
                              updateRule(selectedRule.id, { values: next });
                            }}
                          />
                          {operandCount === 2 && (
                            <>
                              <span className="text-xs text-muted-foreground">
                                and
                              </span>
                              <Input
                                type={config.inputType}
                                aria-label="End value"
                                value={selectedRule.values?.[1] ?? ""}
                                onChange={(e) => {
                                  const next = [...(selectedRule.values ?? [])];
                                  next[1] = e.target.value;
                                  updateRule(selectedRule.id, { values: next });
                                }}
                              />
                            </>
                          )}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label>If the data is invalid</Label>
                        <RadioGroup
                          value={selectedRule.onInvalid ?? "warning"}
                          onValueChange={(v) =>
                            updateRule(selectedRule.id, {
                              onInvalid: v as "reject" | "warning",
                            })
                          }
                          className="flex flex-col gap-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="warning" id="dv-cmp-warning" />
                            <Label
                              htmlFor="dv-cmp-warning"
                              className="font-normal"
                            >
                              Show a warning
                            </Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="reject" id="dv-cmp-reject" />
                            <Label
                              htmlFor="dv-cmp-reject"
                              className="font-normal"
                            >
                              Reject the input
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>
                    </>
                  );
                })()}

              {selectedRule.kind === "checkbox" && (
                <p className="text-xs text-muted-foreground">
                  Cells become checkboxes storing TRUE / FALSE.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
