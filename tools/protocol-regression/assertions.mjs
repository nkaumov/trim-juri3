import { normalizeSpace } from "../../src/lib/contracts/protocol-engine.mjs";

export function assertNoDuplicateClauses(rows) {
  const seen = new Map();
  const issues = [];
  for (const row of rows) {
    const clause = normalizeSpace(row.clause);
    if (!clause) continue;
    if (seen.has(clause)) {
      issues.push(`duplicate clause: ${clause}`);
    }
    seen.set(clause, true);
  }
  return issues;
}

export function assertNoDuplicateMeaning(rows) {
  const seen = new Map();
  const issues = [];
  for (const row of rows) {
    const text = normalizeSpace(row.clientText);
    if (!text) continue;
    if (seen.has(text)) {
      issues.push(`duplicate clientText: ${text}`);
    }
    seen.set(text, true);
  }
  return issues;
}

export function assertManualFieldsPreserved(rows, expectations) {
  const issues = [];
  const manual = expectations?.manualFields || [];
  for (const expected of manual) {
    const clause = normalizeSpace(expected.clause);
    const row = rows.find((item) => normalizeSpace(item.clause) === clause);
    if (!row) {
      issues.push(`manual field missing clause: ${clause}`);
      continue;
    }
    if (expected.ourText && normalizeSpace(row.ourText) !== normalizeSpace(expected.ourText)) {
      issues.push(`manual ourText mismatch for clause: ${clause}`);
    }
    if (
      expected.agreedText &&
      normalizeSpace(row.agreedText) !== normalizeSpace(expected.agreedText)
    ) {
      issues.push(`manual agreedText mismatch for clause: ${clause}`);
    }
  }
  return issues;
}

export function assertCommentsAreCurrentOnly(rows, comments, expectations) {
  const issues = [];
  const clauseSet = new Set(rows.map((row) => normalizeSpace(row.clause)).filter(Boolean));
  const expectedClauses = expectations?.commentsForClauses || null;
  if (expectedClauses) {
    for (const clause of expectedClauses) {
      if (!comments.some((item) => normalizeSpace(item.clause) === normalizeSpace(clause))) {
        issues.push(`missing comment for clause: ${clause}`);
      }
    }
  }
  for (const comment of comments) {
    const clause = normalizeSpace(comment.clause);
    if (clause && !clauseSet.has(clause) && !expectedClauses) {
      issues.push(`comment clause not in rows: ${clause}`);
    }
  }
  return issues;
}

export function assertRowsNotGrowingWithoutReason(prevRows, nextRows, expectations) {
  const issues = [];
  if (expectations?.maxRowGrowth != null) {
    const growth = nextRows.length - prevRows.length;
    if (growth > expectations.maxRowGrowth) {
      issues.push(`row growth ${growth} exceeds max ${expectations.maxRowGrowth}`);
    }
  }
  if (expectations?.noGrowth && nextRows.length > prevRows.length) {
    issues.push(`rows grew from ${prevRows.length} to ${nextRows.length}`);
  }
  return issues;
}

export function assertExpectedClausesPresent(rows, expectations) {
  const issues = [];
  const clauses = rows.map((row) => normalizeSpace(row.clause));
  for (const clause of expectations?.expectedClausesPresent || []) {
    if (!clauses.includes(normalizeSpace(clause))) {
      issues.push(`expected clause missing: ${clause}`);
    }
  }
  return issues;
}

export function assertExpectedClausesAbsent(rows, expectations) {
  const issues = [];
  const clauses = rows.map((row) => normalizeSpace(row.clause));
  for (const clause of expectations?.expectedClausesAbsent || []) {
    if (clauses.includes(normalizeSpace(clause))) {
      issues.push(`unexpected clause present: ${clause}`);
    }
  }
  return issues;
}

export function runAssertions(prevState, nextState, expectations) {
  return [
    ...assertNoDuplicateClauses(nextState.rows),
    ...assertNoDuplicateMeaning(nextState.rows),
    ...assertManualFieldsPreserved(nextState.rows, expectations),
    ...assertCommentsAreCurrentOnly(nextState.rows, nextState.comments, expectations),
    ...assertRowsNotGrowingWithoutReason(prevState.rows, nextState.rows, expectations),
    ...assertExpectedClausesPresent(nextState.rows, expectations),
    ...assertExpectedClausesAbsent(nextState.rows, expectations),
  ];
}
