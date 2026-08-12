import { describe, it, expect } from 'vitest';
import { startCallbackServer } from '../src/commands/login.js';

// The login callback listens on loopback, but the port is guessable and any
// page in the user's browser can navigate to it. The nonce echoed back as
// `state` is the only thing that ties a `code` to the flow this process
// started — without it the CLI would redeem an attacker's code and log the
// terminal into their account (RFC 8252 §8.9).
describe('login callback server', () => {
  it('rejects a callback whose state is missing or wrong, and takes the matching one', async () => {
    const { port, waitForCallback, close } =
      await startCallbackServer('the-nonce');
    try {
      const noState = await fetch(
        `http://127.0.0.1:${port}/callback?code=evil-1`,
      );
      expect(noState.status).toBe(400);

      const wrongState = await fetch(
        `http://127.0.0.1:${port}/callback?code=evil-2&state=guessed`,
      );
      expect(wrongState.status).toBe(400);

      // The listener survives the rejections, so the genuine callback — which
      // may arrive after an attacker's probe — is still accepted.
      const ok = await fetch(
        `http://127.0.0.1:${port}/callback?code=real&state=the-nonce`,
      );
      expect(ok.status).toBe(200);

      await expect(waitForCallback()).resolves.toBe('real');
    } finally {
      close();
    }
  });
});
