import { watch, onUnmounted } from 'vue'

// Kinetic ("momentum") scrolling for touchpad swipes: the pane keeps gliding after the fingers
// lift, decelerating under friction, instead of stopping dead. WebKitGTK and WebView2 hand us raw
// wheel deltas with no inertia of their own, so we synthesise the tail ourselves.
//
// macOS needs no platform check to stay out of this: WKWebView already delivers the OS momentum
// phase as a long stream of ever-smaller wheel deltas, so by the time the events stop the tracked
// velocity has decayed far below MIN_SPEED and no glide is started.

const FRICTION    = 0.94  // fraction of velocity kept per 16ms frame
const END_GAP     = 70    // ms of wheel silence that counts as "fingers lifted" / new gesture
const MIN_SPEED   = 0.25  // px/ms below which a gesture won't fling and a glide stops
const MAX_SPEED   = 8     // px/ms cap, so one freak delta can't launch the pane across the doc
const SMOOTHING   = 0.6   // weight of the newest sample in the velocity average
const MIN_SAMPLES = 3     // wheel events a gesture needs before it may fling (a mouse notch is 1)
const MAX_FRAME   = 32    // ms cap per glide step, so a stalled tab doesn't jump on resume

// Rolling velocity estimate in px/ms: blend the newest sample into the previous one and clamp.
export function blendVelocity(prev, delta, dt) {
  const v = prev * (1 - SMOOTHING) + (delta / dt) * SMOOTHING
  return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v))
}

// Friction applied over an arbitrary frame time, normalised to the 16ms FRICTION constant.
export function decay(v, dt) {
  return v * FRICTION ** (dt / 16)
}

// A gesture only flings if it looked like a swipe (several events) and was still moving at the end.
export function shouldFling(samples, vx, vy) {
  return samples >= MIN_SAMPLES && Math.hypot(vx, vy) >= MIN_SPEED
}

// Wire momentum onto one scroll container. Returns a detach function.
export function attachMomentum(el) {
  let vx = 0, vy = 0, samples = 0, lastAt = 0, frameAt = 0
  let raf = null, endTimer = null

  function stopGlide() {
    if (raf !== null) cancelAnimationFrame(raf)
    raf = null
  }

  function glide(now) {
    const dt = Math.min(now - frameAt, MAX_FRAME)
    frameAt = now
    vx = decay(vx, dt)
    vy = decay(vy, dt)
    if (Math.hypot(vx, vy) < MIN_SPEED) return stopGlide()
    const wasLeft = el.scrollLeft
    const wasTop  = el.scrollTop
    el.scrollLeft += vx * dt
    el.scrollTop  += vy * dt
    // Hitting an edge kills that axis, so a vertical fling doesn't grind against the end forever.
    if (el.scrollLeft === wasLeft) vx = 0
    if (el.scrollTop === wasTop) vy = 0
    if (!vx && !vy) return stopGlide()
    raf = requestAnimationFrame(glide)
  }

  function onGestureEnd() {
    endTimer = null
    if (!shouldFling(samples, vx, vy)) return
    frameAt = performance.now()
    raf = requestAnimationFrame(glide)
  }

  function onWheel(e) {
    stopGlide()                    // a new swipe takes over from any glide in progress
    if (e.deltaMode !== 0) return  // line/page deltas come from a mouse wheel, not a touchpad
    const now = e.timeStamp || performance.now()
    const dt  = now - lastAt
    lastAt = now
    if (dt > 0 && dt < END_GAP) {
      vx = blendVelocity(vx, e.deltaX, dt)
      vy = blendVelocity(vy, e.deltaY, dt)
      samples++
    } else {
      vx = 0; vy = 0; samples = 1  // first event of a gesture: no interval to measure yet
    }
    clearTimeout(endTimer)
    endTimer = setTimeout(onGestureEnd, END_GAP)
  }

  function cancel() {
    stopGlide()
    clearTimeout(endTimer)
    endTimer = null
    vx = 0; vy = 0; samples = 0
  }

  el.addEventListener('wheel', onWheel, { passive: true })
  el.addEventListener('pointerdown', cancel)
  el.addEventListener('keydown', cancel)

  return () => {
    cancel()
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('pointerdown', cancel)
    el.removeEventListener('keydown', cancel)
  }
}

// Vue wrapper: follows an element ref, re-attaching when the element is swapped out.
export function useMomentumScroll(elRef) {
  let detach = null
  const stop = () => { detach?.(); detach = null }
  watch(elRef, (el) => {
    stop()
    if (el) detach = attachMomentum(el)
  }, { immediate: true })
  onUnmounted(stop)
}
