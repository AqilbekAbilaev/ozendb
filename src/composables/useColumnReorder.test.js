import { describe, it, expect } from 'vitest'
import { computed, reactive } from 'vue'
import { mergeColumnOrder, moveInOrder, findDropIndex, useDrillColumnOrder, swallowNextClick } from './useColumnReorder'

describe('mergeColumnOrder', () => {
  it('returns the derived list unchanged when there is no custom order', () => {
    expect(mergeColumnOrder(['_id', 'a', 'b'], null)).toEqual(['_id', 'a', 'b'])
    expect(mergeColumnOrder(['_id', 'a', 'b'], undefined)).toEqual(['_id', 'a', 'b'])
  })

  it('applies the user order for columns still present', () => {
    expect(mergeColumnOrder(['_id', 'a', 'b'], ['b', '_id', 'a'])).toEqual(['b', '_id', 'a'])
  })

  it('drops columns that no longer exist in the derived list', () => {
    expect(mergeColumnOrder(['_id', 'a'], ['b', '_id', 'a'])).toEqual(['_id', 'a'])
  })

  it('appends newly-appeared columns in their derived position, after the ordered ones', () => {
    expect(mergeColumnOrder(['_id', 'a', 'b', 'c'], ['b', 'a'])).toEqual(['b', 'a', '_id', 'c'])
  })
})

describe('moveInOrder', () => {
  const cols = ['a', 'b', 'c', 'd']

  it('moves a middle column to the front', () => {
    expect(moveInOrder(cols, 'c', 0)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves a column to the end (insertBefore = length)', () => {
    expect(moveInOrder(cols, 'b', cols.length)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('accounts for the index shift when moving left-to-right', () => {
    // remove 'b' -> [a,c,d]; insertBefore 3 means "before d" -> [a,c,b,d]
    expect(moveInOrder(cols, 'b', 3)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('is a no-op when dropping a column onto either side of itself', () => {
    expect(moveInOrder(cols, 'b', 1)).toEqual(cols)
    expect(moveInOrder(cols, 'b', 2)).toEqual(cols)
  })

  it('returns a copy and leaves the input untouched', () => {
    const out = moveInOrder(cols, 'a', 2)
    expect(cols).toEqual(['a', 'b', 'c', 'd'])
    expect(out).not.toBe(cols)
  })

  it('returns an unchanged copy when the column is absent', () => {
    expect(moveInOrder(cols, 'z', 0)).toEqual(cols)
  })
})

describe('findDropIndex', () => {
  // Three 100px columns laid out at x = 0, 100, 200.
  const rects = [
    { index: 0, rect: { left: 0,   right: 100, width: 100 } },
    { index: 1, rect: { left: 100, right: 200, width: 100 } },
    { index: 2, rect: { left: 200, right: 300, width: 100 } },
  ]

  it('returns -1 when there are no columns', () => {
    expect(findDropIndex(50, [])).toBe(-1)
  })

  it('clamps to 0 left of the first column and to length past the last', () => {
    expect(findDropIndex(-20, rects)).toBe(0)
    expect(findDropIndex(999, rects)).toBe(3)
  })

  it('drops before a column on its left half and after on its right half', () => {
    expect(findDropIndex(120, rects)).toBe(1) // left half of column 1
    expect(findDropIndex(180, rects)).toBe(2) // right half of column 1
  })
})

describe('useDrillColumnOrder', () => {
  function setup(path = []) {
    const tab = reactive({})
    const drillPath = reactive(path)
    const order = useDrillColumnOrder({
      activeTab: () => tab, drillPath: () => drillPath, derivedColumns: computed(() => ['_id', 'a', 'b']),
    })
    return { tab, drillPath, ...order }
  }

  it('shows the derived columns until one is moved', () => {
    expect(setup().gridColumns.value).toEqual(['_id', 'a', 'b'])
  })

  it('keeps a moved order on the tab, per drill level', () => {
    const g = setup()
    g.moveColumn('b', 0)
    expect(g.gridColumns.value).toEqual(['b', '_id', 'a'])
    g.drillPath.push('nested')
    expect(g.gridColumns.value).toEqual(['_id', 'a', 'b'])
    expect(g.tab.colOrder).toEqual({ '': ['b', '_id', 'a'] })
  })
})

describe('swallowNextClick', () => {
  const click = () => new Event('click', { cancelable: true })

  it('stops the click a drag ends with, and only that one', () => {
    const target = new EventTarget()
    swallowNextClick(target, () => {})
    const first = click()
    target.dispatchEvent(first)
    expect(first.cancelBubble).toBe(true)
    expect(first.defaultPrevented).toBe(true)
    const second = click()
    target.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
  })

  it('leaves a later click alone when the drag sent none', () => {
    const target = new EventTarget()
    let tick
    swallowNextClick(target, (fn) => { tick = fn })
    tick()
    const later = click()
    target.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
  })
})
