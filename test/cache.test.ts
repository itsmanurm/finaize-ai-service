import { describe, it, expect } from 'vitest';
import { inFlightWrites } from '../src/ai/cache';

describe('Cache Module', () => {
  it('should initialize inFlightWrites as an empty Map', () => {
    expect(inFlightWrites).toBeInstanceOf(Map);
    expect(inFlightWrites.size).toBe(0);
  });
});