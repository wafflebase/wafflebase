import { test, expect } from '../../fixtures';

test.describe('Dashboard: create presentation', () => {
  test('creates a new presentation and lists it on the dashboard', async ({ page }) => {
    await page.goto('/');

    // Wait for the documents page filter to be ready as a precondition
    // (the page has no h1; the filter input is the most reliable visible marker).
    await expect(page.getByPlaceholder(/filter by title/i)).toBeVisible();

    const docsBefore = await page.getByTestId('document-row').count();

    await page.getByRole('button', { name: /^new$/i }).click();
    await page.getByRole('menuitem', { name: /new presentation/i }).click();

    // Creation navigates to /p/<id> and mounts the slides editor.
    await expect(page).toHaveURL(/\/p\/[a-z0-9-]+/i);
    await expect(page.getByTestId('slides-editor')).toBeVisible();

    // Back on the dashboard, the row count went up by exactly one.
    await page.goto('/');
    await expect(page.getByPlaceholder(/filter by title/i)).toBeVisible();
    const docsAfter = await page.getByTestId('document-row').count();
    expect(docsAfter).toBe(docsBefore + 1);
  });
});
