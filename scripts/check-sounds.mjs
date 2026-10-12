#!/usr/bin/env node
// Every sound pack in every mod is in spec: a WAV per event (done, needs-you, error), mono, 16-bit,
// 22,050 Hz, two seconds at most, and within 1.5 dB of the mod's classic pack in loudness (RMS), so
// no pack startles. Reads the RIFF header and the PCM data itself; no dependencies.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const EVENTS = ['done', 'needs-you', 'error']
const RATE = 22_050
const MAX_SECONDS = 2
const LOUDNESS_DB = 1.5
let problems = 0
const bad = message => {
  console.log(`!! ${message}`)
  problems++
}

function wav(path) {
  const b = readFileSync(path)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return { error: 'not a WAV file' }
  let at = 12
  let fmt
  let data
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4)
    const size = b.readUInt32LE(at + 4)
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) }
    if (id === 'data') data = b.subarray(at + 8, at + 8 + size)
    at += 8 + size + (size % 2)
  }
  if (!fmt || !data) return { error: 'no fmt or data chunk' }
  if (fmt.bits !== 16) return { ...fmt, seconds: NaN, rmsDb: NaN }
  const samples = data.length / 2
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const s = data.readInt16LE(i * 2) / 32768
    sum += s * s
  }
  const rms = Math.sqrt(sum / Math.max(1, samples))
  return { ...fmt, seconds: samples / fmt.channels / fmt.rate, rmsDb: 20 * Math.log10(Math.max(rms, 1e-9)) }
}

for (const mod of readdirSync('mods')) {
  const sounds = join('mods', mod, 'sounds')
  let packs
  try {
    packs = readdirSync(sounds).filter(p => statSync(join(sounds, p)).isDirectory())
  } catch {
    continue
  }
  const specs = {}
  for (const pack of packs) {
    for (const event of EVENTS) {
      const path = join(sounds, pack, `${event}.wav`)
      let spec
      try {
        spec = wav(path)
      } catch {
        bad(`${path}: missing`)
        continue
      }
      if (spec.error) {
        bad(`${path}: ${spec.error}`)
        continue
      }
      if (spec.channels !== 1) bad(`${path}: ${spec.channels} channels, expected mono`)
      if (spec.bits !== 16) bad(`${path}: ${spec.bits}-bit, expected 16`)
      if (spec.rate !== RATE) bad(`${path}: ${spec.rate} Hz, expected ${RATE}`)
      if (!(spec.seconds <= MAX_SECONDS)) bad(`${path}: ${spec.seconds.toFixed(2)} s, over ${MAX_SECONDS} s`)
      specs[`${pack}/${event}`] = spec
    }
  }
  const classic = EVENTS.map(e => specs[`classic/${e}`]).filter(s => s && Number.isFinite(s.rmsDb))
  if (classic.length === 0) continue
  const reference = classic.reduce((sum, s) => sum + s.rmsDb, 0) / classic.length
  for (const [name, spec] of Object.entries(specs)) {
    if (Number.isFinite(spec.rmsDb) && Math.abs(spec.rmsDb - reference) > LOUDNESS_DB) {
      bad(`${sounds}/${name}.wav: ${spec.rmsDb.toFixed(1)} dB RMS, classic is ${reference.toFixed(1)} dB (over ${LOUDNESS_DB} dB apart)`)
    }
  }
  console.log(`${mod}: ${packs.length} pack(s) checked, classic ${reference.toFixed(1)} dB RMS`)
}
if (problems > 0) {
  console.log(`${problems} problem(s)`)
  process.exit(1)
}
console.log('every sound pack is in spec')
