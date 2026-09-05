import { describe, it, expect } from 'vitest';
import { isLocalEndpoint, providerName } from './model';

/**
 * Switching provider is meant to be three environment variables. These cover
 * the two decisions that derive from the base URL alone: whether a key is
 * needed at all, and what to call the thing in an error message.
 */
describe('recognising a local model server', () => {
  it('knows the addresses a local runtime listens on', () => {
    // Ollama's default, LM Studio's default, and the loopback spellings.
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:1234/v1',
      'http://0.0.0.0:8080/v1',
      'http://[::1]:11434/v1',
      'https://localhost:11434/v1',
    ]) {
      expect(isLocalEndpoint(url)).toBe(true);
    }
  });

  it('does not mistake a hosted provider for a local one', () => {
    for (const url of [
      'https://api.groq.com/openai/v1',
      'https://generativelanguage.googleapis.com/v1beta/openai/',
      'https://openrouter.ai/api/v1',
      'https://api.cerebras.ai/v1',
    ]) {
      expect(isLocalEndpoint(url)).toBe(false);
    }
  });

  it('is not fooled by a hostname that merely contains "localhost"', () => {
    // A key sent to notlocalhost.example.com is a leaked key.
    expect(isLocalEndpoint('https://localhost.evil.example.com/v1')).toBe(false);
    expect(isLocalEndpoint('https://notlocalhost/v1')).toBe(false);
    expect(isLocalEndpoint('https://mylocalhost.io/v1')).toBe(false);
  });
});

describe('naming the provider in an error', () => {
  it('names the ones this app documents', () => {
    expect(providerName('https://api.groq.com/openai/v1')).toBe('Groq');
    expect(providerName('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe(
      'Google Gemini'
    );
    expect(providerName('https://openrouter.ai/api/v1')).toBe('OpenRouter');
    expect(providerName('https://api.cerebras.ai/v1')).toBe('Cerebras');
  });

  it('says something useful about a local server', () => {
    expect(providerName('http://localhost:11434/v1')).toMatch(/local/i);
  });

  it('falls back to the host for anything else, rather than guessing', () => {
    expect(providerName('https://api.example.com/v1')).toBe('example.com');
  });

  it('never throws on a malformed URL, since it only ever formats a message', () => {
    expect(() => providerName('not a url')).not.toThrow();
    expect(providerName('not a url').length).toBeGreaterThan(0);
  });
});
