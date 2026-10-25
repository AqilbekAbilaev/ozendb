// Lazy so CodeMirror and the rest stay out of startup (src/startupImports.test.js holds
// that line); declared once so every definition shares one component identity.
import { defineAsyncComponent } from 'vue'

export const MongoCollectionWorkspace = defineAsyncComponent(() => import('./collection/MongoCollectionWorkspace.vue'))
export const ShellConsole = defineAsyncComponent(() => import('../../../components/app/ShellConsole.vue'))
export const IndexManagerPane = defineAsyncComponent(() => import('../panes/IndexManagerPane.vue'))
export const SchemaPane = defineAsyncComponent(() => import('../panes/SchemaPane.vue'))
export const SearchPane = defineAsyncComponent(() => import('../panes/SearchPane.vue'))
export const CurrentOpsPane = defineAsyncComponent(() => import('../panes/CurrentOpsPane.vue'))
export const ImportPane = defineAsyncComponent(() => import('../panes/ImportPane.vue'))
export const CsvImportPane = defineAsyncComponent(() => import('../panes/CsvImportPane.vue'))
export const ExportPane = defineAsyncComponent(() => import('../panes/ExportPane.vue'))
