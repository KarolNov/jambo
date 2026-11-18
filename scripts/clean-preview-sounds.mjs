#!/usr/bin/env node
/**
 * Deletes uploaded sounds from the preview R2 bucket, e.g. once a PR whose preview stored some
 * has merged. Every preview shares that bucket, so by default this empties it; `--prefix` limits it
 * to one jam (`jams/<slug>/`). Lists what it would delete unless given `--yes`.
 *
 *   pnpm sounds:clean-preview                         # dry run: count and size
 *   pnpm sounds:clean-preview --yes                   # delete everything in the preview bucket
 *   pnpm sounds:clean-preview --prefix jams/funky-otter-k7q2/ --yes
 *
 * It reaches the real bucket through Wrangler's remote bindings, using your `wrangler login`.
 * It only ever touches the bucket bound as SOUND_FILES under `previews` in wrangler.jsonc, and
 * refuses to run against production's bucket.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { getPlatformProxy } from 'wrangler'

const { values } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    prefix: { type: 'string', default: '' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
if (values.help) {
  console.log('Usage: pnpm sounds:clean-preview [--prefix jams/<slug>/] [--yes]')
  process.exit(0)
}

// Read both bucket names from the config, so this can't drift from what the Worker uses.
const config = JSON.parse(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1'),
)
const bucketOf = (block) => block?.r2_buckets?.find((b) => b.binding === 'SOUND_FILES')?.bucket_name
const preview = bucketOf(config.previews)
const production = bucketOf(config)
if (!preview || preview === production) {
  console.error(
    `Refusing: no separate preview bucket (preview: ${preview}, production: ${production})`,
  )
  process.exit(1)
}
if (values.prefix && !/^jams\/[a-z0-9-]+\/$/.test(values.prefix)) {
  console.error('--prefix must look like jams/<slug>/')
  process.exit(1)
}

// A throwaway config with only the preview bucket, bound remotely.
const dir = mkdtempSync(join(tmpdir(), 'jambo-clean-'))
const configPath = join(dir, 'wrangler.json')
writeFileSync(
  configPath,
  JSON.stringify({
    // Remote bindings run through a temporary edge-preview Worker under this name. Keep it fixed:
    // on this account, edge-preview sessions under new names fail with an internal error.
    name: 'jambo-clean-probe',
    compatibility_date: config.compatibility_date,
    r2_buckets: [{ binding: 'BUCKET', bucket_name: preview, remote: true }],
  }),
)

const proxy = await getPlatformProxy({ configPath, persist: false })
try {
  await proxy.env.BUCKET.list().catch((e) => {
    throw new Error(
      `Couldn't reach ${preview} through Wrangler's remote bindings (${e.message}). ` +
        'Check `npx wrangler whoami`, or empty the bucket from the dashboard: R2 > ' +
        `${preview} > select all > Delete.`,
    )
  })
  /** @type {R2Bucket} */
  const bucket = proxy.env.BUCKET
  let cursor
  let count = 0
  let bytes = 0
  do {
    // Only pass options that are set: the remote proxy fails on undefined values and empty objects.
    const options = {
      ...(values.prefix ? { prefix: values.prefix } : {}),
      ...(cursor ? { cursor } : {}),
    }
    const page = await bucket.list(Object.keys(options).length > 0 ? options : undefined)
    const keys = page.objects.map((o) => o.key)
    count += keys.length
    bytes += page.objects.reduce((n, o) => n + o.size, 0)
    if (values.yes && keys.length > 0) await bucket.delete(keys)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  const where = `${preview}${values.prefix ? `/${values.prefix}` : ''}`
  const size = bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1e3)} kB`
  if (values.yes) console.log(`Deleted ${count} sound file(s), ${size}, from ${where}.`)
  else
    console.log(
      `${count} sound file(s), ${size}, in ${where}. Run again with --yes to delete them.`,
    )
} finally {
  await proxy.dispose()
  rmSync(dir, { recursive: true, force: true })
}
