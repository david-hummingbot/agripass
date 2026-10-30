// Audible and haptic scan feedback. The AudioContext must be unlocked by a user gesture first.

let ctx = null;

export function unlockAudio() {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, start, duration, type = 'sine', gain = 0.25) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, ctx.currentTime + start);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration);
}

const PATTERNS = {
    success: { tones: [[880, 0, 0.12], [1320, 0.12, 0.18]], vibrate: [80] },
    warning: { tones: [[520, 0, 0.18, 'triangle'], [520, 0.24, 0.18, 'triangle']], vibrate: [120, 80, 120] },
    error: { tones: [[220, 0, 0.45, 'square', 0.15]], vibrate: [300] },
};

export function signal(kind) {
    const pattern = PATTERNS[kind] || PATTERNS.error;
    if (ctx) pattern.tones.forEach(([f, s, d, t, g]) => tone(f, s, d, t, g));
    navigator.vibrate?.(pattern.vibrate);
}
