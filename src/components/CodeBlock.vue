<script lang="ts">
import { createHighlighter } from 'shiki'

// Lazily create a single shared highlighter instance across all CodeBlock instances
let sharedHighlighterPromise: ReturnType<typeof createHighlighter> | null = null
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  code: string
  language?: string
}>()

const copied = ref(false)
const highlighted = ref('')
const codeContainer = ref<HTMLElement | null>(null)
const canScroll = ref(false)

let resizeObserver: ResizeObserver | null = null

// ── Per-line copy ─────────────────────────────────────────────────────────
// Languages where per-line copy makes sense (terminal / command-oriented)
const CLI_LANGUAGES = new Set(['bash', 'shell', 'cmd', 'powershell', 'dockerfile'])

const isCliLanguage = computed(() => {
  const lang = (props.language ?? '').toLowerCase()
  return CLI_LANGUAGES.has(lang)
})

/** Strip trailing inline comment from a command line for clean copy. */
function stripLineComment(line: string): string {
  // Strip trailing # comment that is preceded by 2+ spaces (alignment style)
  // Avoid stripping URLs (http://...) or shebangs (#!)
  let result = line.replace(/\s{2,}#(?![!/]).+$/, '').trimEnd()
  // Strip trailing REM comment (CMD style)
  result = result.replace(/\s+REM\s.+$/i, '').trimEnd()
  return result.trim()
}


const copyLineSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="11" height="11"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>`
const checkLineSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" width="11" height="11"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`

function setupLineButtons() {
  if (!codeContainer.value) return

  const lineEls = codeContainer.value.querySelectorAll('.line')
  const rawLines = props.code.split('\n')
  const isCli = isCliLanguage.value

  lineEls.forEach((lineEl, index) => {
    const rawLine = rawLines[index] ?? ''
    const trimmed = rawLine.trim()

    // Always skip empty lines — no point copying nothing
    if (!trimmed) return

    // For CLI languages, skip pure comment/annotation lines (they aren\'t runnable commands)
    if (isCli) {
      if (trimmed.startsWith('#')) return
      if (/^REM\s/i.test(trimmed)) return
    }

    // CLI: strip trailing inline comments for a clean paste into terminal
    // Other languages: copy the line as-is (comment lines are valid code too)
    const copyText = isCli ? stripLineComment(rawLine) : trimmed
    if (!copyText) return

    // Allow absolute positioning of the button inside the line span
    ;(lineEl as HTMLElement).style.position = 'relative'

    const btn = document.createElement('button')
    btn.className = 'line-copy-btn line-copy-btn--labeled'
    btn.setAttribute('aria-label', 'Copy this line')
    btn.innerHTML = `${copyLineSVG}<span>Copy</span>`

    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(copyText)
        btn.innerHTML = `${checkLineSVG}<span>Copied!</span>`
        btn.classList.add('line-copy-btn--copied')
        setTimeout(() => {
          btn.innerHTML = `${copyLineSVG}<span>Copy</span>`
          btn.classList.remove('line-copy-btn--copied')
        }, 2000)
      } catch {
        // clipboard API unavailable
      }
    })

    lineEl.appendChild(btn)
  })
}

function checkScroll() {
  if (!codeContainer.value) return
  const pre = codeContainer.value.querySelector('pre')
  if (!pre) return
  canScroll.value =
    pre.scrollWidth > pre.clientWidth &&
    Math.ceil(pre.scrollLeft) < pre.scrollWidth - pre.clientWidth - 1
}

function cleanupScrollListener() {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  if (!codeContainer.value) return
  const pre = codeContainer.value.querySelector('pre')
  if (pre) {
    pre.removeEventListener('scroll', checkScroll)
  }
}

function setupScrollListener() {
  cleanupScrollListener()
  if (!codeContainer.value) return
  const pre = codeContainer.value.querySelector('pre')
  if (!pre) return

  pre.addEventListener('scroll', checkScroll, { passive: true })

  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(checkScroll)
  }
  resizeObserver.observe(pre)

  checkScroll()
}

