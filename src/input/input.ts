/** Unified input: keyboard, standard gamepads (PS5 / Xbox) and touch controls.
 *  Gamepad mapping follows the EA FC layout:
 *    Attack: A/Cross pass · B/Circle shoot · Y/Triangle through ball · X/Square cross/lob (hold = lower, harder) · RT/R2 sprint · RB/R1 finesse · LT/L2 shield
 *    Defend: A/Cross contain · B/Circle standing tackle · X/Square slide tackle · LB/L1 switch player
 *    Menus: D-pad / left stick navigate · A select · B back · Start pause */

export class Button {
  down = false; justPressed = false; justReleased = false; heldTime = 0;
  private wasDown = false;
  update(now: boolean, dt: number) {
    this.justPressed = now && !this.wasDown;
    this.justReleased = !now && this.wasDown;
    if (now) this.heldTime += dt; else if (this.justReleased) { /* keep heldTime for one frame */ } else this.heldTime = 0;
    this.down = now; this.wasDown = now;
  }
  consume() { this.justPressed = false; this.justReleased = false; }
}

export interface Vec2 { x: number; y: number; }
export type NavEvent = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back' | 'pause';

const KEYS = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'], pass: ['Space', 'KeyJ'], shoot: ['KeyZ', 'KeyK'], through: ['KeyC', 'KeyI'], lob: ['KeyX', 'KeyL'],
  switch: ['KeyQ', 'Tab'], slide: ['KeyE', 'KeyU'], finesse: ['KeyR', 'KeyO'], shield: ['KeyF', 'KeyP'], pause: ['Escape', 'KeyP'], curlL: ['KeyQ'], curlR: ['KeyE'],
};
type KeyAction = keyof typeof KEYS;

