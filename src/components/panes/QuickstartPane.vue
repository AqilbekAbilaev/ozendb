<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { listConnections } from '../../engines/mongodb/api/connections'
import { openUrl } from '@tauri-apps/plugin-opener'
import { updateLastAccessed } from '../../appApi/connectionState'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import { formatNow } from '../../utils/format'

// Actions/state come from App.vue's provided `appModals` (the same DI the modals
// use), so the home screen can open the Connection Manager, connect to a
// recent connection, and change the theme without threading props through
// QueryWorkspace. Guarded so the component still renders if provided in isolation.
const app = inject('appModals', null)
const modals   = app?.modals   || {}
const handlers = app?.handlers || {}
const theme = computed(() => app?.prefs?.theme?.value ?? 'dark')

// ── recent connections ─────────────────────────────────────
const recent  = ref([])
const loading = ref(true)

// Match ConnectionManager's timestamp format so an entry opened from here reads the
// same in both places.

// last_accessed is stored as a display string (not ISO), so recency ordering is a
// best-effort parse — good enough for the common case; exact ordering would need the
// backend to store an epoch/ISO timestamp.
onMounted(async () => {
  try {
    const conns = await listConnections()
    recent.value = (conns || [])
      .filter(c => c.last_accessed)
      .sort((a, b) => (Date.parse(b.last_accessed) || 0) - (Date.parse(a.last_accessed) || 0))
      .slice(0, 6)
  } catch (_) {
    recent.value = []
  } finally {
    loading.value = false
  }
})

function subtitle(c) {
  const user = c.username ? c.username + '@' : ''
  const hosts = c.hosts || []
  if (c.connection_type === 'srv' && hosts[0]) return user + hosts[0].host
  if (hosts.length > 1) return user + hosts.length + ' servers'
  if (hosts[0]) return user + hosts[0].host + ':' + hosts[0].port
  return user + 'localhost:27017'
}

async function openRecent(c) {
  try {
    await updateLastAccessed(c.id, formatNow())
  } catch (_) {}
  handlers.onManagerConnect?.(c.id)
}

// ── actions ────────────────────────────────────────────────
function openConnectionManager() { if (modals.openModal) modals.openModal('connectionManager') }
function createConnection()       { openConnectionManager() }  // new-connection form lives inside the manager

function setTheme(value) { handlers.setTheme?.(value) }

// ── help & learning ────────────────────────────────────────
// REPO mirrors App.vue's HELP_REPO; wiki/issues/releases paths match its HELP_URLS.
const SITE = 'https://ozendb.com/'
const REPO = 'https://github.com/AqilbekAbilaev/ozendb'
const helpLinks = [
  ['OzenDB website',       SITE],
  ['Documentation',        `${REPO}/wiki`],
  ['GitHub repository',    REPO],
  ['Report an issue',      `${REPO}/issues`],
  ['Releases & changelog', `${REPO}/releases`],
]
function openLink(url) { openUrl(url).catch(() => handlers.showToast?.('Could not open link')) }
</script>

<template>
  <div class="quickstart">
    <h1>Welcome to OzenDB</h1>
    <p class="lead">The cross-database workspace. MongoDB today — PostgreSQL, MySQL and more on the roadmap.</p>

    <div class="qs-cols">
      <!-- Left column -->
      <div class="qs-col">
        <section class="qs-sec">
          <h2>Recent Connections</h2>
          <div v-if="loading" class="qs-muted">Loading…</div>
          <template v-else>
            <button v-for="c in recent" :key="c.id" class="qs-row" @click="openRecent(c)">
              <BaseIcon name="connect" :size="18" class="qs-row-ic" />
              <span class="qs-row-body">
                <span class="qs-row-title">{{ c.name }} <span class="qs-sub">({{ subtitle(c) }})</span></span>
                <span v-if="c.last_accessed" class="qs-row-desc">Last accessed {{ c.last_accessed }}</span>
              </span>
            </button>
            <div v-if="!recent.length" class="qs-muted">No recent connections yet.</div>
          </template>

          <button class="qs-row action" @click="openConnectionManager">
            <BaseIcon name="connect" :size="18" class="qs-row-ic" />
            <span class="qs-row-title">Open Connection Manager</span>
          </button>
          <button class="qs-row action" @click="createConnection">
            <BaseIcon name="newConn" :size="18" class="qs-row-ic" />
            <span class="qs-row-title">Create a new connection</span>
          </button>
        </section>

        <section class="qs-sec">
          <h2>Quick Options</h2>
          <label class="qs-opt">
            <span>Theme</span>
            <BaseSelect
              :model-value="theme"
              :options="[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]"
              size="sm"
              @update:model-value="setTheme"
            />
          </label>
        </section>
      </div>

      <!-- Right column -->
      <div class="qs-col">
        <section class="qs-sec">
          <h2>Help &amp; Learning</h2>
          <a v-for="[label, url] in helpLinks" :key="url" class="qs-link" @click="openLink(url)">
            <BaseIcon name="info" :size="15" class="qs-link-ic" />
            {{ label }}
          </a>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quickstart { flex: 1; overflow: auto; padding: 44px 56px; }
.quickstart h1 { font-size: 24px; font-weight: 600; margin-bottom: 6px; }
.quickstart .lead { color: var(--text-dim); font-size: 13.5px; margin-bottom: 32px; }

.qs-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 48px;
  max-width: 1000px;
}
.qs-col { display: flex; flex-direction: column; gap: 28px; }

.qs-sec h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 12px;
}
.qs-muted { color: var(--text-dim); font-size: 12.5px; margin-bottom: 10px; }

/* Clickable rows (recent connection + action buttons) */
.qs-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  padding: 11px 14px;
  margin-bottom: 8px;
  color: var(--text);
}
.qs-row:hover { border-color: var(--accent-soft); background: var(--bg-hover); }
.qs-row.action { background: none; }
.qs-row-ic { color: var(--accent); flex: none; }
.qs-row-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.qs-row-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qs-sub { font-weight: 400; color: var(--text-dim); }
.qs-row-desc { font-size: 11.5px; color: var(--text-faint); }

/* Quick Options */
.qs-opt { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-dim); }
.qs-opt > span { min-width: 52px; }

/* Help links */
.qs-link {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--accent);
  padding: 5px 0;
  cursor: pointer;
}
.qs-link:hover { text-decoration: underline; }
.qs-link-ic { color: var(--text-dim); flex: none; }
</style>