// ── Selection detection: hide per-line buttons while user is manually selecting ──
const hasSelection = ref(false)

function onSelectionChange() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !codeContainer.value) {
    hasSelection.value = false
    return
  }
  // Only suppress buttons if the selection is inside this specific code block
  const range = sel.getRangeAt(0)
  hasSelection.value = codeContainer.value.contains(range.commonAncestorContainer)
}

onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange)
})

onBeforeUnmount(() => {
  cleanupScrollListener()
  document.removeEventListener('selectionchange', onSelectionChange)
})

function getHighlighter() {
  if (!sharedHighlighterPromise) {
    sharedHighlighterPromise = createHighlighter({
      themes: ['one-dark-pro'],
      langs: [],
    })
  }
  return sharedHighlighterPromise
}

async function highlight() {
  const langRaw = props.language ?? 'text'
  // map databases to sql
  let lang = ['mysql', 'postgresql', 'postgres'].includes(langRaw) ? 'sql' : langRaw
  if (lang === 'c++') lang = 'cpp'
  if (lang === 'cmd') lang = 'shell'
  const supported = [
    'html',
    'css',
    'javascript',
    'php',
    'sql',
    'vue',
    'bash',
    'shell',
    'json',
    'blade',
    'python',
    'typescript',
    'tsx',
    'jsx',
    'csharp',
    'java',
    'cpp',
    'yaml',
    'properties',
    'dockerfile',
    'docker',
    'c',
    'go',
    'kotlin',
    'rust',
    'lua',
    'dart',
    'ruby',
    'swift',
    'powershell',
    'cmd',
  ]

  if (!supported.includes(lang)) {
    highlighted.value = `<pre class="shiki-fallback"><code>${props.code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
    await nextTick()
    setupScrollListener()
    // No .line spans in fallback, skip per-line buttons
    return
  }

  const hl = await getHighlighter()

  if (!hl.getLoadedLanguages().includes(lang)) {
    await hl.loadLanguage(lang as import('shiki').BundledLanguage)
  }

  highlighted.value = hl.codeToHtml(props.code, {
    lang,
    theme: 'one-dark-pro',
  })

  await nextTick()
  setupScrollListener()
  setupLineButtons()
}

watch(() => [props.code, props.language], highlight, { immediate: true })

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // clipboard API not available
  }
}
</script>

<template>
  <div class="relative group my-4">
    <!-- Language badge + copy button -->
    <div
      class="flex items-center justify-between px-3 py-1.5 bg-neutral-gray/60 border border-neutral-gray rounded-t-md"
    >
      <span class="text-xs text-neutral-500 font-base uppercase tracking-wider">
        {{ language ?? 'code' }}
      </span>
      <button
        @click="copy"
        class="text-xs text-neutral-500 hover:text-primary-lightgreen transition-colors flex items-center gap-1 cursor-pointer"
        :title="copied ? 'Copied!' : 'Copy code'"
      >
        <svg
          v-if="!copied"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-3.5 h-3.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
          />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-3.5 h-3.5 text-primary-lightgreen"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        <span>{{ copied ? 'Copied!' : 'Copy' }}</span>
      </button>
    </div>

    <!-- Loading skeleton -->
    <div v-if="!highlighted" class="shiki-skeleton">
      <div class="animate-pulse flex flex-col gap-3">
        <div class="h-3.5 bg-neutral-gray/30 rounded-full w-3/4"></div>
        <div class="h-3.5 bg-neutral-gray/30 rounded-full w-1/2"></div>
        <div class="h-3.5 bg-neutral-gray/30 rounded-full w-5/6"></div>
        <div class="h-3.5 bg-neutral-gray/30 rounded-full w-2/3"></div>
      </div>
    </div>

    <!-- Highlighted code block -->
    <div v-else class="shiki-wrapper relative" ref="codeContainer" :class="{ 'is-selecting': hasSelection }">
      <div v-html="highlighted" />

      <!-- Scroll Indicator -->
      <div
        class="absolute right-0 top-0 bottom-0 w-12 pointer-events-none bg-linear-to-l from-[#0d0d0f] to-transparent flex items-center justify-end pr-2 opacity-0 transition-opacity duration-300 md:hidden"
        :class="{ 'opacity-100': canScroll }"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-5 h-5 text-neutral-400 animate-pulse"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shiki-skeleton {
  margin: 0;
  padding: 1.5rem 1.25rem;
  background-color: #0d0d0f;
  border: 1px solid var(--color-neutral-gray, #2a2a2a);
  border-top: none;
  border-radius: 0 0 0.375rem 0.375rem;
  min-height: 8rem;
}
.shiki-wrapper :deep(pre) {
  margin: 0;
  padding: 1rem;
  border: 1px solid var(--color-neutral-gray, #2a2a2a);
  border-top: none;
  border-radius: 0 0 0.375rem 0.375rem;
  overflow-x: auto;
  font-size: 0.875rem;
  line-height: 1.625;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

/* Ensure shiki's background doesn't override our dark bg */
.shiki-wrapper :deep(.shiki) {
  background-color: #0d0d0f !important;
}

/* Neutralise the global .line border utility — Shiki uses this class for each line span */
.shiki-wrapper :deep(.line) {
  border: none;
  display: block; /* stretch to full pre width so per-line copy button anchors to the right edge */
}

.shiki-wrapper :deep(.line:hover) {
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 0.2rem;
}

/* While user is manually selecting text, get out of the way */
.shiki-wrapper.is-selecting :deep(.line:hover) {
  background-color: transparent;
}
.shiki-wrapper.is-selecting :deep(.line-copy-btn) {
  opacity: 0 !important;
  pointer-events: none;
}

/* ── Per-line copy buttons ─────────────────────────────────────────────── */
.shiki-wrapper :deep(.line-copy-btn) {
  position: absolute;
  right: 0.4rem;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  padding: 0;
  border: none;
  border-radius: 0.2rem;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
  outline: none;
  pointer-events: auto;
}

/* Labeled variant: icon + text badge */
.shiki-wrapper :deep(.line-copy-btn--labeled) {
  width: auto;
  height: 1.35rem;
  padding: 0 0.35rem;
  gap: 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.6rem;
  font-family: 'Inter', sans-serif;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
  background: rgba(13, 13, 15, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(4px);
}

/* Force SVG to block so flex align-items: center works correctly */
.shiki-wrapper :deep(.line-copy-btn svg) {
  display: block;
  flex-shrink: 0;
}

.shiki-wrapper :deep(.line:hover .line-copy-btn) {
  opacity: 1;
}

.shiki-wrapper :deep(.line-copy-btn:hover),
.shiki-wrapper :deep(.line-copy-btn:focus-visible) {
  color: #008170;
  background-color: rgba(0, 129, 112, 0.12);
}

.shiki-wrapper :deep(.line-copy-btn--labeled:hover),
.shiki-wrapper :deep(.line-copy-btn--labeled:focus-visible) {
  background-color: rgba(0, 129, 112, 0.15);
  border-color: rgba(0, 129, 112, 0.3);
}

.shiki-wrapper :deep(.line-copy-btn--copied) {
  color: #008170 !important;
  opacity: 1 !important;
}

.shiki-fallback {
  margin: 0;
  padding: 1rem;
  background-color: #0d0d0f;
  border: 1px solid var(--color-neutral-gray, #2a2a2a);
  border-top: none;
  border-radius: 0 0 0.375rem 0.375rem;
  overflow-x: auto;
  font-size: 0.875rem;
  line-height: 1.625;
  color: #e5e5e5;
}
</style>