export class InputManager {
  move: Vec2 = { x: 0, y: 0 };
  aim: Vec2 = { x: 0, y: 0 }; // right stick
  sprint = new Button(); pass = new Button(); shoot = new Button(); through = new Button(); lob = new Button();
  switch = new Button(); slide = new Button(); finesse = new Button(); shield = new Button(); pause = new Button();
  /** Free-kick curl from touch buttons: -1, 0, 1. */
  touchCurl = 0;
  gamepadConnected = false;
  gamepadKind: 'xbox' | 'playstation' | 'generic' = 'generic';
  lastSource: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  menuMode = true;
  private keys = new Set<string>();
  private navListeners = new Set<(e: NavEvent) => void>();
  private navRepeat: Record<string, number> = {};
  private prevPadButtons: boolean[] = [];
  private prevPadAxes = { x: 0, y: 0 };
  private prevKeyNav: Record<string, boolean> = {};
  private touchState = { move: { x: 0, y: 0 }, buttons: {} as Record<string, boolean>, active: false };
  private lastTime = performance.now();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      this.keys.add(e.code); this.lastSource = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (this.menuMode) {
        const map: Record<string, NavEvent> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', Enter: 'accept', Space: 'accept', Escape: 'back', Backspace: 'back' };
        const n = map[e.code]; if (n) { if (!this.prevKeyNav[e.code]) this.emitNav(n); this.prevKeyNav[e.code] = true; }
      }
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.prevKeyNav[e.code] = false; });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => { this.gamepadConnected = true; this.gamepadKind = /playstation|dualsense|dualshock|054c/i.test(e.gamepad.id) ? 'playstation' : /xbox|045e|xinput/i.test(e.gamepad.id) ? 'xbox' : 'generic'; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadConnected = false; });
  }

  onNav(fn: (e: NavEvent) => void) { this.navListeners.add(fn); return () => this.navListeners.delete(fn); }
  private emitNav(e: NavEvent) { for (const l of this.navListeners) l(e); }

  private key(action: KeyAction) { return KEYS[action].some((k) => this.keys.has(k)); }

  setTouchMove(x: number, y: number) { this.touchState.move.x = x; this.touchState.move.y = y; this.touchState.active = true; this.lastSource = 'touch'; }
  setTouchButton(name: string, down: boolean) { this.touchState.buttons[name] = down; this.lastSource = 'touch'; }

  /** Poll inputs once per frame. */
  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000); this.lastTime = now;

    // Keyboard
    let mx = (this.key('right') ? 1 : 0) - (this.key('left') ? 1 : 0);
    let my = (this.key('up') ? 1 : 0) - (this.key('down') ? 1 : 0);
    let sprint = this.key('sprint'), pass = this.key('pass'), shoot = this.key('shoot'), through = this.key('through'), lob = this.key('lob');
    let sw = this.key('switch'), slide = this.key('slide'), finesse = this.key('finesse'), shield = this.key('shield'), pause = this.keys.has('Escape');
    let ax = 0, ay = 0;

    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      this.gamepadConnected = true;
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const gx = dz(pad.axes[0] ?? 0), gy = -dz(pad.axes[1] ?? 0);
      ax = dz(pad.axes[2] ?? 0); ay = -dz(pad.axes[3] ?? 0);
      const b = (i: number) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5;
      const dpx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), dpy = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
      if (Math.abs(gx) + Math.abs(gy) > 0.05 || dpx || dpy || pad.buttons.some((x) => x.pressed)) this.lastSource = 'gamepad';
      mx = mx || gx || dpx; my = my || gy || dpy;
      sprint = sprint || b(7); pass = pass || b(0); shoot = shoot || b(1); through = through || b(3); lob = lob || b(2);
      sw = sw || b(4); finesse = finesse || b(5); shield = shield || b(6); pause = pause || b(9); slide = slide || b(2);
      // Menu navigation from the pad with key repeat.
      if (this.menuMode) {
        const navs: Array<[NavEvent, boolean]> = [['up', gy > 0.6 || b(12)], ['down', gy < -0.6 || b(13)], ['left', gx < -0.6 || b(14)], ['right', gx > 0.6 || b(15)], ['accept', b(0)], ['back', b(1)], ['pause', b(9)]];
        for (const [n, on] of navs) {
          const t = this.navRepeat[n] ?? -1;
          if (on) { if (t < 0) { this.emitNav(n); this.navRepeat[n] = now + 420; } else if (now > t && n !== 'accept' && n !== 'back' && n !== 'pause') { this.emitNav(n); this.navRepeat[n] = now + 140; } }
          else this.navRepeat[n] = -1;
        }
      }
      this.prevPadButtons = pad.buttons.map((x) => x.pressed); this.prevPadAxes = { x: gx, y: gy };
    }

    // Touch
    if (this.touchState.active) {
      const t = this.touchState;
      if (Math.abs(t.move.x) + Math.abs(t.move.y) > 0.02) { mx = t.move.x; my = t.move.y; }
      const tb = t.buttons;
      sprint = sprint || !!tb.sprint; pass = pass || !!tb.pass; shoot = shoot || !!tb.shoot; through = through || !!tb.through; lob = lob || !!tb.lob; sw = sw || !!tb.switch; slide = slide || !!tb.slide; pause = pause || !!tb.pause;
    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my; this.aim.x = ax; this.aim.y = ay;
    this.sprint.update(sprint, dt); this.pass.update(pass, dt); this.shoot.update(shoot, dt); this.through.update(through, dt); this.lob.update(lob, dt);
    this.switch.update(sw, dt); this.slide.update(slide, dt); this.finesse.update(finesse, dt); this.shield.update(shield, dt); this.pause.update(pause, dt);
  }

  buttonLabels() {
    const ps = this.gamepadKind === 'playstation';
    return { pass: ps ? '✕' : 'A', shoot: ps ? '○' : 'B', through: ps ? '△' : 'Y', lob: ps ? '□' : 'X', sprint: ps ? 'R2' : 'RT', switch: ps ? 'L1' : 'LB', finesse: ps ? 'R1' : 'RB' };
  }
}

export const input = new InputManager();
