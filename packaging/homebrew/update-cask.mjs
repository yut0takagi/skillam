#!/usr/bin/env node
//
// Point skillam.rb at a release tag.
//
//   node packaging/homebrew/update-cask.mjs v0.2.1
//   node packaging/homebrew/update-cask.mjs v0.2.1 --check
//
// The checksums come from the `digest` field GitHub reports for each release
// asset, so a release does not have to be re-downloaded (the two .dmg files
// are ~280 MB together) just to fill in the cask. `--check` verifies the
// checked-in cask against a tag without writing, which is what CI or a
// pre-release sanity pass wants.

import { readFile, writeFile } from 'node:fs/promises'

const REPO = 'yut0takagi/skillam'
const CASK_PATH = new URL('./skillam.rb', import.meta.url)

// electron-builder omits the `-${arch}` suffix for the default architecture
// only, which is why the intel asset has no suffix. This table has to stay in
// step with the `arch` stanza in skillam.rb.
const ARCHITECTURES = [
  { key: 'arm', suffix: '-arm64' },
  { key: 'intel', suffix: '' }
]

function usage(message) {
  const lines = [
    message,
    '',
    'usage: node packaging/homebrew/update-cask.mjs <tag> [--check]',
    '',
    '  <tag>     release tag, e.g. v0.2.1',
    '  --check   compare only; exit 1 if skillam.rb does not match the tag'
  ]
  throw new Error(lines.join('\n'))
}

function parseArgs(argv) {
  const check = argv.includes('--check')
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const unknown = argv.filter((arg) => arg.startsWith('--') && arg !== '--check')

  if (unknown.length > 0) usage(`unknown option: ${unknown.join(', ')}`)
  if (positional.length === 0) usage('no release tag given')
  if (positional.length > 1) usage(`expected one release tag, got: ${positional.join(', ')}`)

  const tag = positional[0]
  // The cask's `version` is the tag without the `v`, because the url template
  // re-adds it as `v#{version}`.
  const version = tag.replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    usage(`tag "${tag}" does not look like a version (expected e.g. v0.2.1)`)
  }

  return { tag, version, check }
}

async function fetchRelease(tag) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })

  if (response.status === 404) {
    throw new Error(`no release tagged ${tag} in ${REPO}`)
  }
  if (!response.ok) {
    // Unauthenticated requests are limited to 60/hour, which is the failure
    // most likely to be hit here, so name the fix rather than just the status.
    const hint = response.status === 403 ? ' (rate limited? set GITHUB_TOKEN)' : ''
    throw new Error(`GitHub API returned ${response.status} for ${tag}${hint}`)
  }

  return response.json()
}

function checksumsFrom(release, version) {
  const available = (release.assets ?? []).map((asset) => asset.name)
  const checksums = {}

  for (const { key, suffix } of ARCHITECTURES) {
    const name = `skillam-${version}${suffix}.dmg`
    const asset = (release.assets ?? []).find((candidate) => candidate.name === name)

    if (!asset) {
      throw new Error(
        `release ${release.tag_name} has no asset named ${name}\n` +
          `  assets present: ${available.length > 0 ? available.join(', ') : '(none)'}\n` +
          '  if electron-builder changed its artifact naming, update ARCHITECTURES ' +
          'here and the `arch` stanza in skillam.rb together'
      )
    }

    const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')
    if (!digest) {
      // GitHub only reports digests for assets uploaded after it started
      // recording them. Nothing to fall back to that does not mean pulling
      // down the whole .dmg, so hand the maintainer the local command instead
      // — they still have the build output that produced the release.
      throw new Error(
        `GitHub reports no sha256 digest for ${name}\n` +
          '  compute it from the build output and edit skillam.rb by hand:\n' +
          `    shasum -a 256 apps/desktop/release/${name}`
      )
    }

    checksums[key] = digest[1]
  }

  return checksums
}

// Every field is replaced through a pattern that must match exactly once. A
// pattern that stops matching means the cask was reshaped — most likely by the
// universal build collapsing the two checksums into one — and this script
// should say so rather than quietly write a file it no longer understands.
function replaceExactlyOnce(source, pattern, describe, value) {
  const matches = source.match(new RegExp(pattern.source, `${pattern.flags}g`)) ?? []
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one ${describe} line in skillam.rb, found ${matches.length}` +
        ' — the cask no longer has the shape this script edits'
    )
  }
  return source.replace(pattern, (_match, before, after) => `${before}${value}${after}`)
}

const FIELDS = [
  { describe: 'version', pattern: /^(\s*version\s+")[^"]*(")$/m, of: ({ version }) => version },
  {
    describe: 'arm sha256',
    pattern: /^(\s*sha256\s+arm:\s+")[0-9a-f]{64}(")/m,
    of: ({ checksums }) => checksums.arm
  },
  {
    describe: 'intel sha256',
    pattern: /^(\s*intel:\s+")[0-9a-f]{64}(")/m,
    of: ({ checksums }) => checksums.intel
  }
]

function currentValues(source) {
  return FIELDS.map((field) => {
    const match = field.pattern.exec(source)
    // `before` ends with the opening quote, so the captured value sits between
    // the two groups; re-run without the anchors to read it out.
    const value = match ? /"([^"]*)"/.exec(match[0].slice(match[1].length - 1))?.[1] : undefined
    return { describe: field.describe, value }
  })
}

async function main() {
  const { tag, version, check } = parseArgs(process.argv.slice(2))
  const release = await fetchRelease(tag)
  const checksums = checksumsFrom(release, version)

  const source = await readFile(CASK_PATH, 'utf-8')
  const updated = FIELDS.reduce(
    (text, field) =>
      replaceExactlyOnce(text, field.pattern, field.describe, field.of({ version, checksums })),
    source
  )

  if (check) {
    if (updated === source) {
      console.log(`skillam.rb matches ${tag}`)
      return
    }

    const before = currentValues(source)
    const after = currentValues(updated)
    console.error(`skillam.rb does not match ${tag}:`)
    before.forEach(({ describe, value }, index) => {
      const expected = after[index].value
      if (value !== expected) console.error(`  ${describe}: ${value} -> ${expected}`)
    })
    process.exitCode = 1
    return
  }

  if (updated === source) {
    console.log(`skillam.rb already points at ${tag}; nothing to do`)
    return
  }

  await writeFile(CASK_PATH, updated)
  console.log(`skillam.rb -> ${tag}`)
  currentValues(updated).forEach(({ describe, value }) => {
    console.log(`  ${describe}: ${value}`)
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
