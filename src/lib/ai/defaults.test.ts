import { describe, it, expect, afterEach } from 'vitest'
import { buildSystemPrompt, resolveContextMessageLimit } from './defaults'

const ORIGINAL_ENV = process.env.AI_CONTEXT_MESSAGE_LIMIT

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.AI_CONTEXT_MESSAGE_LIMIT
  else process.env.AI_CONTEXT_MESSAGE_LIMIT = ORIGINAL_ENV
})

describe('resolveContextMessageLimit', () => {
  it('uses the configured DB value when no env ceiling is set', () => {
    delete process.env.AI_CONTEXT_MESSAGE_LIMIT
    expect(resolveContextMessageLimit(50)).toBe(50)
  })

  it('falls back to the default (20) when no value is configured', () => {
    delete process.env.AI_CONTEXT_MESSAGE_LIMIT
    expect(resolveContextMessageLimit(null)).toBe(20)
    expect(resolveContextMessageLimit(undefined)).toBe(20)
    expect(resolveContextMessageLimit(0)).toBe(20)
  })

  it('clamps the configured value down to the env ceiling when set', () => {
    process.env.AI_CONTEXT_MESSAGE_LIMIT = '10'
    expect(resolveContextMessageLimit(50)).toBe(10)
  })

  it('never raises the configured value above it — env is a ceiling, not a floor', () => {
    process.env.AI_CONTEXT_MESSAGE_LIMIT = '80'
    expect(resolveContextMessageLimit(30)).toBe(30)
  })
})

describe('buildSystemPrompt memory block', () => {
  it('includes contact memory entries, labelled as reference data', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'draft',
      memory: ['Preferred language: Spanish', 'VIP since 2024'],
    })
    expect(prompt).toContain('Contact memory')
    expect(prompt).toContain('[1] Preferred language: Spanish')
    expect(prompt).toContain('[2] VIP since 2024')
  })

  it('omits the memory block entirely when there is no memory', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'draft', memory: [] })
    expect(prompt).not.toContain('Contact memory')
  })
})
