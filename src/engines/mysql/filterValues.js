// A table tab's filter values as its SQL mode writes them, read the way the backend's
// filter reads them (commands/mysql/browse.rs: `typed`, `flag`, `unzoned`), so the SQL
// keeps the rows the filter does. A quoted value would not: MySQL reads `flag = 'true'`
// as 0 and compares a DECIMAL with a string as floating point.

const EXACT_NUMBER = /^(tinyint|smallint|mediumint|int|bigint|decimal|bit)\b/
const BOOLEAN = /^tinyint\(1\)( |$)/
const NUMBER = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,3}))?$/
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([+-])(\d{2}):(\d{2}))?$/

// On an exact-number column (TINYINT(1)'s true and false as its 1 and 0), the value as
// plain digits, which MySQL reads as an exact number; null for any other column, or a
// value that isn't a number, which is then quoted.
export function exactNumber(value, dataType = '') {
  if (!EXACT_NUMBER.test(dataType ?? '')) return null
  const flag = BOOLEAN.test(dataType) && { true: '1', false: '0' }[value.trim().toLowerCase()]
  const match = NUMBER.exec(flag || value.trim())
  if (!match || !(match[2] || match[3])) return null
  const [, sign, whole, fraction = '', exponent = '0'] = match
  const digits = whole + fraction
  const point = whole.length + Number(exponent)
  const integer = point <= 0 ? '0' : digits.padEnd(point, '0').slice(0, point).replace(/^0+(?=\d)/, '')
  const decimals = point <= 0 ? '0'.repeat(-point) + digits : digits.slice(point)
  // The most digits a MySQL DECIMAL holds, and the most of them after the point: past
  // those the backend refuses the filter.
  const scale = decimals.replace(/0+$/, '').length
  if (integer.replace(/^0$/, '').length + scale > 65 || scale > 30) return null
  return `${sign}${integer}${decimals ? `.${decimals}` : ''}`
}

// The text a filter matches or compares: a TIMESTAMP's whole date and time, with an
// offset or read in the user's zone, as the UTC MySQL compares it in, since the grid
// shows it in the user's zone; anything else as typed.
export function filterText(value, dataType = '') {
  if (!/^timestamp\b/.test(dataType ?? '')) return value
  return inUtc(value, Number(/\((\d)\)/.exec(dataType)?.[1] ?? 0)) ?? value
}

// `value`, a date and time with an offset (`+05:00`) or else in the user's zone, as UTC
// text with `digits` of the seconds' fraction; null when it isn't a real one.
export function inUtc(value, digits) {
  const match = DATE_TIME.exec(value.trim())
  if (!match) return null
  const [, ...parts] = match
  const [year, month, day, hour, minute, second] = parts.slice(0, 6).map(Number)
  const [fraction = '', sign, offsetHours, offsetMinutes] = parts.slice(6)
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  // Date rolls an impossible date (Feb 30) over into the next month.
  if (new Date(asUtc).toISOString().slice(0, 19) !== `${parts.slice(0, 3).join('-')}T${parts.slice(3, 6).join(':')}`) return null
  const at = sign
    ? asUtc - (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60000
    : new Date(year, month - 1, day, hour, minute, second).getTime()
  const micros = fraction.padEnd(6, '0').slice(0, 6)
  return new Date(at).toISOString().slice(0, 19).replace('T', ' ') + (digits ? `.${micros.slice(0, digits)}` : '')
}
