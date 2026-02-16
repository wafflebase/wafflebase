const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
];

export function validateSelectQuery(sql: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  // Strip SQL comments (-- line comments and /* block comments */)
  const withoutComments = trimmed
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (!withoutComments) {
    return { valid: false, error: 'Query cannot be empty after removing comments' };
  }

  // Check the first meaningful token is SELECT or WITH (for CTEs)
  const firstToken = withoutComments.split(/\s+/)[0].toUpperCase();
  if (firstToken !== 'SELECT' && firstToken !== 'WITH') {
    return {
      valid: false,
      error: 'Only SELECT queries are allowed',
    };
  }

  // Check for forbidden keywords as standalone tokens
  const upperSql = withoutComments.toUpperCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Match keyword as a whole word (not part of column/table names)
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upperSql)) {
      return {
        valid: false,
        error: `Forbidden keyword: ${keyword}`,
      };
    }
  }

  // Check for multiple statements (semicolons followed by non-whitespace)
  const withoutStrings = withoutComments.replace(/'[^']*'/g, '');
  const statements = withoutStrings.split(';').filter((s) => s.trim().length > 0);
  if (statements.length > 1) {
    return {
      valid: false,
      error: 'Multiple statements are not allowed',
    };
  }

  return { valid: true };
}
