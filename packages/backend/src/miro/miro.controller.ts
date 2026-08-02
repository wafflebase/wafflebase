import {
  Body,
  Controller,
  HttpException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';
import { MiroService } from './miro.service';
import { ImportMiroBoardDto } from './miro.dto';
import type { MiroImportEvent } from './miro.types';

/**
 * `application/x-ndjson` — one JSON value per line. Chosen over SSE because
 * the payload is a single request/response with a terminal value, not an
 * open-ended event source, and NDJSON keeps the terminal `result` in the same
 * frame vocabulary as the progress lines.
 */
const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

@Controller()
@UseGuards(JwtAuthGuard)
export class MiroController {
  constructor(
    private readonly miroService: MiroService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Fetch a Miro board's items + connectors on the caller's behalf, streaming
   * progress as NDJSON. The token lives only for this request; neither the
   * progress lines nor the result nor an error line ever contains it.
   *
   * ## Why one streamed response and not a job + polling
   *
   * The token must be sent EXACTLY ONCE. A job-id design would either have to
   * park the credential server-side between requests (which the whole feature
   * is built to avoid) or make the client resend it on every poll. Streaming
   * keeps the one-shot credential property and still tells the user what is
   * happening during a 30-60s import.
   *
   * ## The error boundary
   *
   * Everything above `res.write` runs with the status code still OPEN, so a
   * failure there is a normal Nest exception and reaches the client as
   * 400/401/403/404/429 with a JSON body — exactly as before this endpoint
   * streamed. `prepareImport` is placed here deliberately: it performs the
   * first authenticated Miro call, which is what surfaces auth, permission and
   * not-found.
   *
   * Everything below it runs with the response already committed to 200, where
   * a status can no longer be changed. Those failures are reported IN-BAND as
   * a final `{"type":"error"}` line, and the client treats that line exactly
   * like a thrown error.
   */
  @Post('workspaces/:workspaceId/miro/import')
  async importBoard(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportMiroBoardDto,
    @Res() res: Response,
  ): Promise<void> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);

    // --- status code still open ------------------------------------------
    const session = await this.miroService.prepareImport(
      dto.token,
      dto.boardUrl,
    );

    // --- committed to 200 from here on -----------------------------------
    res.status(200);
    res.setHeader('Content-Type', NDJSON_CONTENT_TYPE);
    // `no-transform` forbids a proxy from re-encoding (and therefore
    // re-buffering) the body; `X-Accel-Buffering: no` is nginx's opt-out from
    // proxy_buffering, which would otherwise hold every line until the
    // response completed and defeat the entire point of streaming.
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    // Progress lines are tiny; without this Nagle can sit on them for ~40ms
    // each, and with nothing else to piggyback on they arrive in clumps.
    res.socket?.setNoDelay(true);
    res.flushHeaders();

    const write = (event: MiroImportEvent): void => {
      // One `write` per line: Express hands each straight to the socket, so a
      // line is on the wire as soon as it is produced. Never batched.
      res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      const result = await this.miroService.runImport(
        session,
        dto.token,
        workspaceId,
        write,
      );
      write({ type: 'result', ...result });
    } catch (err) {
      write({ type: 'error', message: MiroController.safeErrorMessage(err) });
    } finally {
      res.end();
    }
  }

  /**
   * The user-facing text for an in-band failure.
   *
   * ALLOWLIST, not a scrub. Only `HttpException` messages are forwarded: every
   * one of them is raised by `MiroService`/`parseMiroBoardId` from a string
   * literal that never interpolates the token, the URL, or the caller's input.
   * Anything else is an error this module did not write — an S3 driver, a DNS
   * failure, a future dependency — whose message could contain the request it
   * was making, bearer header included.
   *
   * The rejected alternative was `message.includes(token) ? generic : message`.
   * It reads as safer and is not: it is a substring test against an
   * attacker-influenced value, so a short token silently censors legitimate
   * text (the literal `"tok"` matches the word "token" in this module's own
   * 404 message), while a token that arrives percent-encoded, case-folded, or
   * split across a line wrap sails straight through. A rule that can be wrong
   * in both directions is not a guard.
   */
  private static safeErrorMessage(err: unknown): string {
    if (err instanceof HttpException) {
      const message = err.message.trim();
      if (message) return message;
    }
    return 'The Miro import failed';
  }
}
