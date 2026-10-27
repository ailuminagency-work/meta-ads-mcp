/**
 * Shared validation helpers for tool inputs.
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * Validate that at least one of the given fields is present.
 */
export function requireOneOf(
  obj: Record<string, unknown>,
  fields: string[],
  message?: string,
): void {
  const present = fields.filter(
    (f) => obj[f] !== undefined && obj[f] !== null,
  );
  if (present.length === 0) {
    throw new Error(
      message ?? `At least one of [${fields.join(", ")}] is required.`,
    );
  }
}

const MAX_FIELDS_LENGTH = 2000;
const MAX_FIELDS_DEPTH = 4;
const MAX_FIELD_ITEMS = 200;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CREDENTIAL_WORDS = /token|secret|password/i;
/** Edges that hand back credentials unless the caller names the sub-fields it wants. */
const EDGES_NEEDING_SUBFIELDS = new Set(["accounts", "owned_pages", "client_pages", "instagram_accounts"]);
/** `.fields(...)` would be a second way to name sub-fields that this check does not read. */
const FORBIDDEN_MODIFIERS = new Set(["fields", "as", "edge"]);

function refuseFields(reason: string): never {
  throw new McpError(
    ErrorCode.InvalidParams,
    `Requested fields are not allowed: ${reason}. Use plain field names, optionally nested as name{sub,fields}.`,
  );
}

/**
 * A `fields` value is relayed to the Graph API for whatever node id the caller
 * names, so it must not be a way to read credentials (`access_token`,
 * `owned_pages{access_token}`) or to smuggle other syntax past this check.
 * Accepts `name`, `name{...}` and `name.modifier(args){...}` only.
 */
export function assertSafeGraphFields(expression: string): void {
  if (expression.length > MAX_FIELDS_LENGTH) refuseFields("the list is too long");
  if (CREDENTIAL_WORDS.test(expression)) refuseFields("credentials, tokens and secrets cannot be requested");

  let pos = 0;
  let items = 0;
  const skipSpace = () => {
    while (pos < expression.length && expression[pos] === " ") pos += 1;
  };
  const parseList = (depth: number): void => {
    if (depth > MAX_FIELDS_DEPTH) refuseFields("nesting is too deep");
    for (;;) {
      skipSpace();
      const start = pos;
      while (pos < expression.length && /[A-Za-z0-9_]/.test(expression[pos])) pos += 1;
      const name = expression.slice(start, pos);
      if (!FIELD_NAME.test(name)) refuseFields("unrecognised field syntax");
      if ((items += 1) > MAX_FIELD_ITEMS) refuseFields("too many fields");
      while (expression[pos] === ".") {
        pos += 1;
        const modifierStart = pos;
        while (pos < expression.length && /[A-Za-z_]/.test(expression[pos])) pos += 1;
        const modifier = expression.slice(modifierStart, pos);
        if (!modifier || FORBIDDEN_MODIFIERS.has(modifier.toLowerCase()) || expression[pos] !== "(") refuseFields("unrecognised field syntax");
        const close = expression.indexOf(")", pos);
        const args = close < 0 ? "" : expression.slice(pos + 1, close);
        if (close < 0 || /[(){}[\]]/.test(args)) refuseFields("unrecognised field syntax");
        pos = close + 1;
      }
      skipSpace();
      if (expression[pos] === "{") {
        pos += 1;
        parseList(depth + 1);
        if (expression[pos] !== "}") refuseFields("unbalanced braces");
        pos += 1;
        skipSpace();
      } else if (EDGES_NEEDING_SUBFIELDS.has(name.toLowerCase())) {
        refuseFields(`${name} needs explicit sub-fields`);
      }
      if (expression[pos] === ",") {
        pos += 1;
        continue;
      }
      return;
    }
  };
  parseList(0);
  if (pos !== expression.length) refuseFields("unrecognised field syntax");
}

/**
 * Build a fields param string for Meta API from an array or use defaults.
 * What is built is checked, so every tool that relays a caller's `fields`
 * refuses credential fields and unrecognised syntax in one place.
 */
export function buildFieldsParam(
  fields: string[] | undefined,
  defaults: string[],
): string {
  const built = (fields && fields.length > 0 ? fields : defaults).join(",");
  assertSafeGraphFields(built);
  return built;
}

/**
 * Normalize a url_tags value: Meta stores it without the leading "?", and
 * keeping it would produce "??utm_source=..." in the final click URL.
 */
export function normalizeUrlTags(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
}
