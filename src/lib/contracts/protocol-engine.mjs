const allowedModes = [
  "client-freeform",
  "client-points",
  "client-protocol",
  "edited-template",
  "commented-template",
  "protocol-sync",
];

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeSpace(value).toLowerCase();
}

function normalizeRow(row) {
  return {
    clause: normalizeSpace(row?.clause),
    clientText: normalizeSpace(row?.clientText),
    ourText: normalizeSpace(row?.ourText),
    agreedText: normalizeSpace(row?.agreedText),
  };
}

function normalizeComment(item, fallbackIndex) {
  const severity =
    item?.severity === "critical" || item?.severity === "moderate" || item?.severity === "minor"
      ? item.severity
      : "minor";
  return {
    id: normalizeSpace(item?.id) || String(fallbackIndex),
    clause: normalizeSpace(item?.clause),
    was: normalizeSpace(item?.was),
    now: normalizeSpace(item?.now),
    severity,
    comment: normalizeSpace(item?.comment),
    guidance: normalizeSpace(item?.guidance),
  };
}

function rowKey(row) {
  return `${normalizeComparable(row.clause)}||${normalizeComparable(row.clientText)}`;
}

function hasMeaning(row) {
  return Boolean(
    normalizeSpace(row.clause) ||
      normalizeSpace(row.clientText) ||
      normalizeSpace(row.ourText) ||
      normalizeSpace(row.agreedText),
  );
}

function mergeManualFields(existing, incoming) {
  return {
    clause: normalizeSpace(incoming.clause || existing.clause),
    clientText: normalizeSpace(incoming.clientText || existing.clientText),
    ourText: normalizeSpace(incoming.ourText || existing.ourText),
    agreedText: normalizeSpace(incoming.agreedText || existing.agreedText),
  };
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows.map(normalizeRow)) {
    if (!hasMeaning(row)) continue;
    const key = rowKey(row);
    const prev = map.get(key);
    map.set(key, prev ? mergeManualFields(prev, row) : row);
  }
  return Array.from(map.values());
}

function mergeRows(existingRows, incomingRows) {
  const existing = existingRows.map(normalizeRow);
  const next = new Map(existing.map((row) => [rowKey(row), row]));

  for (const raw of incomingRows.map(normalizeRow)) {
    if (!hasMeaning(raw)) continue;
    const key = rowKey(raw);
    if (next.has(key)) {
      next.set(key, mergeManualFields(next.get(key), raw));
      continue;
    }

    const matchByClause = raw.clause
      ? existing.find((row) => normalizeComparable(row.clause) === normalizeComparable(raw.clause))
      : null;

    if (matchByClause) {
      const oldKey = rowKey(matchByClause);
      if (next.has(oldKey)) {
        next.delete(oldKey);
      }
      const merged = mergeManualFields(matchByClause, {
        clause: raw.clause || matchByClause.clause,
        clientText: raw.clientText || matchByClause.clientText,
        ourText: matchByClause.ourText,
        agreedText: matchByClause.agreedText,
      });
      next.set(rowKey(merged), merged);
      continue;
    }

    next.set(key, raw);
  }

  return dedupeRows(Array.from(next.values()));
}

function applyManualPatch(existingRows, patchRows) {
  const rows = existingRows.map(normalizeRow);
  for (const patch of patchRows || []) {
    const clauseKey = normalizeComparable(patch?.clause);
    const idx = clauseKey
      ? rows.findIndex((row) => normalizeComparable(row.clause) === clauseKey)
      : -1;
    const normalizedPatch = normalizeRow(patch || {});
    if (idx >= 0) {
      rows[idx] = mergeManualFields(rows[idx], normalizedPatch);
    } else {
      rows.push(normalizedPatch);
    }
  }
  return dedupeRows(rows);
}

function normalizeComments(incomingComments) {
  if (!Array.isArray(incomingComments)) return [];
  return incomingComments.map((item, index) => normalizeComment(item, index));
}

function appendRequest(history, entry, limit = 50) {
  const next = [...(history || []), entry];
  return next.slice(-limit);
}

function parseMode(value) {
  return allowedModes.includes(value) ? value : "client-points";
}

async function runProtocolEngine({
  mode,
  templateText,
  existingRows,
  existingComments,
  existingProtocolText,
  newInputText,
  rulesText,
  lawsText,
  requestHistory,
  aiAdapter,
  mockAiResult,
  now,
}) {
  const safeMode = parseMode(mode);
  const trimmedInput = normalizeSpace(newInputText || "");

  if (!trimmedInput) {
    return {
      rows: dedupeRows(existingRows || []),
      comments: normalizeComments(existingComments || []),
      summary: normalizeSpace(""),
      recommendation: normalizeSpace(""),
      requestHistory: requestHistory || [],
      usedAi: false,
    };
  }

  const aiResult =
    mockAiResult ||
    (aiAdapter
      ? await aiAdapter({
          mode: safeMode,
          templateText: templateText || "",
          existingRows: dedupeRows(existingRows || []),
          existingComments: normalizeComments(existingComments || []),
          existingSummary: "",
          existingRecommendation: "",
          existingProtocolText: existingProtocolText || "",
          newInputText: trimmedInput,
          rulesText: rulesText || "",
          lawsText: lawsText || "",
          requestHistory: requestHistory || [],
        })
      : null);

  if (!aiResult) {
    return {
      rows: dedupeRows(existingRows || []),
      comments: normalizeComments(existingComments || []),
      summary: normalizeSpace(""),
      recommendation: normalizeSpace(""),
      requestHistory: requestHistory || [],
      usedAi: false,
    };
  }

  // Full rebuild: AI must return canonical rows array (may be empty to mean "no disagreements").
  // If AI response is malformed (no rows array), do not mutate existing state.
  if (!Array.isArray(aiResult.rows)) {
    return {
      rows: dedupeRows(existingRows || []),
      comments: normalizeComments(existingComments || []),
      summary: normalizeSpace(""),
      recommendation: normalizeSpace(""),
      requestHistory: requestHistory || [],
      usedAi: false,
      raw: aiResult,
    };
  }

  const nextRows = dedupeRows(aiResult.rows);
  const nextComments = Array.isArray(aiResult.comments) ? normalizeComments(aiResult.comments) : [];
  const nextSummary = normalizeSpace(aiResult.summary || "");
  const nextRecommendation = normalizeSpace(aiResult.recommendation || "");

  const logEntry = {
    id: aiResult.logId || `${Date.now()}`,
    mode: safeMode,
    text: trimmedInput,
    createdAt: now || new Date().toISOString(),
    summary: nextSummary,
  };

  return {
    rows: nextRows,
    comments: nextComments,
    summary: nextSummary,
    recommendation: nextRecommendation,
    requestHistory: appendRequest(requestHistory || [], logEntry),
    usedAi: true,
    logEntry,
    raw: aiResult,
  };
}

export {
  runProtocolEngine,
  applyManualPatch,
  normalizeRow,
  normalizeComment,
  normalizeSpace,
  dedupeRows,
};
