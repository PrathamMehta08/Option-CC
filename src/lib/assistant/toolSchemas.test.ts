import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TOOL_PARAMETERS, TOOL_NAMES } from './tools';

/**
 * The tool schemas, checked against what the provider will actually accept.
 *
 * This exact class of bug has now broken the assistant three separate times,
 * each time as a failed turn rather than anything visible at build time:
 *
 *   1. A discriminated union in the filter conditions — "anyOf disambiguation
 *      failed".
 *   2. `.optional()` fields in applySettings — "invalid JSON schema for tool
 *      applySettings: required must list every property".
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

  it.each(TOOL_NAMES)('%s marks every property required', (name) => {
    // Strict validation demands it. Optionality is expressed as a nullable
    // type, never by leaving a key out of `required`.
    const schema = jsonSchemaFor(name);
    const properties = Object.keys(schema.properties ?? {});
    expect([...(schema.required ?? [])].sort()).toEqual([...properties].sort());
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
