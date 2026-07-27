// Human-readable one-line summary of a task's schedule, shown in the Tasks panel.
// Kept as a pure function (schedule object in, string out) so it is unit-testable
// without a component. Mirrors the backend Schedule shape:
//   { kind: 'interval'|'daily'|'weekly', every_minutes, at_hhmm, weekday }
// A task with no schedule is "Manual" (only ever runs when the user clicks Run now).

// Indexed by the backend's `weekday` value, so the order is load-bearing: the
// picker sends the array index straight through as the schedule's weekday.
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function scheduleSummary(schedule) {
  if (!schedule || !schedule.kind) return 'Manual'

  if (schedule.kind === 'interval') {
    const minutes = schedule.every_minutes
    if (!minutes || minutes <= 0) return 'Interval (not set)'
    return `Every ${formatMinutes(minutes)}`
  }

  if (schedule.kind === 'daily') {
    const at = schedule.at_hhmm
    if (!at) return 'Daily (time not set)'
    return `Daily at ${at}`
  }

  if (schedule.kind === 'weekly') {
    const at = schedule.at_hhmm
    const day = WEEKDAYS[schedule.weekday]
    if (day == null || !at) return 'Weekly (not set)'
    return `Weekly on ${day} at ${at}`
  }

  return 'Manual'
}

// Render a minute count as the largest natural unit ("90 minutes" -> "1h 30m",
// "60 minutes" -> "1 hour", "5 minutes" -> "5 minutes").
function formatMinutes(minutes) {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  return `${hours}h ${rest}m`
}
