const add = (items, item) => [...items, item]

describe('cart', () => {
  test('adds an item', () => {
    expect(add([], 'apple')).toEqual(['apple'])
  })

  test('C-2 keeps the quantity', () => {
    expect(add(['apple'], 'apple')).toHaveLength(2)
  })

  test('rejects a negative quantity', () => {
    expect(() => add([], -1)).toThrow('negative quantity')
  })

  test.skip('syncs with the server', () => {})

  test.todo('applies loyalty points')
})
