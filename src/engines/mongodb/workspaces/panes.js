// Every MongoDB pane heavy enough to defer: the collection workspace, the shell
// console and Current Operations carry CodeMirror, which would otherwise be parsed on
// every launch (src/startupImports.test.js holds that line); the rest are deferred for
// the same reason — fetched the first time a tab of its kind opens rather than at
// startup. Declared once here, at module scope, so repeated resolution from either
// definition file (queryDefinitions.js, toolDefinitions.js) returns the same component
// identity.
import { defineAsyncComponent } from 'vue'

export const MongoCollectionWorkspace = defineAsyncComponent(() => import('./collection/MongoCollectionWorkspace.vue'))
export const ShellConsole = defineAsyncComponent(() => import('../../../components/app/ShellConsole.vue'))
export const IndexManagerPane = defineAsyncComponent(() => import('../../../components/panes/IndexManagerPane.vue'))
export const SchemaPane = defineAsyncComponent(() => import('../../../components/panes/SchemaPane.vue'))
export const SearchPane = defineAsyncComponent(() => import('../../../components/panes/SearchPane.vue'))
export const CurrentOpsPane = defineAsyncComponent(() => import('../../../components/panes/CurrentOpsPane.vue'))
export const ImportPane = defineAsyncComponent(() => import('../../../components/panes/ImportPane.vue'))
export const CsvImportPane = defineAsyncComponent(() => import('../../../components/panes/CsvImportPane.vue'))
export const ExportPane = defineAsyncComponent(() => import('../../../components/panes/ExportPane.vue'))
