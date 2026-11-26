-- Taxonomy v2 (docs/design/template-catalog-scaling.md §1): the eight closed
-- v1 labels become slugs of the two-level category tree. The mapping is
-- `LEGACY_CATEGORY_ALIASES` in `@wafflebase/core/templates`.
--
-- Deliberately raw SQL rather than `TemplateService.update`: `category` is a
-- CARD_FIELD, so a service write would send every approved public card back
-- to review for a relabel that changed no content. Raw SQL also leaves
-- `updatedAt` alone (Prisma's `@updatedAt` is set by the client, not the
-- database), so the relabel does not reorder anything either.
--
-- A value outside the eight labels is left as it is: the DTO never accepted
-- one, and guessing would be worse than a card the frontend shows verbatim.
UPDATE "TemplateListing"
SET "category" = CASE "category"
  WHEN 'Business' THEN 'work'
  WHEN 'Project management' THEN 'work/project-tracker'
  WHEN 'Education' THEN 'education'
  WHEN 'Finance' THEN 'finance'
  WHEN 'Marketing' THEN 'marketing'
  WHEN 'Personal' THEN 'personal'
  WHEN 'Design' THEN 'design'
  WHEN 'Other' THEN 'other'
END
WHERE "category" IN (
  'Business',
  'Project management',
  'Education',
  'Finance',
  'Marketing',
  'Personal',
  'Design',
  'Other'
);
