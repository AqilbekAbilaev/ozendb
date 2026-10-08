// Maps a language id to its CodeMirror language extension. JS/EJSON use the JS grammar;
// the rest come from official grammars (@codemirror/lang-php) or the legacy stream modes
// (@codemirror/legacy-modes). Their tokens map to the standard Lezer highlight tags, so
// the shared HighlightStyle in ./theme.js colours every language without extra work.
import { javascript } from '@codemirror/lang-javascript'
import { StreamLanguage } from '@codemirror/language'
import { pgSQL } from '@codemirror/legacy-modes/mode/sql'

// Only the query code generator shows these, and PHP's grammar alone outweighs every
// other language here, so each is fetched the first time it is picked.
const GENERATOR_LANGUAGES = {
  python: () => import('@codemirror/legacy-modes/mode/python').then((m) => StreamLanguage.define(m.python)),
  ruby:   () => import('@codemirror/legacy-modes/mode/ruby').then((m) => StreamLanguage.define(m.ruby)),
  go:     () => import('@codemirror/legacy-modes/mode/go').then((m) => StreamLanguage.define(m.go)),
  java:   () => import('@codemirror/legacy-modes/mode/clike').then((m) => StreamLanguage.define(m.java)),
  csharp: () => import('@codemirror/legacy-modes/mode/clike').then((m) => StreamLanguage.define(m.csharp)),
  php:    () => import('@codemirror/lang-php').then((m) => m.php()),
}

export async function loadLanguage(language) {
  if (GENERATOR_LANGUAGES[language]) return GENERATOR_LANGUAGES[language]()
  if (language === 'sql') return StreamLanguage.define(pgSQL)
  // 'js' (also used for Node.js and the Mongo shell, which are JS syntax) and anything
  // unrecognised fall back to the JS grammar.
  return javascript()
}
