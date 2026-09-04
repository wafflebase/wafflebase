import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

/**
 * Bodies for `/api/v1/workspaces/:workspaceId/documents`.
 *
 * These exist as **classes**, not inline structural types on the `@Body()`
 * parameter. The global `ValidationPipe` in `main.ts` runs with
 * `whitelist: true, forbidNonWhitelisted: true`, but it can only see
 * properties declared on a DTO class: TypeScript emits `Object` as the
 * metatype for `@Body() body: { title?: string }`, and the pipe skips it
 * entirely. The update handler then spread that raw body into
 * `prisma.document.update`, where `type` / `fileId` / `fileSize` / `mimeType`
 * are all plain updatable columns — so a `PATCH` could reroute which editor
 * opens a document, or repoint it at another workspace's blob without any of
 * the `assertFileIdAllowed` checking the upload path performs.
 *
 * Every new body on this surface goes through a class here for that reason.
 */

/** Title length cap, matching `document.dto.ts`. */
const TITLE_MAX = 200;

export class ApiV1CreateDocumentDto {
  /**
   * No `@IsOptional()` here, so the `null` hole the update DTO had never
   * existed on this one: `{"title": null}` reaches `@IsString()` and is a 400.
   */
  @IsString()
  @Length(1, TITLE_MAX)
  title: string;

  /**
   * Deliberately not `@IsIn(...)`: this surface has always *coerced* an
   * unrecognized type to `sheet` rather than rejecting it, and the handler
   * still does. The decorator only bounds the shape so the property is
   * whitelisted; which types are accepted is unchanged.
   *
   * `@IsOptional()` is also deliberate, and is *not* the update DTO's bug.
   * `null` does skip `@IsString()` here, but the handler never forwards this
   * value — it matches it against the four accepted types and passes `sheet`
   * otherwise — so `null` lands on the same fallback any unrecognized string
   * does. Rejecting it would make `null` a 400 while `"nonsense"` still
   * becomes a sheet, which contradicts the coercion contract above rather
   * than tightening it.
   */
  @IsOptional()
  @IsString()
  type?: string;
}

export class ApiV1UpdateDocumentDto {
  /**
   * `@ValidateIf`, not `@IsOptional()`. `@IsOptional()` treats `null` as
   * "absent" and skips every decorator after it, so `{"title": null}` used to
   * validate; the handler forwards any title that is not `undefined`, and
   * `Document.title` is a non-nullable `String`, so the `null` reached
   * `prisma.document.update` and threw. With no global exception filter that
   * surfaced as a 500 — the same shape of defect this DTO was added to close.
   *
   * The condition distinguishes the two cases `@IsOptional()` conflates:
   * omitted stays legal (a PATCH need not carry a title), `null` now fails
   * `@IsString()` and is a 400. `class-validator`'s `whitelist` still keeps the
   * property, which is decided by `@IsString`/`@Length` being present at all,
   * not by the condition. Matches `lakehouse.dto.ts`, which uses this idiom
   * throughout for the same reason.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, TITLE_MAX)
  title?: string;

  /**
   * `undefined` = leave the document where it is; explicit `null` = move it to
   * the workspace root. Both are meaningful, so this is `@IsOptional()` —
   * which class-validator skips for `null` as well as `undefined` — matching
   * `UpdateDocumentDto.folderId` on the web surface. A non-string, non-null
   * value (a number, an object) still fails `@IsUUID()` and is a 400.
   *
   * Declaring it at all is what keeps the folder move working: the pipe runs
   * with `forbidNonWhitelisted`, so an undeclared `folderId` would be rejected
   * outright rather than ignored.
   */
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}
