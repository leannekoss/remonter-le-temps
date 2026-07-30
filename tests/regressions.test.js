import test from 'node:test'
import assert from 'node:assert/strict'

import { LAYERS, bboxAround, closeEpochs, loadAllEpochs, loadEpoch } from '../src/lib/ign.js'
import { cancelThenRelease } from '../src/lib/lifecycle.js'
import { MAX_WIDTH_M, geoAt, zoomAt } from '../src/lib/view.js'

test('un zoom bloqué à la borne ne déplace pas le centre', () => {
  const view = { lat: 48.8566, lon: 2.3522, widthM: MAX_WIDTH_M }
  const next = zoomAt(view, 1.6, 700, 875, 680, 40)

  assert.strictEqual(next, view)
})

test('un zoom libre conserve le point sous le curseur', () => {
  const view = { lat: 44.0794, lon: 3.0225, widthM: 2000 }
  const canvas = { width: 1200, height: 800, x: 1110, y: 80 }
  const before = geoAt(view, canvas.width, canvas.height, canvas.x, canvas.y)
  const next = zoomAt(view, 0.6, canvas.width, canvas.height, canvas.x, canvas.y)
  const after = geoAt(next, canvas.width, canvas.height, canvas.x, canvas.y)

  assert.ok(Math.abs(after.lat - before.lat) < 1e-10)
  assert.ok(Math.abs(after.lon - before.lon) < 1e-10)
})

test('closeEpochs ferme seulement les bitmaps qui ne sont plus affichés', () => {
  let fermeA = 0
  let fermeB = 0
  const bitmapA = { close: () => { fermeA++ } }
  const bitmapB = { close: () => { fermeB++ } }

  closeEpochs(
    [{ bitmap: bitmapA }, { bitmap: bitmapA }, { bitmap: bitmapB }],
    [{ bitmap: bitmapB }],
  )

  assert.equal(fermeA, 1)
  assert.equal(fermeB, 0)
})

test('la boucle de dessin est annulée avant la fermeture de ses bitmaps', () => {
  const ordre = []

  cancelThenRelease(
    () => ordre.push('RAF annulé'),
    () => ordre.push('bitmap fermé'),
    [{ bitmap: {} }],
  )

  assert.deepEqual(ordre, ['RAF annulé', 'bitmap fermé'])
})

test('la sonde centrale est réutilisée dans la mosaïque', async () => {
  const originalFetch = globalThis.fetch
  const originalOffscreenCanvas = globalThis.OffscreenCanvas
  const originalCreateImageBitmap = globalThis.createImageBitmap
  let requests = 0

  globalThis.fetch = async () => {
    requests++
    return new Response(new Blob(['tuile'], { type: 'image/png' }), {
      headers: { 'content-type': 'image/png' },
    })
  }
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width
      this.height = height
    }

    getContext() {
      return { drawImage() {} }
    }
  }
  globalThis.createImageBitmap = async () => ({ close() {} })

  try {
    const bbox = bboxAround(44.0794, 3.0225, 2000, 2 / 3)
    const epoch = await loadEpoch(LAYERS[0], bbox, 1400, 933)

    assert.ok(epoch.tuiles > 1)
    assert.equal(requests, epoch.tuiles)
    epoch.bitmap.close()
  } finally {
    globalThis.fetch = originalFetch
    globalThis.OffscreenCanvas = originalOffscreenCanvas
    globalThis.createImageBitmap = originalCreateImageBitmap
  }
})

test('une panne HTTP complète est distinguable d’une absence de couverture', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 500 })

  try {
    const result = await loadAllEpochs({
      lat: 48.8566,
      lon: 2.3522,
      widthM: 600,
      viewWidthM: 300,
      aspect: 1.25,
      pxW: 1400,
      pxH: 1750,
    })

    assert.equal(result.epochs.length, 0)
    assert.equal(result.failed.length, LAYERS.length)
  } finally {
    globalThis.fetch = originalFetch
  }
})
