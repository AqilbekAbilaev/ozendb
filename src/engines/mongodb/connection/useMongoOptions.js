import { ref, computed } from 'vue'
import { OPTION_GROUPS, KNOWN_OPTION_KEYS } from '../../../data/connectionOptions.js'

// Options managed by dedicated fields outside the catalog (so they aren't treated as
// "unknown" passthrough below).
const DEDICATED_OPTION_KEYS = ['readPreference']

/**
 * MongoDB's connection options: the Advanced tab's catalog, read preference and OIDC,
 * and the options map they build. Part of one connection editor, so the refs are
 * per-instance.
 *
 * @param {Object|null} editConn - the connection being edited, or null when creating.
 * @param {{ connType: import('vue').Ref, authMode: import('vue').Ref }} form - the two
 *   form fields that decide which options apply.
 */
export function useMongoOptions(editConn, { connType, authMode }) {
  const isEditMode = !!editConn

  // Read preference lives on the Server tab (not Advanced) because it only makes sense
  // for replica sets / sharded / SRV. '' means unset → driver default (primary). Stored
  // in the connection's `options` map like other URI params.
  const readPreference = ref(
    (isEditMode && editConn.options) ? (editConn.options.readPreference ?? '') : ''
  )

  // OIDC (MONGODB-OIDC) workload/machine identity: the driver acquires the token from
  // the cloud environment, so there's no username/password.
  const oidcEnvironment = ref('azure')
  const oidcTokenResource = ref('')
  const oidcNeedsResource = computed(
    () => oidcEnvironment.value === 'azure' || oidcEnvironment.value === 'gcp'
  )

  // In edit mode, recover the OIDC settings from the stored authMechanismProperties
  // string (e.g. "ENVIRONMENT:azure,TOKEN_RESOURCE:api://abc"). Split each pair on its
  // FIRST colon so a resource value containing ':' (like a URL) survives.
  if (isEditMode && editConn.auth_mechanism === 'OIDC' && editConn.options) {
    const amp = editConn.options.authMechanismProperties || ''
    for (const part of amp.split(',')) {
      const idx = part.indexOf(':')
      if (idx === -1) continue
      const key = part.slice(0, idx).trim()
      const value = part.slice(idx + 1).trim()
      if (key === 'ENVIRONMENT') oidcEnvironment.value = value || 'azure'
      if (key === 'TOKEN_RESOURCE') oidcTokenResource.value = value
    }
  }

  // The authMechanismProperties string the driver needs for the selected environment.
  function oidcMechanismProperties() {
    let properties = `ENVIRONMENT:${oidcEnvironment.value}`
    if (oidcNeedsResource.value && oidcTokenResource.value.trim()) {
      properties += `,TOKEN_RESOURCE:${oidcTokenResource.value.trim()}`
    }
    return properties
  }

  // Connection-string options (the Advanced tab). Each catalog key maps to a string
  // value; '' means "unset", so the driver default applies.
  const storedOptions = (isEditMode && editConn.options) ? editConn.options : {}
  const advancedOptions = ref(
    Object.fromEntries(
      KNOWN_OPTION_KEYS.map(key => [
        key,
        storedOptions[key] != null ? String(storedOptions[key]) : '',
      ])
    )
  )

  // Any stored option without a dedicated field (e.g. a key added by a future driver,
  // or hand-edited JSON) is preserved verbatim so saving never drops it.
  const extraOptions = Object.fromEntries(
    Object.entries(storedOptions).filter(
      ([key]) => !KNOWN_OPTION_KEYS.includes(key) && !DEDICATED_OPTION_KEYS.includes(key)
    )
  )

  // Unknown options captured when importing a connection string. Kept reactive so
  // buildOptions carries them through on save — an imported URI never loses a
  // parameter, matching Studio 3T's import.
  const importedExtraOptions = ref({})

  // maxStalenessSeconds / readPreferenceTags are only valid alongside a non-primary
  // read preference; the driver rejects the whole URI otherwise. Standalone has no
  // read preference at all.
  const readPrefActive = computed(() => connType.value !== 'standalone' && !!readPreference.value)

  // Whether a field is shown at all (SRV-only options are hidden for non-SRV).
  function optionVisible(opt) {
    if (opt.srvOnly && connType.value !== 'srv') return false
    return true
  }

  // Whether a visible field is greyed out because its dependency isn't met.
  function optionDisabled(opt) {
    if (opt.needsReadPref && !readPrefActive.value) return true
    return false
  }

  // Assembles the options map sent to the backend: every set, visible, enabled field
  // plus any preserved unknown options. Disabled/hidden/empty are omitted so the built
  // URI only ever carries valid, driver-accepted parameters.
  function buildOptions() {
    const out = { ...extraOptions, ...importedExtraOptions.value }
    for (const group of OPTION_GROUPS) {
      for (const opt of group.options) {
        if (!optionVisible(opt) || optionDisabled(opt)) continue
        const value = advancedOptions.value[opt.key]
        if (value === '' || value == null) continue
        out[opt.key] = String(value)
      }
    }
    // Read preference (Server tab) rides in the same options map.
    if (readPrefActive.value) {
      out.readPreference = readPreference.value
    }
    // OIDC carries its environment/token-resource as authMechanismProperties.
    if (authMode.value === 'OIDC') {
      out.authMechanismProperties = oidcMechanismProperties()
    } else {
      delete out.authMechanismProperties
    }
    return out
  }

  // The Advanced tab has many options, so each category is a collapsible section.
  // `groupSetCount` powers the "n set" badge and the auto-expand default below.
  function groupSetCount(group) {
    let count = 0
    for (const opt of group.options) {
      if (!optionVisible(opt) || optionDisabled(opt)) continue
      const value = advancedOptions.value[opt.key]
      if (value !== '' && value != null) count++
    }
    return count
  }

  // A group starts expanded only if it already holds a set value, so existing
  // configuration is visible without the user expanding everything by hand.
  const openGroups = ref(
    Object.fromEntries(OPTION_GROUPS.map(group => [group.title, groupSetCount(group) > 0]))
  )

  function toggleGroup(title) {
    openGroups.value[title] = !openGroups.value[title]
  }

  // The parts of a parsed connection string these options own.
  function applyParsed(parsed) {
    const set = (field, value) => { if (value !== null) field.value = value }
    set(readPreference, parsed.readPreference)
    set(oidcEnvironment, parsed.oidcEnvironment)
    set(oidcTokenResource, parsed.oidcTokenResource)
    Object.assign(advancedOptions.value, parsed.advancedOptions)
    importedExtraOptions.value = parsed.extraOptions
  }

  return {
    readPreference, oidcEnvironment, oidcTokenResource, oidcNeedsResource,
    advancedOptions, optionVisible, optionDisabled, groupSetCount, openGroups, toggleGroup,
    buildOptions, applyParsed,
  }
}
