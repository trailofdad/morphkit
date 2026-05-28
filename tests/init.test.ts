/**
 * MK-0: Smoke test — verifies Jest + ts-jest are wired correctly.
 */
describe('Morphkit Test Runner', () => {
  it('should be alive', () => {
    expect(true).toBe(true);
  });

  it('should support basic TypeScript types', () => {
    const value: number = 42;
    expect(typeof value).toBe('number');
  });
});
