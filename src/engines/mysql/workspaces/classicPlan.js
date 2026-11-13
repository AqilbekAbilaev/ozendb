// The classic EXPLAIN FORMAT=JSON, which MySQL before 8.3 gives, and MariaDB's JSON, which
// has the same shape with a few differences, read into steps of the second version's shape
// for planRows: each an `operation` with its `inputs`, its `estimated_rows` and an
// `estimated_total_cost`. The classic format nests what a query block does with its rows
// (sort, group, join) around the tables it reads, and costs only the reading of each
// table; a step here costs its own work plus its inputs'.
//
// MariaDB's ANALYZE FORMAT=JSON also carries what the run found, as `r_loops`, `r_rows`
// and times in milliseconds. A step with those gets `actual_rows`, `actual_loops` and
// `actual_last_row_ms`, per loop as in the second version, its time being its own plus
// its inputs'. MySQL's classic format never runs, so it has none.

const READS = {
  ALL: 'Table scan', index: 'Index scan', range: 'Index range scan', index_merge: 'Index merge',
  ref: 'Index lookup', ref_or_null: 'Index lookup', eq_ref: 'Single-row index lookup',
  unique_subquery: 'Index lookup', index_subquery: 'Index lookup', fulltext: 'Full-text index search',
  const: 'Constant row', system: 'Constant row',
}

// What a step does with the rows inside it; null passes them on untouched.
const WRAPS = {
  ordering_operation: (o) => (o.using_filesort ? 'Sort' : null),
  filesort: () => 'Sort',
  temporary_table: () => 'Temporary table',
  read_sorted_file: () => null,
  grouping_operation: (o) => (o.using_temporary_table ? 'Aggregate using temporary table' : 'Group aggregate'),
  duplicates_removal: (o) => (o.using_temporary_table ? 'Remove duplicates using temporary table' : 'Remove duplicates'),
  windowing: () => 'Window aggregate',
  buffer_result: () => 'Buffer result',
}

const SUBQUERIES = ['attached_subqueries', 'select_list_subqueries', 'optimized_away_subqueries', 'order_by_subqueries', 'group_by_subqueries', 'having_subqueries']

// `run` is what ANALYZE found for the step, if anything: its loops, its rows per loop and
// its own milliseconds over all of them; `measured` turns it into the step's figures.
const step = (operation, inputs = [], own = 0, rows = null, run = null) => ({
  operation, inputs, estimated_rows: rows, run,
  estimated_total_cost: inputs.reduce((sum, input) => sum + input.estimated_total_cost, own),
})

const ran = (node, rows = null, ms = 0) => (node.r_loops == null ? null : { loops: node.r_loops, rows: rows ?? null, ms: ms ?? 0 })

function measured(node, analyzed) {
  const inputs = node.inputs.map(input => measured(input, analyzed))
  const { run, ...rest } = node
  if (!analyzed) return { ...rest, inputs }
  const total = inputs.reduce((sum, input) => sum + (input.actual_last_row_ms ?? 0) * (input.actual_loops ?? 1), run?.ms ?? 0)
  const loops = run?.loops || 1
  return { ...rest, inputs, actual_rows: run?.rows ?? null, actual_loops: run?.loops ?? 1, actual_last_row_ms: total / loops }
}

// Whether MariaDB ran the statement for this plan, which only ANALYZE FORMAT=JSON adds.
export const analyzedClassic = (plan) => plan.query_optimization != null

// The plan's top-level steps: its query block's, then each subquery the block runs.
export function classicSteps(plan) {
  return block(plan.query_block).map(root => measured(root, analyzedClassic(plan)))
}

function block(node) {
  return [...contents(node), ...subqueries(node)]
}

function contents(node) {
  const wrap = Object.keys(WRAPS).find(key => node[key])
  if (wrap) {
    const label = WRAPS[wrap](node[wrap])
    const inside = node[wrap]
    return label ? [step(label, block(inside), Number(inside.cost_info?.sort_cost ?? 0), null, ran(inside, inside.r_output_rows, inside.r_total_time_ms))] : block(inside)
  }
  if (node.union_result) return [union(node.union_result)]
  if (node.nested_loop) return [step('Nested loop join', node.nested_loop.flatMap(input => joined(input)))]
  if (node.table?.insert || node.table?.replace) {
    return [step(`${node.table.insert ? 'Insert' : 'Replace'} into ${node.table.table_name}`, node.insert_from ? block(node.insert_from) : [])]
  }
  if (node.table) return [table(node.table)]
  if (node.message) return [step(node.message)]
  return []
}

// A join's table, MariaDB's joined through a block buffer included.
function joined(input) {
  const t = input.table ?? input['block-nl-join']?.table
  return t ? [table(t)] : []
}

function union(result) {
  const inputs = result.query_specifications.flatMap(spec => block(spec.query_block))
  return step(result.using_temporary_table ? 'Union materialize with deduplication' : 'Union all', inputs, 0, null, ran(result, result.r_rows))
}

// A table's reading, under the filter its condition applies and the UPDATE or DELETE
// that writes to it. Its subqueries go under the filter, whose condition holds them.
function table(t) {
  if (!t.table_name && t.message) return step(t.message)
  const reading = READS[t.access_type] ?? 'Read'
  const how = t.using_index && reading.startsWith('Index') ? `Covering ${reading.toLowerCase()}` : reading
  const source = t.materialized_from_subquery ?? t.materialized
  const materialized = source ? [step('Materialize', block(source.query_block))] : []
  const subs = subqueries(t)
  const rows = t.rows_examined_per_scan ?? t.rows ?? null
  const cost = t.cost_info ? Number(t.cost_info.read_cost ?? 0) + Number(t.cost_info.eval_cost ?? 0) : Number(t.cost ?? 0)
  const run = ran(t, t.r_rows, (t.r_table_time_ms ?? 0) + (t.r_other_time_ms ?? 0))
  const read = step(`${how} on ${t.table_name}${t.key ? ` using ${t.key}` : ''}`, t.attached_condition ? materialized : [...materialized, ...subs], cost, rows, run)
  const kept = t.attached_condition
    ? step(`Filter: ${t.attached_condition}`, [read, ...subs], 0, rows == null ? null : rows * Number(t.filtered ?? 100) / 100,
      ran(t, t.r_rows == null ? null : t.r_rows * Number(t.r_filtered ?? 100) / 100))
    : read
  if (t.update) return step(`Update ${t.table_name}`, [kept])
  if (t.delete) return step(`Delete from ${t.table_name}`, [kept])
  return kept
}

function subqueries(node) {
  return [...SUBQUERIES.flatMap(key => node[key] ?? []), ...(node.subqueries ?? [])].map(sub => {
    const query = sub.query_block ?? sub.subquery_cache.query_block
    return step(`Select #${query.select_id} (subquery${sub.dependent ? ', dependent' : ''})`, block(query), 0, null, ran(query))
  })
}
