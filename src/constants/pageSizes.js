// Result page sizes. Shared so the Preferences dropdown can only offer sizes the
// results panel's own picker actually has — if these drift, a saved preference
// lands on a value the panel can't select.
export const PAGE_SIZES = [10, 25, 50, 100, 200]

// Same sizes shaped for BaseSelect (numeric value so it matches `tab.limit`, string
// label for display). Shared by the Preferences dropdown and the results-footer picker
// so neither can offer a size the other lacks.
export const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((sz) => ({ value: sz, label: String(sz) }))
