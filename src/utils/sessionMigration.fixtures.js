// Fixtures for the session migration (Work 7A). Legacy records are shaped exactly
// as the v1 session service projected them; each expected v2 record pins both the
// migration output and the definitions' serialize hooks (7B), so changing either
// without updating the fixtures fails loudly.

const CONN_REF = (db, coll) => ({
  connectionId: 'c1',
  segments: [
    ...(db ? [{ kind: 'database', name: db }] : []),
    ...(coll ? [{ kind: 'collection', name: coll }] : []),
  ],
})

export const legacy = {
  find: {
    id: 'w-find', kind: 'collection', title: 'orders', color: '#f00',
    connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
    filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ _id: 0 }',
    skip: 3, limit: 25, mode: 'find', pipeline: '', vqb: { rows: [{ a: 1 }] },
    readOnly: true, colOrder: { a: 0, _id: 1 },
  },
  aggregate: {
    id: 'w-agg', kind: 'collection', title: 'orders', color: null,
    connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
    filter: '', sort: '', projection: '', skip: 0, limit: 50,
    mode: 'aggregate', pipeline: '[\n  { "$match": { "a": 1 } }\n]',
    vqb: null, readOnly: false, colOrder: null,
  },
  sql: {
    id: 'w-sql', kind: 'collection', title: 'SQL: orders', color: '#0f0',
    connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
    mode: 'sql', sql: 'SELECT *\nFROM orders', readOnly: false, colOrder: null,
  },
  shell: {
    id: 'w-shell', kind: 'shell', title: 'mongosh: shop', color: null,
    connectionId: 'c1', connectionName: 'Sales', dbName: 'shop',
    code: 'db.orders.find({ a: 1 })', scriptPath: null,
  },
  indexes: {
    id: 'w-idx', kind: 'indexes', title: 'Index Manager: orders', color: null,
    connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
  },
  schema: {
    id: 'w-schema', kind: 'schema', title: 'Schema: orders', color: null,
    connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
  },
  search: {
    id: 'w-search', kind: 'search', title: 'Search: shop', color: null,
    connId: 'c1', connName: 'Sales', dbName: 'shop',
  },
  importCsv: {
    id: 'w-csv', kind: 'import', title: 'Import: orders', color: null,
    connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
    format: 'csv', sourceType: 'file', filePath: '/tmp/a.csv',
    csv: { delimiter: ';', other: '', qualifier: '"', skipLines: 1, hasHeader: true },
    targetDb: 'shop', targetColl: 'orders', mode: 'upsert',
  },
  importJson: {
    id: 'w-json', kind: 'import', title: 'Import: orders', color: null,
    connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
    format: 'json', validate: true,
    sources: [{ path: '/a.json', name: 'a', targetDb: 'shop', targetColl: 'orders', mode: 'insert' }],
  },
  export: {
    id: 'w-export', kind: 'export', title: 'Export: orders (query)', color: null,
    connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
    step: 2, format: 'csv', incremental: true, source: 'query',
    sourceCount: null, filter: '{ status: "open" }',
    fields: [{ source: 'a', target: 'b', kind: 'string', include: true }],
  },
  currentOps: {
    id: 'w-ops', kind: 'currentOps', title: 'Current Operations: Sales', color: null,
    connId: 'c1', connName: 'Sales',
    frequency: 500, retention: 30_000, ownOnly: true, showSys: true,
    slowOnly: true, slowSecs: 7, dbName: 'shop', collName: 'orders', view: 'text',
  },
}

export const expected = {
  find: {
    id: 'w-find', type: 'mongodb.find', engine: 'mongodb', title: 'orders', color: '#f00',
    target: CONN_REF('shop', 'orders'),
    state: {
      filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ _id: 0 }',
      skip: 3, limit: 25, pipeline: '', vqb: { rows: [{ a: 1 }] },
      readOnly: true, colOrder: { a: 0, _id: 1 },
    },
  },
  aggregate: {
    id: 'w-agg', type: 'mongodb.aggregate', engine: 'mongodb', title: 'orders', color: null,
    target: CONN_REF('shop', 'orders'),
    state: {
      filter: '', sort: '', projection: '', skip: 0, limit: 50,
      pipeline: '[\n  { "$match": { "a": 1 } }\n]',
      vqb: null, readOnly: false, colOrder: null,
    },
  },
  sql: {
    id: 'w-sql', type: 'mongodb.sql_to_mql', engine: 'mongodb', title: 'SQL: orders', color: '#0f0',
    target: CONN_REF('shop', 'orders'),
    state: { sql: 'SELECT *\nFROM orders', readOnly: false, colOrder: null },
  },
  shell: {
    id: 'w-shell', type: 'mongodb.shell', engine: 'mongodb', title: 'mongosh: shop', color: null,
    target: CONN_REF('shop', null),
    state: { code: 'db.orders.find({ a: 1 })', scriptPath: null },
  },
  indexes: {
    id: 'w-idx', type: 'mongodb.indexes', engine: 'mongodb', title: 'Index Manager: orders', color: null,
    target: CONN_REF('shop', 'orders'), state: {},
  },
  schema: {
    id: 'w-schema', type: 'mongodb.schema', engine: 'mongodb', title: 'Schema: orders', color: null,
    target: CONN_REF('shop', 'orders'), state: {},
  },
  search: {
    id: 'w-search', type: 'mongodb.search', engine: 'mongodb', title: 'Search: shop', color: null,
    target: CONN_REF('shop', null), state: {},
  },
  importCsv: {
    id: 'w-csv', type: 'mongodb.import', engine: 'mongodb', title: 'Import: orders', color: null,
    target: CONN_REF('shop', 'orders'),
    state: {
      format: 'csv', sourceType: 'file', filePath: '/tmp/a.csv',
      csv: { delimiter: ';', other: '', qualifier: '"', skipLines: 1, hasHeader: true },
      targetDb: 'shop', targetColl: 'orders', mode: 'upsert',
    },
  },
  importJson: {
    id: 'w-json', type: 'mongodb.import', engine: 'mongodb', title: 'Import: orders', color: null,
    target: CONN_REF('shop', 'orders'),
    state: {
      format: 'json', validate: true,
      sources: [{ path: '/a.json', name: 'a', targetDb: 'shop', targetColl: 'orders', mode: 'insert' }],
    },
  },
  export: {
    id: 'w-export', type: 'mongodb.export', engine: 'mongodb', title: 'Export: orders (query)', color: null,
    target: CONN_REF('shop', 'orders'),
    state: {
      step: 2, format: 'csv', incremental: true, source: 'query',
      sourceCount: null, filter: '{ status: "open" }',
      fields: [{ source: 'a', target: 'b', kind: 'string', include: true }],
    },
  },
  currentOps: {
    id: 'w-ops', type: 'mongodb.current_operations', engine: 'mongodb', title: 'Current Operations: Sales', color: null,
    target: CONN_REF(null, null),
    state: {
      frequency: 500, retention: 30_000, ownOnly: true, showSys: true,
      slowOnly: true, slowSecs: 7, dbName: 'shop', collName: 'orders', view: 'text',
    },
  },
}

