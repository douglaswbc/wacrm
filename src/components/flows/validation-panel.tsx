"use client";

/**
 * Validation panel — surfaces every error and warning from
 * `validateFlowForActivation`. Lives once at the bottom of the
 * editor shell so it's visible in both views (canvas + list).
 *
 * Node-scoped issues are clickable: tapping one calls
 * `requestFlash(node_key)` on the editor context. List view's
 * useEffect on `flashKey` expands + scrolls + flashes the row;
 * canvas view's useEffect pans the viewport + flashes the card.
 * Both views read the same flashKey so the panel doesn't need
 * per-view plumbing.
 *
 * Trigger-scoped issues are NOT clickable from canvas — trigger
 * config is a list-only panel (it's a flat form, not a graph
 * concept). User can switch to List to address them.
 */

import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import type { ValidationIssue } from "@/lib/flows/validate";
import { useFlowEditor } from "./flow-editor-state";

// Maps each stable validation code to its translation key. Issues
// whose code has no entry (or whose key isn't in the dictionaries
// yet) fall back to the raw server-side message.
const ISSUE_CODE_KEYS: Record<string, string> = {
  missing_name: "flows.validation.missing_name",
  missing_keywords: "flows.validation.missing_keywords",
  blank_keywords: "flows.validation.blank_keywords",
  missing_entry_node: "flows.validation.missing_entry_node",
  no_nodes: "flows.validation.no_nodes",
  entry_node_not_found: "flows.validation.entry_node_not_found",
  duplicate_node_key: "flows.validation.duplicate_node_key",
  unreachable_node: "flows.validation.unreachable_node",
  missing_text: "flows.validation.missing_text",
  missing_prompt: "flows.validation.missing_prompt",
  missing_media_url: "flows.validation.missing_media_url",
  invalid_media_type: "flows.validation.invalid_media_type",
  caption_too_long: "flows.validation.caption_too_long",
  missing_button_label: "flows.validation.missing_button_label",
  missing_buttons: "flows.validation.missing_buttons",
  too_many_buttons: "flows.validation.too_many_buttons",
  missing_reply_id: "flows.validation.missing_reply_id",
  duplicate_reply_id: "flows.validation.duplicate_reply_id",
  missing_title: "flows.validation.missing_title",
  button_title_too_long: "flows.validation.button_title_too_long",
  row_title_too_long: "flows.validation.row_title_too_long",
  row_description_too_long: "flows.validation.row_description_too_long",
  no_rows: "flows.validation.no_rows",
  too_many_rows: "flows.validation.too_many_rows",
  missing_next: "flows.validation.missing_next",
  invalid_next: "flows.validation.invalid_next",
  missing_var_key: "flows.validation.missing_var_key",
  invalid_var_key: "flows.validation.invalid_var_key",
  missing_extract_prompt: "flows.validation.missing_extract_prompt",
  missing_fields: "flows.validation.missing_fields",
  field_missing_name: "flows.validation.field_missing_name",
  field_missing_var_key: "flows.validation.field_missing_var_key",
  missing_subject: "flows.validation.missing_subject",
  missing_subject_key: "flows.validation.missing_subject_key",
  missing_operator: "flows.validation.missing_operator",
  empty_value: "flows.validation.empty_value",
  missing_true_branch: "flows.validation.missing_true_branch",
  missing_false_branch: "flows.validation.missing_false_branch",
  invalid_true_branch: "flows.validation.invalid_true_branch",
  invalid_false_branch: "flows.validation.invalid_false_branch",
  missing_mode: "flows.validation.missing_mode",
  missing_tag: "flows.validation.missing_tag",
  missing_ai_prompt: "flows.validation.missing_ai_prompt",
  unknown_node_type: "flows.validation.unknown_node_type",
};

function issueText(issue: ValidationIssue, t: (key: string) => string): string {
  const key = issue.code ? ISSUE_CODE_KEYS[issue.code] : undefined;
  if (!key) return issue.message;
  const translated = t(key);
  // t() echoes the key back when it's missing from the dictionaries.
  return translated !== key ? translated : issue.message;
}

export function ValidationPanel() {
  const { t } = useLanguage();
  const { issues, requestFlash } = useFlowEditor();

  if (issues.length === 0) {
    // Slate-950 base + emerald accents so the panel stays readable when
    // sticky-positioned over scrolled-behind node cards (a translucent
    // bg-emerald-500/10 would bleed through ugly).
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-background p-3 text-sm font-medium text-emerald-300">
        <CircleCheck className="h-4 w-4 shrink-0" />
        {t("flows.validation.noIssues")}
      </div>
    );
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const errorsLabel =
    errors.length === 1
      ? t("flows.validation.error", 1)
      : t("flows.validation.errors", errors.length);
  const warningsLabel =
    warnings.length === 1
      ? t("flows.validation.warning", 1)
      : t("flows.validation.warnings", warnings.length);
  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3",
        errors.length > 0 ? "border-red-500/40" : "border-amber-500/40",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {errors.length > 0 ? (
          <CircleAlert className="h-4 w-4 text-red-400" />
        ) : (
          <CircleAlert className="h-4 w-4 text-amber-400" />
        )}
        {errorsLabel},{" "}
        {warningsLabel}
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i, ix) => (
          <IssueLine key={ix} issue={i} onJump={requestFlash} />
        ))}
      </div>
    </div>
  );
}

/**
 * Exported so the per-node card (list view) and the trigger panel
 * can render the same "icon + node key chip + message" formatting
 * for their own per-row issue lists without re-implementing the
 * tone / icon / accessibility logic.
 */
export function IssueLine({
  issue,
  onJump,
}: {
  issue: ValidationIssue;
  onJump?: (key: string) => void;
}) {
  const { t } = useLanguage();
  const tone =
    issue.severity === "error" ? "text-red-300" : "text-amber-300";
  const iconTone =
    issue.severity === "error" ? "text-red-400" : "text-amber-400";
  const body = (
    <>
      <CircleAlert className={cn("mt-0.5 h-3 w-3 shrink-0", iconTone)} />
      <span className="min-w-0 flex-1">
        {issue.node_key && (
          <code className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            {issue.node_key}
          </code>
        )}
        {issueText(issue, t)}
      </span>
    </>
  );

  // Only node-scoped issues can jump; trigger-scoped issues have no
  // destination (the trigger panel is list-only and already at the
  // top of that view).
  if (issue.node_key && onJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(issue.node_key!)}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted/60",
          tone,
        )}
        aria-label={`${t("flows.validation.jumpToNode")} ${issue.node_key}`}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1 text-xs",
        tone,
      )}
    >
      {body}
    </div>
  );
}
