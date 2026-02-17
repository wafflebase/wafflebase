import { validateSelectQuery } from './sql-validator';

describe('validateSelectQuery', () => {
  it('accepts simple SELECT queries', () => {
    expect(validateSelectQuery('SELECT * FROM users')).toEqual({ valid: true });
  });

  it('accepts CTE queries and strips comments', () => {
    const sql = `
      -- get active users
      WITH active_users AS (
        SELECT id FROM users WHERE active = true
      )
      SELECT * FROM active_users
    `;

    expect(validateSelectQuery(sql)).toEqual({ valid: true });
  });

  it('rejects empty queries', () => {
    expect(validateSelectQuery('   ')).toEqual({
      valid: false,
      error: 'Query cannot be empty',
    });
  });

  it('rejects non-SELECT first tokens', () => {
    expect(validateSelectQuery('DELETE FROM users')).toEqual({
      valid: false,
      error: 'Only SELECT queries are allowed',
    });
  });

  it('rejects forbidden keywords', () => {
    expect(validateSelectQuery('SELECT id FROM users; DROP TABLE users')).toEqual(
      {
        valid: false,
        error: 'Forbidden keyword: DROP',
      },
    );
  });

  it('rejects multiple statements', () => {
    expect(validateSelectQuery('SELECT 1; SELECT 2')).toEqual({
      valid: false,
      error: 'Multiple statements are not allowed',
    });
  });
});
