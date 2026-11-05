import { test, expect } from '@playwright/test'

// Example suite: uses no page, so it runs without browser binaries. Replace it with your own tests.
test.describe('checkout', () => {
  test('applies coupon', () => {
    expect(10 - 2).toBe(8)
  })

  test('rejects expired coupon', () => {
    expect({ code: 'OLD', valid: true }).toEqual({ code: 'OLD', valid: false })
  })

  test('retries a declined card', ({}, testInfo) => {
    expect(testInfo.retry, 'the first attempt fails on purpose').toBeGreaterThan(0)
  })

  test('shows legacy wallet', () => {
    test.skip(true, 'legacy wallet retired')
  })
})
