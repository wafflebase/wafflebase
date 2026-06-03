// COPY THIS FILE. Replace the TODOs. Delete this header comment.
// Quick guide: ./README.md
//
// Pattern: Arrange / Act / Assert
//   Arrange — navigate and assert preconditions
//   Act     — perform the user-visible actions (click / fill / keyboard)
//   Assert  — check user-observable outcomes (URL, role, text, count)
//
// Selector priority:
//   1. getByRole(name)
//   2. getByText / getByLabel
//   3. data-testid (add to the component in the same PR if missing)
//   Avoid CSS class or structural selectors; they break on refactor.

import { test, expect } from '../fixtures'; // eslint-disable-line @typescript-eslint/no-unused-vars

test.describe('TODO: feature name', () => {
  test('TODO: behavior described in one sentence', async ({ page }) => {
    // Arrange
    await page.goto('/');

    // Act
    // TODO: user actions

    // Assert
    // TODO: user-observable outcomes
  });
});
