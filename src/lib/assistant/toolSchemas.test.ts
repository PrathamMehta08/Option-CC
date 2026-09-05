import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TOOL_PARAMETERS, TOOL_NAMES, assistantTools } from './tools';

/**
 * The tool schemas, checked against what the provider will actually accept.
 *
 * This exact class of bug has now broken the assistant three separate times,
 * each time as a failed turn rather than anything visible at build time:
 *
 *   1. A discriminated union in the filter conditions — "anyOf disambiguation
 *      failed".
 *   2. `.optional()` fields in applySettings — "invalid JSON schema for tool
 *      applySettings: required must list every property". The fix for that one
 *      caused the OPPOSITE failure later: with all ten fields required, the
 *      model omitted two and the provider rejected its own model's tool call.
 *      Probed directly on 2026-09-05, Groq accepts an empty "required", so the
 *      fields are nullish and the invariant below is the one that holds.
 *   3. `.min()/.max()/.enum()` alongside `.nullable()`, which zod-to-json-schema
 *      cannot express as a simple type union and renders as `anyOf` — the same
 *      rejection as (1), reintroduced by a different route.
 *
 * Every one of those type-checked, linted and built cleanly. The schema shape
 * is the contract with the provider, so it is asserted here.
 */
function jsonSchemaFor(name: keyof typeof TOOL_PARAMETERS) {
  return zodToJsonSchema(TOOL_PARAMETERS[name]) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

describe('every tool schema is one the provider will accept', () => {
  it.each(TOOL_NAMES)('%s uses no anyOf', (name) => {
    // anyOf is rejected in tool parameters. A nullable field must serialise as
    // {"type":["number","null"]}, which means it cannot also carry min/max/enum.
    expect(JSON.stringify(jsonSchemaFor(name))).not.toContain('"anyOf"');
  });

  it.each(TOOL_NAMES)('%s never requires a property it does not declare', (name) => {
    const schema = jsonSchemaFor(name);
    const properties = Object.keys(schema.properties ?? {});
    for (const field of schema.required ?? []) expect(properties).toContain(field);
  });

  it.each(TOOL_NAMES)('%s describes every property, so the model knows what to send', (name) => {
    const properties = Object.values(jsonSchemaFor(name).properties ?? {});
    for (const property of properties) {
      expect(property).toHaveProperty('description');
    }
  });
});

describe('applySettings, the one every request goes through', () => {
  it('takes every screener setting, so a request is one call', () => {
    // Splitting a request across calls is what exhausted the rate limit
    // mid-answer; the whole point of this tool is that it cannot happen.
    const properties = Object.keys(jsonSchemaFor('applySettings').properties ?? {});
    for (const field of [
      'ticker',
      'capital',
      'minMonths',
      'maxMonths',
      'delta',
      'minStrike',
      'maxStrike',
      'minStrikePctOfSpot',
      'maxStrikePctOfSpot',
      'strategy',
    ]) {
      expect(properties).toContain(field);
    }
  });

  it('lets every field be null, so an unmentioned setting is left alone', () => {
    const properties = jsonSchemaFor('applySettings').properties ?? {};
    for (const [key, property] of Object.entries(properties)) {
      const type = (property as { type?: unknown }).type;
      expect(Array.isArray(type) && type.includes('null'), `${key} must accept null`).toBe(true);
    }
  });
});

/**
 * The failure this file exists to prevent, in its most recent form: a schema
 * that demands ten fields from a model that sends eight. The provider rejected
 * its own model's call, and the user saw "Tool call validation failed" with no
 * settings applied.
 */
describe('applySettings tolerates a model that sends only what it means', () => {
  it('requires none of its fields', () => {
    const schema = jsonSchemaFor('applySettings');
    expect(schema.required ?? []).toEqual([]);
  });

  it('parses a call carrying only the fields it meant to change', () => {
    // Exactly the call that was rejected: no strike keys at all.
    const parsed = TOOL_PARAMETERS.applySettings.safeParse({
      ticker: 'NVDA',
      capital: 100000,
      minMonths: 6,
      maxMonths: 12,
      delta: 1,
      minStrikePctOfSpot: 115,
    });
    expect(parsed.success).toBe(true);
  });

  it('still parses a call that spells every field out with nulls', () => {
    // The old shape has to keep working: a conversation already in flight may
    // be mid-turn when this ships.
    const parsed = TOOL_PARAMETERS.applySettings.safeParse({
      ticker: 'NVDA',
      capital: null,
      minMonths: null,
      maxMonths: null,
      delta: null,
      minStrike: null,
      maxStrike: null,
      minStrikePctOfSpot: null,
      maxStrikePctOfSpot: null,
      strategy: null,
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * The filter fields, which have now been rejected by the provider in both of
 * the shapes that seemed natural:
 *
 *   - a NULLABLE object → "anyOf disambiguation failed";
 *   - an OPTIONAL object → the model sends `"filter": null` anyway, and the
 *     provider answers "/filter: expected object, but got null".
 *
 * Nullable scalars are the shape that survives both, so the shape is asserted.
 */
describe('the filter travels as flat nullable scalars', () => {
  it('declares no object-typed property', () => {
    const properties = Object.values(jsonSchemaFor('applySettings').properties ?? {});
    for (const property of properties) {
      expect((property as { type?: unknown }).type).not.toBe('object');
    }
  });

  it('accepts a filter alongside the settings', () => {
    const parsed = TOOL_PARAMETERS.applySettings.safeParse({
      ticker: 'AAPL',
      minMonths: 6,
      maxMonths: 12,
      filterField: 'iv',
      filterOp: 'gt',
      filterValue: 40,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts explicit nulls for every filter field, which is what broke', () => {
    // Verbatim the rejected call: a model filling in every key it knows about.
    const parsed = TOOL_PARAMETERS.applySettings.safeParse({
      ticker: 'NVDA',
      capital: 100000,
      minMonths: 6,
      maxMonths: 12,
      delta: 1,
      minStrikePctOfSpot: 115,
      filterField: null,
      filterOp: null,
      filterValue: null,
      filterValueHigh: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('removing a filter is expressible', () => {
  it('accepts a request to drop one column, or all of them', () => {
    for (const args of [{ removeFilterField: 'iv' }, { clearFilters: true }]) {
      expect(TOOL_PARAMETERS.applySettings.safeParse(args).success).toBe(true);
    }
  });

  it('accepts nulls for both, since the model sends every key', () => {
    const parsed = TOOL_PARAMETERS.applySettings.safeParse({
      ticker: 'AAPL',
      clearFilters: null,
      removeFilterField: null,
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * askUser existed in the schemas and in the prompt, and was never added to the
 * object actually sent to the provider. The model read about it, called it, and
 * the request came back "attempted to call tool 'askUser' which was not in
 * request.tools" — a whole category of behaviour broken by a missing line, with
 * nothing at build time to say so.
 */
describe('every tool the model is told about is a tool it is given', () => {
  it('sends exactly the tools that have schemas', () => {
    expect(Object.keys(assistantTools).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('describes every tool it sends', () => {
    for (const [name, tool] of Object.entries(assistantTools)) {
      expect((tool as { description?: string }).description, `${name} has no description`).toBeTruthy();
    }
  });
});
