import { ref, computed } from 'vue'

// To announce new cheatsheets: update `newLangs` and bump `announcementId`
// (bumping re-shows everything for users who already saw the previous one).
// Per user: a "New" mark disappears once that cheatsheet is opened (from the
// home page or by visiting its page directly), and all marks expire
// NEW_DURATION_MS after the user first saw them.
export const newLangs = ['yaml', 'bash', 'vim']
const announcementId = 'new-cheatsheets-2026-11'
const NEW_DURATION_MS = 7 * 24 * 60 * 60 * 1000

const keyPrefix = `syntaxia:${announcementId}`
const dismissedKey = `${keyPrefix}:dismissed`
const firstSeenKey = `${keyPrefix}:firstSeen`
const clickedKey = `${keyPrefix}:clicked`

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable; state lasts for this session only */
  }
}

const readClicked = (): string[] => {
  try {
    const parsed = JSON.parse(readStorage(clickedKey) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let firstSeen = Number(readStorage(firstSeenKey))
if (!firstSeen) {
  firstSeen = Date.now()
  writeStorage(firstSeenKey, String(firstSeen))
}
const isExpired = Date.now() - firstSeen > NEW_DURATION_MS

// Module-level so every component shares the same reactive state.
const clickedLangs = ref<string[]>(readClicked())
const dismissed = ref(readStorage(dismissedKey) === '1')

export function useNewCheatsheets() {
  const isNew = (lang: string) =>
    !isExpired && newLangs.includes(lang) && !clickedLangs.value.includes(lang)

  const showAnnouncement = computed(() => !dismissed.value && newLangs.some((l) => isNew(l)))

  const markSeen = (lang: string) => {
    if (!newLangs.includes(lang) || clickedLangs.value.includes(lang)) return
    clickedLangs.value = [...clickedLangs.value, lang]
    writeStorage(clickedKey, JSON.stringify(clickedLangs.value))
  }

  const dismissAnnouncement = () => {
    dismissed.value = true
    writeStorage(dismissedKey, '1')
  }

  return { isNew, showAnnouncement, markSeen, dismissAnnouncement }
}
