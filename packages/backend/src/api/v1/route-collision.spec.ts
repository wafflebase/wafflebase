import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ApiV1Module } from './api-v1.module';

/**
 * No two v1 routes may resolve to the same method + URL.
 *
 * The v1 surface mounts several controllers at overlapping prefixes: one at
 * `.../documents/:documentId/tabs` and eight more at
 * `.../documents/:documentId/tabs/:tabId`. That makes a route on the shallower
 * controller one segment deep (`:tabId/move`) indistinguishable from a bare
 * verb on a deeper one (`move`) — Express matches whichever controller Nest
 * registered first and the other endpoint silently stops existing. It is not a
 * startup error, no type catches it, and the shadowed route answers 400 rather
 * than 404, so it reads like a bad request rather than a missing handler.
 *
 * That is exactly how `POST .../tabs/:tabId/move` (tab reorder) shadowed the
 * row/column axis move. Enumerating the module's own controller list means a
 * controller added later is covered without touching this file.
 *
 * Parameter *names* are erased before comparing, since only the shape matters
 * to the router: `:documentId` and `:did` at the same position are the same
 * route. Static segments are kept, so a literal `layouts` never collides with
 * a `:tabId` — those are ordering-sensitive but unambiguous, and flagging them
 * would be a false positive.
 */
describe('v1 route table', () => {
  const controllers: unknown[] =
    (Reflect.getMetadata('controllers', ApiV1Module) as unknown[]) ?? [];

  const methodName = (m: unknown) =>
    RequestMethod[m as RequestMethod] ?? String(m);

  const normalize = (path: string) =>
    path
      .split('/')
      .filter(Boolean)
      .map((s) => (s.startsWith(':') ? ':param' : s))
      .join('/');

  it('registers at least the controllers this spec knows about', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(18);
  });

  it('has no two handlers on the same method and path', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const controller of controllers) {
      const ctor = controller as new (...args: never[]) => object;
      const prefix =
        (Reflect.getMetadata(PATH_METADATA, ctor) as string | undefined) ?? '';
      const proto = ctor.prototype as Record<string, unknown>;

      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        const handler = proto[key];
        if (typeof handler !== 'function') continue;

        const suffix = Reflect.getMetadata(PATH_METADATA, handler) as
          | string
          | undefined;
        if (suffix === undefined) continue;

        const verb = methodName(Reflect.getMetadata(METHOD_METADATA, handler));
        const route = `${verb} /${normalize(`${prefix}/${suffix}`)}`;
        const owner = `${ctor.name}.${key}`;

        const previous = seen.get(route);
        if (previous) {
          collisions.push(`${route} — ${previous} and ${owner}`);
        } else {
          seen.set(route, owner);
        }
      }
    }

    expect(collisions).toEqual([]);
  });
});
