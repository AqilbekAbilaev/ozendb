// Result page sizes, plus the same list shaped for BaseSelect (numeric value so it matches
// `tab.limit`, string label for display). One source behind both the Preferences dropdown
// and the results-footer picker — they derive from this array, so they cannot drift.
const PAGE_SIZES = [10, 25, 50, 100, 200]

export const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((sz) => ({ value: sz, label: String(sz) }))
