import { input } from './input';

/** On-screen joystick + action buttons for phones and tablets. */
export class TouchControls {
  el: HTMLElement;
  private joy: HTMLElement; private knob: HTMLElement; private zone: HTMLElement;
  private joyId: number | null = null; private origin = { x: 0, y: 0 };
  private buttons: Record<string, HTMLElement> = {};
  private labelsAttack = { pass: 'Pass', shoot: 'Shoot', through: 'Through', lob: 'Cross' };
  private labelsDefend = { pass: 'Press', shoot: 'Tackle', through: 'Rush', lob: 'Slide' };

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="joy-zone"><div class="joy"><i></i></div></div>
      <button class="tbtn sprint" data-b="sprint">Sprint</button>
      <button class="tbtn switch" data-b="switch">Switch</button>
      <div class="buttons">
        <button class="tbtn pass" data-b="pass">Pass</button>
        <button class="tbtn shoot" data-b="shoot">Shoot</button>
        <button class="tbtn through" data-b="lob">Cross</button>
        <button class="tbtn lob" data-b="through">Through</button>
        <button class="tfin" type="button">Finesse</button>
        <button class="tloft" type="button">Loft</button>
      </div>
      <div class="tcurl"><button type="button" data-c="-1">◀ Curl</button><button type="button" data-c="1">Curl ▶</button></div>`;
    parent.appendChild(this.el);
    this.zone = this.el.querySelector('.joy-zone')!; this.joy = this.el.querySelector('.joy')!; this.knob = this.joy.querySelector('i')!;
    this.zone.addEventListener('pointerdown', (e) => { if (this.joyId !== null) return; this.joyId = e.pointerId; this.origin = { x: e.clientX, y: e.clientY }; this.joy.style.display = 'block'; this.joy.style.left = `${e.clientX}px`; this.joy.style.top = `${e.clientY}px`; this.zone.setPointerCapture(e.pointerId); input.setTouchMove(0, 0); });
    this.zone.addEventListener('pointermove', (e) => { if (e.pointerId !== this.joyId) return; let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y; const r = 50; const l = Math.hypot(dx, dy); if (l > r) { dx = dx / l * r; dy = dy / l * r; } this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; input.setTouchMove(dx / r, -dy / r); });
    const end = (e: PointerEvent) => { if (e.pointerId !== this.joyId) return; this.joyId = null; this.joy.style.display = 'none'; this.knob.style.transform = 'translate(-50%, -50%)'; input.setTouchMove(0, 0); };
    this.zone.addEventListener('pointerup', end); this.zone.addEventListener('pointercancel', end);
    // Finesse on touch: tap to arm it for the next shot (one thumb can't hold two buttons); it disarms after the shot.
    this.fin = this.el.querySelector('.tfin')!;
    this.fin.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setFinesse(!this.finesseOn); });
    this.fin.addEventListener('contextmenu', (e) => e.preventDefault());
    // Loft (the LB modifier) on touch: tap to arm, then Through = lofted through ball, Shoot = chip shot
    this.loftEl = this.el.querySelector('.tloft')!;
    this.loftEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setLoft(!this.loftOn); });
    this.loftEl.addEventListener('contextmenu', (e) => e.preventDefault());
    // Free kicks: hold a curl button to bend it
    this.curlEl = this.el.querySelector('.tcurl')!;
    for (const c of Array.from(this.curlEl.querySelectorAll<HTMLElement>('button'))) {
      const v = Number(c.dataset.c);
      c.addEventListener('pointerdown', (e) => { e.preventDefault(); c.classList.add('pressed'); input.touchCurl = v; this.lastSourceTouch(); });
      const up = () => { c.classList.remove('pressed'); if (input.touchCurl === v) input.touchCurl = 0; };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up); c.addEventListener('pointerleave', up);
      c.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    for (const b of Array.from(this.el.querySelectorAll<HTMLElement>('.tbtn'))) {
      const name = b.dataset.b!; this.buttons[name] = b;
      // FIFA layout: the left face button crosses when attacking and slides when defending
      const down = (e: PointerEvent) => { e.preventDefault(); b.classList.add('pressed'); input.setTouchButton(name === 'lob' && this.defending ? 'slide' : name, true); };
      const up = () => {
        b.classList.remove('pressed'); input.setTouchButton(name, false); input.setTouchButton('slide', false);
        if ((name === 'shoot' || name === 'pass') && this.finesseOn) { clearTimeout(this.finTimer); this.finTimer = window.setTimeout(() => this.setFinesse(false), 600); }
        if ((name === 'shoot' || name === 'through') && this.loftOn) { clearTimeout(this.loftTimer); this.loftTimer = window.setTimeout(() => this.setLoft(false), 600); }
      };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
  private defending = false;
  private curlEl!: HTMLElement; private fkOn = false;
  private lastSourceTouch() { input.lastSource = 'touch'; }
  /** Free-kick mode: show the curl buttons (finesse is not used). */
  setFreeKick(on: boolean) {
    if (on === this.fkOn) return; this.fkOn = on;
    this.curlEl.classList.toggle('on', on); if (on) this.setFinesse(false); this.fin.style.visibility = on ? 'hidden' : '';
    if (!on) input.touchCurl = 0;
  }
  private fin!: HTMLElement; private finesseOn = false; private finTimer = 0;
  private loftEl!: HTMLElement; private loftOn = false; private loftTimer = 0;
  private setLoft(on: boolean) { this.loftOn = on; this.loftEl.classList.toggle('on', on); input.setTouchButton('loft', on); }
  private setFinesse(on: boolean) { this.finesseOn = on; this.fin.classList.toggle('on', on); input.setTouchButton('finesse', on); }
  setDefending(d: boolean) {
    if (d === this.defending) return; this.defending = d;
    this.fin.style.display = d ? 'none' : ''; if (d) this.setFinesse(false);
    this.loftEl.style.display = d ? 'none' : ''; if (d) this.setLoft(false);
    const labels = d ? this.labelsDefend : this.labelsAttack;
    for (const [k, v] of Object.entries(labels)) if (this.buttons[k]) this.buttons[k].textContent = v;
  }
  show(on: boolean) { this.el.classList.toggle('on', on); }
  destroy() { this.el.remove(); }
}
