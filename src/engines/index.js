// Every engine the app knows, and what shared code needs to know about each (their
// names and badges are display data, in data/connectionOptions.js). Shared code
// asks this table rather than comparing engine names, so adding an engine is a new entry
// and its own folder, not an edit in every file that would otherwise branch on it.
//
// Component-free on purpose: stores and composables read it, and they may not import
// components. An engine's components (connection editor sections, sidebar rows) are in
// engines/ui.js.
import { mongodb } from './mongodb/engine.js'
import { postgresql } from './postgresql/engine.js'

export const ENGINES = Object.freeze({ mongodb, postgresql })

// A connection, tab or tree node saved before engines existed carries none: it is MongoDB.
export const DEFAULT_ENGINE = 'mongodb'

/** The engine of anything carrying an `engine` name (a connection, tab or tree node). */
export function engineOf(source) {
  return ENGINES[source?.engine ?? DEFAULT_ENGINE] ?? ENGINES[DEFAULT_ENGINE]
}
