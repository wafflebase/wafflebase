import { test, expect } from '../../fixtures';

test.describe('Dashboard: create presentation', () => {
  test('creates a new presentation and lists it on the dashboard', async ({
    page,
    workspaceSlug,
  }) => {
    // Skip HomeOrRedirect → Navigate → PrivateRoute → Layout chain by
    // navigating directly to the workspace dashboard. The slug is
    // deterministic per worker (UserService.findOrCreateUser auto-creates
    // a `${username}-s-workspace` workspace on first login).
    const dashboardPath = `/w/${workspaceSlug}`;

    await page.goto(dashboardPath);

    // The filter input is the dashboard's most reliable visible marker:
    // it has no h1 heading, and document rows are absent for fresh users.
    await expect(page.getByPlaceholder(/filter by title/i)).toBeVisible();

    const docsBefore = await page.getByTestId('document-row').count();

    await page.getByRole('button', { name: /^new$/i }).click();
    await page.getByRole('menuitem', { name: /new presentation/i }).click();

    // Creation navigates to /p/<id> and mounts the slides editor.
    await expect(page).toHaveURL(/\/p\/[a-z0-9-]+/i);
    await expect(page.getByTestId('slides-editor')).toBeVisible();

    // Back on the dashboard, the row count went up by exactly one.
    await page.goto(dashboardPath);
    await expect(page.getByPlaceholder(/filter by title/i)).toBeVisible();
    const docsAfter = await page.getByTestId('document-row').count();
    expect(docsAfter).toBe(docsBefore + 1);
  });
});
