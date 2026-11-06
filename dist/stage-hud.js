const write = (object, key, value) => { if (object && object[key] !== value) object[key] = value; };
const opacity = value => String(Math.round(value * 10000) / 10000);

// The dots and caption share one opacity clock. Repeated HUD updates only
// advance that clock; changing phase reverses it from the current opacity.
export class StageHud {
  constructor() { this.owner = null; this.mode = 'off'; this.alpha = 0; }

  reset(progress, caption) {
    this.owner = null; this.mode = 'off'; this.alpha = 0;
    this.render(progress, caption, false, '');
  }

  update(progress, caption, {owner, mode = 'off', visible = false, stage = 1, dt = 0} = {}) {
    if (mode === 'off') { this.reset(progress, caption); return; }
    if (this.owner !== owner || this.mode !== mode) this.alpha = 0;
    this.owner = owner; this.mode = mode;
    if (mode === 'campaign') this.alpha = visible ? 1 : 0;
    else {
      const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const next = this.alpha + (visible ? elapsed / .18 : -elapsed / .16);
      this.alpha = next > 1 - 1e-10 ? 1 : next < 1e-10 ? 0 : next;
    }
    this.render(progress, caption, visible, `阶段 ${Math.max(1, Math.floor(Number(stage) || 1))}`);
  }

  render(progress, caption, visible, text) {
    const endless = this.mode === 'endless', campaign = this.mode === 'campaign';
    const hidden = !(endless ? visible || this.alpha > 0 : campaign && visible);
    write(progress, 'hidden', hidden);
    write(progress?.style, 'opacity', campaign ? '' : opacity(this.alpha));
    write(caption, 'hidden', !endless || hidden);
    write(caption?.style, 'opacity', opacity(endless ? this.alpha * .45 : 0));
    write(caption, 'textContent', endless ? text : '');
  }
}
