import { Fragment } from "react";
import { TEMPLATE_CATEGORY_TREE } from "@wafflebase/core/templates";
import { SelectItem, SelectSeparator } from "@/components/ui/select";

/**
 * The template category options, grouped by top: each top is selectable on
 * its own (a listing that fits no leaf, or "everything under Work" when
 * browsing), followed by its leaves, indented.
 *
 * One component for the gallery filter and the listing form so the two
 * pickers cannot drift. Labels are English for now; i18n is deferred and will
 * key on the slug, which is what is stored.
 */
export function TemplateCategoryItems() {
  return TEMPLATE_CATEGORY_TREE.map((top) => (
    <Fragment key={top.slug}>
      <SelectSeparator />
      <SelectItem value={top.slug} className="font-medium">
        {top.label}
      </SelectItem>
      {top.children.map((leaf) => (
        <SelectItem
          key={leaf.slug}
          value={`${top.slug}/${leaf.slug}`}
          className="pl-5"
        >
          {leaf.label}
        </SelectItem>
      ))}
    </Fragment>
  ));
}
