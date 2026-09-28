// Every shape a PostgreSQL table tab has been saved in, as the v2 session record's
// `state`, with what the tab must ask for once restored. A new saved shape adds a
// fixture here; none is ever removed, since old sessions stay on disk.

const USERS = [
  { name: 'id', dataType: 'integer', isPrimaryKey: true },
  { name: 'name', dataType: 'text', isPrimaryKey: false },
  { name: 'region_id', dataType: 'integer', isPrimaryKey: false },
]
const REGIONS = [
  { name: 'id', dataType: 'integer', isPrimaryKey: true },
  { name: 'name', dataType: 'text', isPrimaryKey: false },
]
export const COLUMNS = { users: USERS, regions: REGIONS }

const DEFAULT_BROWSE = { joins: [], filters: [], orderBy: null, descending: false, limit: 100, offset: 0 }

export const SAVED_TABLE_STATES = [
  {
    name: 'no view (saved before tabs kept their state, or never opened)',
    state: {},
    browse: DEFAULT_BROWSE,
    tab: { mode: 'filter', sql: '', filterText: {}, shownColumns: [] },
  },
  {
    name: 'filters, sort, limit and shown columns',
    state: {
      view: {
        mode: 'filter', sql: '', limit: 25,
        filterText: { name: 'ad', id: '>1' },
        filters: [{ key: 'name', op: 'contains', value: 'ad' }, { key: 'id', op: 'gt', value: '1' }],
        shownColumns: ['name', 'id'], orderBy: 'name', descending: true, joins: [],
      },
    },
    browse: {
      ...DEFAULT_BROWSE, limit: 25, descending: true, orderBy: { table: 0, column: 'name' },
      filters: [{ table: 0, column: 'name', op: 'contains', value: 'ad' }, { table: 0, column: 'id', op: 'gt', value: '1' }],
    },
    tab: { mode: 'filter', sql: '', filterText: { name: 'ad', id: '>1' }, shownColumns: ['name', 'id'] },
  },
  {
    name: 'a join saved as one column / equals pair (before joins took several)',
    state: {
      view: {
        mode: 'filter', sql: '', limit: 100,
        filterText: { 'j1.name': 'no' }, filters: [{ key: 'j1.name', op: 'contains', value: 'no' }],
        shownColumns: [], orderBy: 'j1.name', descending: false,
        joins: [{ key: 'j1', schema: 'public', table: 'regions', kind: 'left', column: 'id', equals: 'region_id', columns: REGIONS }],
      },
    },
    browse: {
      ...DEFAULT_BROWSE, orderBy: { table: 1, column: 'name' },
      joins: [{ schema: 'public', table: 'regions', kind: 'left', on: [{ column: 'id', equals: { table: 0, column: 'region_id' } }] }],
      filters: [{ table: 1, column: 'name', op: 'contains', value: 'no' }],
    },
    tab: { mode: 'filter', sql: '', filterText: { 'j1.name': 'no' }, shownColumns: [] },
  },
  {
    name: 'a join over several column pairs, in SQL mode',
    state: {
      view: {
        mode: 'sql', sql: 'SELECT 1', limit: 100, filterText: {}, filters: [],
        shownColumns: [], orderBy: null, descending: false,
        joins: [{
          key: 'j2', schema: 'public', table: 'regions', kind: 'inner', columns: REGIONS,
          on: [{ column: 'id', equals: 'region_id' }, { column: 'name', equals: 'name' }],
        }],
      },
    },
    browse: {
      ...DEFAULT_BROWSE,
      joins: [{
        schema: 'public', table: 'regions', kind: 'inner',
        on: [{ column: 'id', equals: { table: 0, column: 'region_id' } }, { column: 'name', equals: { table: 0, column: 'name' } }],
      }],
    },
    tab: { mode: 'sql', sql: 'SELECT 1', filterText: {}, shownColumns: [] },
  },
]