// Sessions exercising the repair rules and failure policy.
export const sessions = {
  mixedLegacy: {
    activeTabId: 'w-find',
    tabs: [legacy.find, legacy.shell, legacy.indexes, legacy.currentOps],
  },
  runtimeStripping: {
    activeTabId: 'w-find',
    tabs: [{
      ...legacy.find,
      results: [{ x: 1 }], hasRun: true, isRunning: true, runError: 'boom',
      selectedRow: 0, selectedRows: [0], elapsedMs: 12, _restored: true,
    }],
  },
  duplicateIds: {
    activeTabId: 'w-agg',
    tabs: [legacy.find, { ...legacy.aggregate, id: 'w-find' }, legacy.shell, { ...legacy.sql, id: 'w-find' }],
  },
  missingId: {
    activeTabId: 'w-shell',
    tabs: [{ ...legacy.find, id: '' }, { ...legacy.shell, id: 7 }, legacy.export],
  },
  staleActive: {
    activeTabId: 'gone',
    tabs: [legacy.shell, legacy.export],
  },
  deletedConnection: {
    activeTabId: 'w-find',
    tabs: [legacy.find, legacy.export],
  },
  empty: {
    activeTabId: null,
    tabs: [],
  },
  weirdNames: {
    activeTabId: 'w1',
    tabs: [
      { ...legacy.find, id: 'w1', dbName: 'app/data', collectionName: 'orders.v2 半角' },
      { ...legacy.shell, id: 'w2', dbName: 'db.with.dots' },
    ],
  },
  whitespaceText: {
    activeTabId: 'w1',
    tabs: [
      {
        ...legacy.find, id: 'w1',
        filter: '  {\n  "a": 1\n}\n', sort: '', projection: ' ',
      },
    ],
  },
  missingMode: {
    activeTabId: 'w1',
    tabs: [{ ...legacy.find, id: 'w1', mode: undefined }],
  },
  unknownKind: {
    activeTabId: 'w1',
    tabs: [{ id: 'w1', kind: 'hyperdrive', title: 'nope' }],
  },
  unknownMode: {
    activeTabId: 'w1',
    tabs: [{ ...legacy.find, id: 'w1', mode: 'lucene' }],
  },
  missingTarget: {
    activeTabId: 'w1',
    tabs: [{ ...legacy.find, id: 'w1', connectionId: undefined, connectionName: undefined, dbName: undefined, collectionName: undefined }],
  },
  validV2: {
    schemaVersion: 2,
    activeTabId: 'w-find',
    tabs: [expected.find, expected.shell, expected.currentOps],
  },
  validV2Empty: {
    schemaVersion: 2,
    activeTabId: null,
    tabs: [],
  },
  v2DuplicateIds: {
    schemaVersion: 2,
    activeTabId: 'w-find',
    tabs: [expected.find, { ...expected.shell, id: 'w-find' }, expected.export],
  },
  v2UnknownType: {
    schemaVersion: 2,
    activeTabId: 'w-find',
    tabs: [expected.find, { id: 'x', type: 'postgres.select', engine: 'postgres', title: 'x', target: CONN_REF('shop', null), state: {} }],
  },
  v2MalformedRecord: {
    schemaVersion: 2,
    activeTabId: 'w-find',
    tabs: [expected.find, { id: 'y', type: 'mongodb.find', title: 'y' }],
  },
  future: {
    schemaVersion: 3,
    activeTabId: 'w-find',
    tabs: [expected.find],
  },
  invalidVersion: {
    schemaVersion: '2',
    activeTabId: null,
    tabs: [],
  },
  malformedEnvelope: {
    schemaVersion: 2,
    tabs: 'not-an-array',
  },
  notAnObject: [1, 2, 3],
}