// The classic EXPLAIN FORMAT=JSON, which MySQL before 8.3 gives, read into steps of the
// second version's shape for planRows: each an `operation` with its `inputs`, its
// `estimated_rows` and an `estimated_total_cost`. The classic format nests what a query
// block does with its rows (sort, group, join) around the tables it reads, and costs
// only the reading of each table; a step here costs its own work plus its inputs'.

const READS = {
  ALL: 'Table scan', index: 'Index scan', range: 'Index range scan', index_merge: 'Index merge',
  ref: 'Index lookup', ref_or_null: 'Index lookup', eq_ref: 'Single-row index lookup',
  unique_subquery: 'Index lookup', index_subquery: 'Index lookup', fulltext: 'Full-text index search',
  const: 'Constant row', system: 'Constant row',
}

// What a step does with the rows inside it; null passes them on untouched.
const WRAPS = {
  ordering_operation: (o) => (o.using_filesort ? 'Sort' : null),
  grouping_operation: (o) => (o.using_temporary_table ? 'Aggregate using temporary table' : 'Group aggregate'),
  duplicates_removal: (o) => (o.using_temporary_table ? 'Remove duplicates using temporary table' : 'Remove duplicates'),
  windowing: () => 'Window aggregate',
  buffer_result: () => 'Buffer result',
}

const SUBQUERIES = ['attached_subqueries', 'select_list_subqueries', 'optimized_away_subqueries', 'order_by_subqueries', 'group_by_subqueries', 'having_subqueries']

const step = (operation, inputs = [], own = 0, rows = null) => ({
  operation, inputs, estimated_rows: rows,
  estimated_total_cost: inputs.reduce((sum, input) => sum + input.estimated_total_cost, own),
})

// The plan's top-level steps: its query block's, then each subquery the block runs.
export function classicSteps(plan) {
  return block(plan.query_block)
}

function block(node) {
  return [...contents(node), ...subqueries(node)]
}

function contents(node) {
  const wrap = Object.keys(WRAPS).find(key => node[key])
  if (wrap) {
    const label = WRAPS[wrap](node[wrap])
    return label ? [step(label, block(node[wrap]), Number(node[wrap].cost_info?.sort_cost ?? 0))] : block(node[wrap])
  }
  if (node.union_result) return [union(node.union_result)]
  if (node.nested_loop) return [step('Nested loop join', node.nested_loop.map(input => table(input.table)))]
  if (node.table?.insert || node.table?.replace) {
    return [step(`${node.table.insert ? 'Insert' : 'Replace'} into ${node.table.table_name}`, node.insert_from ? block(node.insert_from) : [])]
  }
  if (node.table) return [table(node.table)]
  if (node.message) return [step(node.message)]
  return []
}

function union(result) {
  const inputs = result.query_specifications.flatMap(spec => block(spec.query_block))
  return step(result.using_temporary_table ? 'Union materialize with deduplication' : 'Union all', inputs)
}

// A table's reading, under the filter its condition applies and the UPDATE or DELETE
// that writes to it. Its subqueries go under the filter, whose condition holds them.
function table(t) {
  const reading = READS[t.access_type] ?? 'Read'
  const how = t.using_index && reading.startsWith('Index') ? `Covering ${reading.toLowerCase()}` : reading
  const materialized = t.materialized_from_subquery ? [step('Materialize', block(t.materialized_from_subquery.query_block))] : []
  const subs = subqueries(t)
  const rows = t.rows_examined_per_scan ?? null
  const cost = Number(t.cost_info?.read_cost ?? 0) + Number(t.cost_info?.eval_cost ?? 0)
  const read = step(`${how} on ${t.table_name}${t.key ? ` using ${t.key}` : ''}`, t.attached_condition ? materialized : [...materialized, ...subs], cost, rows)
  const kept = t.attached_condition
    ? step(`Filter: ${t.attached_condition}`, [read, ...subs], 0, rows == null ? null : rows * Number(t.filtered ?? 100) / 100)
    : read
  if (t.update) return step(`Update ${t.table_name}`, [kept])
  if (t.delete) return step(`Delete from ${t.table_name}`, [kept])
  return kept
}

function subqueries(node) {
  return SUBQUERIES.flatMap(key => node[key] ?? []).map(sub =>
    step(`Select #${sub.query_block.select_id} (subquery${sub.dependent ? ', dependent' : ''})`, block(sub.query_block)))
}
