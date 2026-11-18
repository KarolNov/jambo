import { DurableObject } from 'cloudflare:workers'
import { UPLOADS, type UploadStatus } from '../shared/sounds'

/** R2's monthly free tier for Standard storage (developers.cloudflare.com/r2/pricing). */
export const R2_FREE = { bytes: 10e9, classA: 1_000_000, classB: 10_000_000 } as const

/** Class A operations kept back from uploads, so retention can still list and delete. */
const CLASS_A_RESERVE = 0.1

export interface Budget {
  bytes: number
  classA: number
  classB: number
}

/** The budget for a share of the free tier, from `SOUND_BUDGET_PERCENT`. */
export function budgetFor(percent: string | undefined): Budget {
  const share = Math.max(0, Math.min(100, Number(percent) || 0)) / 100
  return {
    bytes: Math.floor(R2_FREE.bytes * share),
    classA: Math.floor(R2_FREE.classA * share),
    classB: Math.floor(R2_FREE.classB * share),
  }
}

/** The billing month a time falls in, as `YYYY-MM` in UTC. */
export const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7)

interface Usage {
  month: string
  bytes: number
  classA: number
  classB: number
}

const USAGE_KEY = 'usage'

/** Gets the app's one quota object. */
export const quota = (env: Env) => env.SoundQuota.getByName('global')

/**
 * The app-wide budget for uploaded sounds, kept by one Durable Object: bytes stored in R2 right now,
 * and this month's R2 writes (Class A: put, list) and reads (Class B: get). Deletes are free.
 * Every R2 call for sounds is counted here first, and refused once its budget is spent.
 */
export class SoundQuota extends DurableObject<Env> {
  private readonly budget = budgetFor(this.env.SOUND_BUDGET_PERCENT)

  private async usage(): Promise<Usage> {
    const month = monthOf(Date.now())
    const saved = await this.ctx.storage.get<Usage>(USAGE_KEY)
    if (!saved) return { month, bytes: 0, classA: 0, classB: 0 }
    // Operations reset each month; stored bytes carry over.
    return saved.month === month ? saved : { month, bytes: saved.bytes, classA: 0, classB: 0 }
  }

  private save(usage: Usage) {
    return this.ctx.storage.put(USAGE_KEY, usage)
  }

  private uploadsFor(u: Usage): UploadStatus['uploads'] {
    if (u.bytes + UPLOADS.maxBytes > this.budget.bytes) return 'storage'
    if (u.classA + 1 > this.budget.classA * (1 - CLASS_A_RESERVE)) return 'writes'
    return 'open'
  }

  /** Whether uploads and downloads are open, and if not, which budget ran out. */
  async status(): Promise<UploadStatus> {
    const u = await this.usage()
    return { uploads: this.uploadsFor(u), reads: u.classB < this.budget.classB ? 'open' : 'reads' }
  }

  /** Claims room for one upload's put. Refused while uploads are paused. */
  async reserveUpload(bytes: number): Promise<UploadStatus['uploads']> {
    const u = await this.usage()
    const verdict = this.uploadsFor(u)
    if (verdict !== 'open') return verdict
    if (u.bytes + bytes > this.budget.bytes) return 'storage'
    await this.save({ ...u, bytes: u.bytes + bytes, classA: u.classA + 1 })
    return 'open'
  }

  /** Gives back stored bytes: an upload deleted, expired, or never stored. */
  async release(bytes: number) {
    const u = await this.usage()
    await this.save({ ...u, bytes: Math.max(0, u.bytes - bytes) })
  }

  /** Counts list calls (Class A). Always allowed: retention must be able to delete. */
  async countLists(n: number) {
    const u = await this.usage()
    await this.save({ ...u, classA: u.classA + n })
  }

  /** Claims one read (Class B). Refused once this month's reads are spent. */
  async read(): Promise<boolean> {
    const u = await this.usage()
    if (u.classB + 1 > this.budget.classB) return false
    await this.save({ ...u, classB: u.classB + 1 })
    return true
  }
}
