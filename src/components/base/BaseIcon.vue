<script setup>
const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 18 },
})

const PATHS = {
  connect:    '<path d="M5 9V5h4M19 15v4h-4" /><rect x="3" y="9" width="8" height="6" rx="1.4"/><rect x="13" y="9" width="8" height="6" rx="1.4"/><path d="M11 12h2"/>',
  collection: '<rect x="4" y="4" width="16" height="16" rx="1.6"/><path d="M4 9h16M4 14h16M9 4v16"/>',
  shell:      '<rect x="3" y="4.5" width="18" height="15" rx="1.8"/><path d="M7 10l3 2-3 2M13 14h4"/>',
  sql:        '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12v5.4c0 1.5 3.1 2.8 7 2.8"/>',
  aggregate:  '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.6 7.6 11 15.2M16.4 7.6 13 15.2"/>',
  search:     '<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-4.6-4.6"/>',
  schema:     '<circle cx="12" cy="12" r="8"/><path d="M12 4v8l5.6 3.2"/>',
  export:     '<ellipse cx="9" cy="6" rx="6" ry="2.4"/><path d="M3 6v7c0 1.3 2.7 2.4 6 2.4"/><path d="M16 9v8M16 9l-3 3M16 9l3 3" transform="translate(0 -1)"/>',
  import:     '<ellipse cx="9" cy="6" rx="6" ry="2.4"/><path d="M3 6v7c0 1.3 2.7 2.4 6 2.4"/><path d="M16 17V9M16 17l-3-3M16 17l3-3" transform="translate(0 -1)"/>',
  mask:       '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7.5 10v4M7.5 10l3 4M7.5 14l3-4M14 10v4M14 10l3 4M14 14l3-4" stroke-width="1.2"/>',
  caret:      '<path d="M9 6l6 6-6 6"/>',
  caretDown:  '<path d="M6 9l6 6 6-6"/>',
  dbSmall:    '<ellipse cx="12" cy="6" rx="6.5" ry="2.5"/><path d="M5.5 6v12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V6"/><path d="M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"/>',
  collSmall:  '<rect x="4" y="4" width="16" height="16" rx="1.4"/><path d="M4 9h16M9 9v11"/>',
  folder:     '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  replica:    '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><path d="M11 8h2"/>',
  run:        '<path d="M7 5l11 7-11 7z"/>',
  save:       '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 15h8"/>',
  load:       '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  history:    '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.5 2"/>',
  anchor:     '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 13a7 7 0 0 0 14 0M5 13H3m16 0h2"/>',
  copy:       '<rect x="8" y="8" width="12" height="12" rx="1.6"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  paste:      '<rect x="6" y="5" width="12" height="15" rx="1.4"/><rect x="9" y="3" width="6" height="3.2" rx="1"/>',
  refresh:    '<path d="M20 11a8 8 0 1 0-1.5 5"/><path d="M20 5v6h-6"/>',
  first:      '<path d="M18 6l-7 6 7 6zM6 6v12" />',
  prev:       '<path d="M15 6l-7 6 7 6z"/>',
  next:       '<path d="M9 6l7 6-7 6z"/>',
  last:       '<path d="M6 6l7 6-7 6zM18 6v12"/>',
  lock:       '<rect x="5" y="11" width="14" height="9" rx="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  plus:       '<path d="M12 5v14M5 12h14"/>',
  trash:      '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  duplicate:  '<rect x="8" y="8" width="12" height="12" rx="1.6"/><rect x="4" y="4" width="12" height="12" rx="1.6"/>',
  edit:       '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>',
  newConn:    '<rect x="3" y="9" width="8" height="6" rx="1.4"/><rect x="13" y="9" width="8" height="6" rx="1.4"/><path d="M11 12h2"/><path d="M19 4v4M17 6h4"/>',
  uri:        '<path d="M9 15l6-6M8 9H6a3 3 0 0 0 0 6h2M16 9h2a3 3 0 0 1 0 6h-2"/>',
  filter:     '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
  check:      '<path d="M5 12l4 4 10-10"/>',
  close:      '<path d="M6 6l12 12M18 6 6 18"/>',
  textType:   '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  count:      '<path d="M5 6h3M5 12h3M5 18h3M13 6h6M13 12h6M13 18h6"/>',
  clock:      '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  cog:        '<circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/>',
  expr:       '<path d="M8 5H6a2 2 0 0 0-2 2v3l-2 2 2 2v3a2 2 0 0 0 2 2h2M16 5h2a2 2 0 0 1 2 2v3l2 2-2 2v3a2 2 0 0 1-2 2h-2"/>',
  typeId:     '<rect x="2.5" y="7" width="19" height="10" rx="2.5"/><path d="M7 10.5v3M11 9.5v4M11 13.5h1.8a2 2 0 0 0 0-4H11z"/>',
  typeStr:    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h11M6.5 13.5h6.5"/>',
  typeNum:    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M9.5 8.5l-1.2 7M15 8.5l-1.2 7M7 11h8.5M6.4 13.5h8.5"/>',
  typeDate:   '<rect x="2.5" y="6.5" width="19" height="12.5" rx="2"/><path d="M2.5 10.5h19M8 4.5v3M16 4.5v3"/>',
  typeBool:   '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M8 12l3 3 5-6"/>',
  typeNull:   '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M9 12h6M12 9v6"/>',
  typeObj:    '<path d="M4 6l4 6-4 6M20 6l-4 6 4 6M11 4l2 16"/>',
  eye:        '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  // Bulk Update / Delete dialogs (operate on many documents by query): rows of text
  // — a stack of documents — with a pencil (update) or an X (delete) at the corner.
  updateDialog: '<path d="M4 6h11M4 11h7M4 16h5"/><path d="M18.5 9.5l-6.5 6.5-3 .8.8-3 6.5-6.5a1.55 1.55 0 0 1 2.2 2.2z"/>',
  deleteDialog: '<path d="M4 6h13M4 11h8M4 16h6"/><path d="M14.5 13.5l5 5M19.5 13.5l-5 5"/>',
  eyeOff:     '<path d="M4 4l16 16"/><path d="M9.5 5.4A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6 7.2A17 17 0 0 0 2 12s3.5 7 10 7a9.9 9.9 0 0 0 3-.45"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  info:       '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  // Visual Explain stage glyphs (see ExplainGraph.vue).
  exResult:   '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M8 14h8M8 16.5h5"/>',
  exScan:     '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9 4v16M14 4v16"/>',
  exIndex:    '<path d="M7 4h10v16l-5-3.2L7 20z"/><path d="M10 9.5h4"/>',
  exFetch:    '<path d="M12 3v10M12 13l-4-4M12 13l4-4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  exSort:     '<path d="M4 6h12M4 12h8M4 18h4"/><path d="M18 8v10M18 18l-3-3M18 18l3-3"/>',
  // Aggregation-stage glyphs (see ExplainGraph.vue).
  exGroup:    '<path d="M9 4H6a2 2 0 0 0-2 2v3l-2 3 2 3v3a2 2 0 0 0 2 2h3"/><circle cx="17" cy="12" r="3.2"/>',
  exProject:  '<rect x="4" y="4" width="16" height="16" rx="1.6"/><path d="M9 4v16M12.5 9.5h4.5M12.5 12h4.5M12.5 14.5h2.5"/>',
  exUnwind:   '<path d="M3 12h5"/><path d="M8 12l7-5M8 12l7 5M8 12h9"/>',
  exLookup:   '<rect x="3" y="6" width="10" height="12" rx="1.5"/><rect x="11" y="6" width="10" height="12" rx="1.5"/>',
  exShard:    '<circle cx="6" cy="8" r="2.4"/><circle cx="18" cy="8" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M8 9l3 6M16 9l-3 6M8.3 8h7.4"/>',
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    v-html="PATHS[name] || ''"
  />
</template>
