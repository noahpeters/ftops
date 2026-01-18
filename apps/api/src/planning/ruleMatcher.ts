import type { ClassificationFlags } from "./types";
import type { TemplateRuleMatch } from "../config/templatesRepo";

export type GroupContext = {
  kind: "project" | "shared" | "deliverable";
  category_key?: string;
  deliverable_key?: string;
  flags: ClassificationFlags;
  group_key_present: boolean;
  quantity_total: number;
};

export function matchRule(match: TemplateRuleMatch, context: GroupContext) {
  if (match.attach_to !== context.kind) {
    return false;
  }

  if (match.category_key && match.category_key !== context.category_key) {
    return false;
  }

  if (match.deliverable_key && match.deliverable_key !== context.deliverable_key) {
    return false;
  }

  if (typeof match.group_key_present === "boolean") {
    if (match.group_key_present !== context.group_key_present) {
      return false;
    }
  }

  if (typeof match.min_quantity_total === "number") {
    if (context.quantity_total < match.min_quantity_total) {
      return false;
    }
  }

  if (match.flags_all && !flagsAll(match.flags_all, context.flags)) {
    return false;
  }

  if (match.flags_any && !flagsAny(match.flags_any, context.flags)) {
    return false;
  }

  if (match.flags_none && !flagsNone(match.flags_none, context.flags)) {
    return false;
  }

  return true;
}

function flagsAll(keys: string[], flags: ClassificationFlags) {
  return keys.every((key) => flags[key as keyof ClassificationFlags]);
}

function flagsAny(keys: string[], flags: ClassificationFlags) {
  return keys.some((key) => flags[key as keyof ClassificationFlags]);
}

function flagsNone(keys: string[], flags: ClassificationFlags) {
  return keys.every((key) => !flags[key as keyof ClassificationFlags]);
}
