import { input } from './input';

/** Touch controls for phones and tablets: a floating joystick and four buttons, nothing else.
 *
 *  - Left thumb: the joystick appears where you touch (a faint ring shows where it lives). Push past the inner ring into
 *    the outer one to sprint.
 *  - Right thumb: Shoot, Pass, Through and Cross in an arc around the corner. Defending, they become Tackle, Press (hold
 *    to contain), Switch and Slide.
 *  - The modifiers are a slide of the thumb on the button rather than more buttons: Shoot slid up is a chip, slid
 *    sideways a finesse shot; Through slid up is lofted; Pass slid any way is driven. Double-tap Pass or Through for the
 *    bounce versions, as on a pad.
 *  - Skill moves: swipe anywhere on the open right side of the screen (the right stick, from where the swipe starts).
 *  - Free kicks: two curl buttons appear. */
export class TouchControls {
  el: HTMLElement;
  private joy: HTMLElement; private knob: HTMLElement; private zone: HTMLElement;
  private joyId: number | null = null; private origin = { x: 0, y: 0 };
  private buttons: Record<string, HTMLElement> = {};
  private static readonly R = 46;      // the stick's travel (px)
  private static readonly SPRINT = 66;  // past this, sprint (the outer ring)
  private static readonly SLIDE = 26;   // a slide this far on a button is a modifier
  private labels = {
    attack: { shoot: 'Shoot', pass: 'Pass', through: 'Through', lob: 'Cross' },
    defend: { shoot: 'Tackle', pass: 'Press', through: 'Switch', lob: 'Slide' },
  };

