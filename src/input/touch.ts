import { input } from './input';

/** On-screen joystick + action buttons for phones and tablets. */
export class TouchControls {
  el: HTMLElement;
  private joy: HTMLElement; private knob: HTMLElement; private zone: HTMLElement;
  private joyId: number | null = null; private origin = { x: 0, y: 0 };
  private buttons: Record<string, HTMLElement> = {};
  private labelsAttack = { pass: 'Pass', shoot: 'Shoot', through: 'Through', lob: 'Cross' };
  private labelsDefend = { pass: 'Press', shoot: 'Tackle', through: 'Slide', lob: 'Rush' };

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
        <button class="tbtn through" data-b="through">Through</button>
        <button class="tbtn lob" data-b="lob">Cross</button>
      </div>`;
    parent.appendChild(this.el);
    this.zone = this.el.querySelector('.joy-zone')!; this.joy = this.el.querySelector('.joy')!; this.knob = this.joy.querySelector('i')!;
    this.zone.addEventListener('pointerdown', (e) => { if (this.joyId !== null) return; this.joyId = e.pointerId; this.origin = { x: e.clientX, y: e.clientY }; this.joy.style.display = 'block'; this.joy.style.left = `${e.clientX}px`; this.joy.style.top = `${e.clientY}px`; this.zone.setPointerCapture(e.pointerId); input.setTouchMove(0, 0); });
    this.zone.addEventListener('pointermove', (e) => { if (e.pointerId !== this.joyId) return; let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y; const r = 50; const l = Math.hypot(dx, dy); if (l > r) { dx = dx / l * r; dy = dy / l * r; } this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; input.setTouchMove(dx / r, -dy / r); });
    const end = (e: PointerEvent) => { if (e.pointerId !== this.joyId) return; this.joyId = null; this.joy.style.display = 'none'; this.knob.style.transform = 'translate(-50%, -50%)'; input.setTouchMove(0, 0); };
    this.zone.addEventListener('pointerup', end); this.zone.addEventListener('pointercancel', end);
    for (const b of Array.from(this.el.querySelectorAll<HTMLElement>('.tbtn'))) {
      const name = b.dataset.b!; this.buttons[name] = b;
      const down = (e: PointerEvent) => { e.preventDefault(); b.classList.add('pressed'); input.setTouchButton(name === 'through' && this.defending ? 'slide' : name, true); if (name === 'through') input.setTouchButton(this.defending ? 'slide' : 'through', true); };
      const up = () => { b.classList.remove('pressed'); input.setTouchButton(name, false); input.setTouchButton('slide', false); };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
  private defending = false;
  setDefending(d: boolean) {
    if (d === this.defending) return; this.defending = d;
    const labels = d ? this.labelsDefend : this.labelsAttack;
    for (const [k, v] of Object.entries(labels)) if (this.buttons[k]) this.buttons[k].textContent = v;
  }
  show(on: boolean) { this.el.classList.toggle('on', on); }
  destroy() { this.el.remove(); }
}
