import type {
  ProtocolComment,
  ProtocolInputMode,
  ProtocolRequestLog,
  ProtocolRow,
} from "./types";

export type ProtocolAiPayload = {
  mode: ProtocolInputMode;
  templateText: string;
  existingRows: ProtocolRow[];
  existingProtocolText: string;
  newInputText: string;
  rulesText: string;
  lawsText: string;
  requestHistory: ProtocolRequestLog[];
};

export type ProtocolAiResult = {
  summary?: string;
  recommendation?: string;
  rows?: ProtocolRow[];
  comments?: ProtocolComment[];
  logId?: string;
};

export type ProtocolEngineResult = {
  rows: ProtocolRow[];
  comments: ProtocolComment[];
  summary: string;
  recommendation: string;
  requestHistory: ProtocolRequestLog[];
  usedAi: boolean;
  logEntry?: ProtocolRequestLog;
};

export function runProtocolEngine(input: {
  mode: ProtocolInputMode | string;
  templateText: string;
  existingRows: ProtocolRow[];
  existingComments: ProtocolComment[];
  existingProtocolText: string;
  newInputText: string;
  rulesText: string;
  lawsText: string;
  requestHistory: ProtocolRequestLog[];
  aiAdapter?: (payload: ProtocolAiPayload) => Promise<ProtocolAiResult | null>;
  mockAiResult?: ProtocolAiResult | null;
  now?: string;
}): Promise<ProtocolEngineResult>;

export function applyManualPatch(existingRows: ProtocolRow[], patchRows: Partial<ProtocolRow>[]): ProtocolRow[];
export function normalizeRow(row: Partial<ProtocolRow>): ProtocolRow;
export function normalizeComment(item: Partial<ProtocolComment>, fallbackIndex: number): ProtocolComment;
export function normalizeSpace(value: string): string;
export function dedupeRows(rows: ProtocolRow[]): ProtocolRow[];
export function mergeRows(existingRows: ProtocolRow[], incomingRows: ProtocolRow[]): ProtocolRow[];