  constructor(private parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="joy-zone"><div class="joy-rest"></div><div class="joy"><b></b><i></i></div></div>
      <div class="skill-zone"></div>
      <div class="tpad">
        <button class="tb shoot" data-b="shoot"><span>Shoot</span><em></em></button>
        <button class="tb pass" data-b="pass"><span>Pass</span><em></em></button>
        <button class="tb through" data-b="through"><span>Through</span><em></em></button>
        <button class="tb lob" data-b="lob"><span>Cross</span><em></em></button>
      </div>
      <div class="tcurl"><button type="button" data-c="-1">◀ Curl</button><button type="button" data-c="1">Curl ▶</button></div>`;
    parent.appendChild(this.el);
    // the joystick (floating), with sprint by pushing into the outer ring
    this.zone = this.el.querySelector('.joy-zone')!; this.joy = this.el.querySelector('.joy')!; this.knob = this.joy.querySelector('i')!;
    this.zone.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return; this.joyId = e.pointerId; this.origin = { x: e.clientX, y: e.clientY };
      this.joy.style.left = `${e.clientX}px`; this.joy.style.top = `${e.clientY}px`; this.joy.classList.add('on'); this.zone.classList.add('active');
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* (not every pointer can be captured) */ } input.setTouchMove(0, 0);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y; const l = Math.hypot(dx, dy);
      const sprint = l > TouchControls.SPRINT; input.setTouchButton('sprint', sprint); this.joy.classList.toggle('sprint', sprint);
      const R = TouchControls.R; const shown = Math.min(l, sprint ? TouchControls.SPRINT : R);
      const ux = l > 0 ? dx / l : 0, uy = l > 0 ? dy / l : 0;
      this.knob.style.transform = `translate(calc(-50% + ${ux * shown}px), calc(-50% + ${uy * shown}px))`;
      if (l > R) { dx = ux * R; dy = uy * R; }
      input.setTouchMove(dx / R, -dy / R);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return; this.joyId = null;
      this.joy.classList.remove('on', 'sprint'); this.zone.classList.remove('active'); this.knob.style.transform = 'translate(-50%, -50%)';
      input.setTouchMove(0, 0); input.setTouchButton('sprint', false);
    };
    this.zone.addEventListener('pointerup', end); this.zone.addEventListener('pointercancel', end);
    // skill moves: a swipe on the open right side
    const sz = this.el.querySelector('.skill-zone') as HTMLElement; let sid: number | null = null; let so = { x: 0, y: 0 };
    sz.addEventListener('pointerdown', (e) => { if (sid !== null) return; sid = e.pointerId; so = { x: e.clientX, y: e.clientY }; try { sz.setPointerCapture(e.pointerId); } catch { /* */ } });
    sz.addEventListener('pointermove', (e) => { if (e.pointerId !== sid) return; const dx = e.clientX - so.x, dy = e.clientY - so.y; const l = Math.hypot(dx, dy); const k = Math.min(1, l / 45) / Math.max(1, l); input.setTouchAim(dx * k, -dy * k); });
    const sEnd = (e: PointerEvent) => { if (e.pointerId !== sid) return; sid = null; input.setTouchAim(0, 0); };
    sz.addEventListener('pointerup', sEnd); sz.addEventListener('pointercancel', sEnd);
    // free kicks: hold a curl button to bend it
    this.curlEl = this.el.querySelector('.tcurl')!;
    for (const c of Array.from(this.curlEl.querySelectorAll<HTMLElement>('button'))) {
      const v = Number(c.dataset.c);
      c.addEventListener('pointerdown', (e) => { e.preventDefault(); c.classList.add('pressed'); input.touchCurl = v; input.lastSource = 'touch'; });
      const up = () => { c.classList.remove('pressed'); if (input.touchCurl === v) input.touchCurl = 0; };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up); c.addEventListener('pointerleave', up);
      c.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    // the four buttons, with the slide-for-a-modifier gesture
    for (const b of Array.from(this.el.querySelectorAll<HTMLElement>('.tb'))) {
      const name = b.dataset.b!; this.buttons[name] = b;
      let pid: number | null = null; let o = { x: 0, y: 0 }; let sent = name;
      const down = (e: PointerEvent) => {
        e.preventDefault(); if (pid !== null) return; pid = e.pointerId; o = { x: e.clientX, y: e.clientY }; try { b.setPointerCapture(e.pointerId); } catch { /* */ }
        sent = this.defending ? (name === 'lob' ? 'slide' : name === 'through' ? 'switch' : name) : name;
        clearTimeout(this.modTimer); this.setMods(false, false);
        b.classList.add('pressed'); input.setTouchButton(sent, true);
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pid || this.defending) return;
        const dx = e.clientX - o.x, dy = e.clientY - o.y; const S = TouchControls.SLIDE;
        const up = -dy > S && -dy > Math.abs(dx), side = Math.abs(dx) > S && Math.abs(dx) >= -dy;
        const loft = (name === 'shoot' || name === 'through') && up;
        const fin = (name === 'shoot' && side) || (name === 'pass' && Math.hypot(dx, dy) > S);
        this.setMods(loft, fin);
        (b.querySelector('em') as HTMLElement).textContent = loft ? (name === 'shoot' ? 'Chip' : 'Lofted') : fin ? (name === 'shoot' ? 'Finesse' : 'Driven') : '';
        b.classList.toggle('mod', loft || fin);
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== pid) return; pid = null;
        b.classList.remove('pressed', 'mod'); (b.querySelector('em') as HTMLElement).textContent = '';
        input.setTouchButton(sent, false);
        // (the modifier stays a moment, so the release that plays the ball still sees it)
        clearTimeout(this.modTimer); this.modTimer = window.setTimeout(() => this.setMods(false, false), 250);
      };
      b.addEventListener('pointerdown', down); b.addEventListener('pointermove', move); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
  private defending = false;
  private curlEl!: HTMLElement; private fkOn = false; private modTimer = 0;
  private setMods(loft: boolean, finesse: boolean) { input.setTouchButton('loft', loft); input.setTouchButton('finesse', finesse); }
  /** Free-kick mode: the curl buttons appear (and the minimap steps aside for them). */
  setFreeKick(on: boolean) {
    if (on === this.fkOn) return; this.fkOn = on;
    this.curlEl.classList.toggle('on', on); this.parent.classList.toggle('fk-on', on);
    if (!on) input.touchCurl = 0;
  }
  setDefending(d: boolean) {
    if (d === this.defending) return; this.defending = d; this.el.classList.toggle('defending', d);
    const labels = d ? this.labels.defend : this.labels.attack;
    for (const [k, v] of Object.entries(labels)) { const s = this.buttons[k]?.querySelector('span'); if (s) s.textContent = v; }
  }
  show(on: boolean) { this.el.classList.toggle('on', on); this.parent.classList.toggle('touch-ui', on); }
  destroy() { this.parent.classList.remove('touch-ui', 'fk-on'); this.el.remove(); }
}
