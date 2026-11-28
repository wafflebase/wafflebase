import { ForbiddenException } from '@nestjs/common';
import { AgentKeyRoute, assertAgentKeyScope } from './agent-key-scope';

@AgentKeyRoute()
class AgentController {
  next() {}
}

class DocumentsController {
  list() {}
}

const BOT_KEY = { isApiKey: true, scopes: ['agent'] };
const PERSON_KEY = { isApiKey: true, scopes: ['read', 'write'] };

describe('assertAgentKeyScope', () => {
  // A paired host holds a bot key on a machine Wafflebase does not control;
  // it must reach the task routes and nothing else in /api/v1.
  it('refuses a bot key on any other route', () => {
    expect(() =>
      assertAgentKeyScope(BOT_KEY, DocumentsController),
    ).toThrow(ForbiddenException);
  });

  it('lets a bot key through on an agent route', () => {
    expect(() => assertAgentKeyScope(BOT_KEY, AgentController)).not.toThrow();
  });

  it('leaves person keys and sessions alone', () => {
    expect(() =>
      assertAgentKeyScope(PERSON_KEY, DocumentsController),
    ).not.toThrow();
    expect(() =>
      assertAgentKeyScope({ isApiKey: false }, DocumentsController),
    ).not.toThrow();
  });
});
