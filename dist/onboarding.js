export const ONBOARDING_KEY = 'qiuqiule-onboarding-v1';

const guideMarkup = `
  <div class="onboarding-copy">
    <span class="onboarding-prompt">点击屏幕任意位置</span>
    <strong>拖拽小球</strong>
    <strong>开始游戏</strong>
  </div>
  <svg class="onboarding-route" aria-hidden="true">
    <path class="onboarding-path" pathLength="100" />
  </svg>
  <div class="onboarding-hand" aria-hidden="true">
    <svg viewBox="0 0 88 112">
      <defs>
        <radialGradient id="onboarding-hand-fill" cx="54%" cy="62%" r="64%">
          <stop offset="0" stop-color="white" stop-opacity="0" />
          <stop offset=".5" stop-color="white" stop-opacity=".08" />
          <stop offset="1" stop-color="white" stop-opacity=".5" />
        </radialGradient>
      </defs>
      <path class="onboarding-finger" d="M31 71 14 53Q9 48 13 43Q17 38 22 42L31 49V16C31 6 45 6 45 16V40C45 32 57 32 57 41V44C57 36 69 37 69 45V49C69 42 80 44 80 52V66C80 78 74 84 71 92V101H39L36 86Q33 80 31 71Z" />
      <path class="onboarding-crease" d="M45 40v13m12-9v12m12-7v10" />
    </svg>
  </div>
  <svg class="onboarding-direction" viewBox="0 0 28 56" aria-hidden="true">
    <path d="M14 48V8M5 17l9-9 9 9" />
  </svg>`;

// The game owns pointer input; the first meaningful drag completes this guide.
// The overlay only illustrates that input and never captures it or starts a run.
export function createOnboarding({document, storage, experienced = false}) {
  const readCompletion = () => { try { return storage.read(ONBOARDING_KEY, false) === true; } catch { return false; } };
  const writeCompletion = () => { try { storage.write(ONBOARDING_KEY, true); } catch { /* A private session can still complete this visit. */ } };
  const savedCompletion = readCompletion();
  let done = experienced || savedCompletion;
  let element = null, path = null, allowed = false;
  let cleanupTimer = null;
  const geometry = {};

  if (experienced && !savedCompletion) writeCompletion();

  const render = () => {
    if (!element || done) return;
    const visible = allowed && !document.hidden;
    element.hidden = !visible;
    document.documentElement.classList.toggle('has-first-visit-guide', visible);
    element.setAttribute('aria-hidden', String(!visible));
  };

  const ensureElement = () => {
    if (element) return;
    element = document.createElement('div');
    element.id = 'first-visit-guide';
    element.className = 'onboarding';
    element.hidden = true;
    element.setAttribute('role', 'note');
    element.innerHTML = guideMarkup;
    path = element.querySelector('.onboarding-path');
    document.body.append(element);
    document.addEventListener('visibilitychange', render);
  };

  const remove = () => {
    if (cleanupTimer !== null) clearTimeout(cleanupTimer);
    cleanupTimer = null;
    document.documentElement.classList.remove('has-first-visit-guide');
    element?.remove();
    element = path = null;
  };

  const place = ({x, y, dx, dy} = {}) => {
    const width = document.documentElement.clientWidth || 390;
    const height = document.documentElement.clientHeight || 780;
    x = Number.isFinite(x) ? x : width * .5;
    y = Number.isFinite(y) ? y : height * .48;
    dx = Number.isFinite(dx) ? dx : 0;
    dy = Number.isFinite(dy) ? dy : -Math.min(110, height * .15);
    if (geometry.x === x && geometry.y === y && geometry.dx === dx && geometry.dy === dy) return;
    Object.assign(geometry, {x, y, dx, dy});
    element.style.setProperty('--guide-x', `${x}px`);
    element.style.setProperty('--guide-y', `${y}px`);
    element.style.setProperty('--drag-x', `${dx}px`);
    element.style.setProperty('--drag-y', `${dy}px`);
    element.style.setProperty('--guide-angle', `${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg`);
    path.setAttribute('d', `M${x} ${y}l${dx} ${dy}`);
  };

  return {
    get done() { return done; },
    get active() { return !done && allowed && !document.hidden; },
    show(position) {
      if (done) return;
      ensureElement();
      place(position);
      allowed = true;
      render();
    },
    suspend() {
      allowed = false;
      render();
    },
    previewDrag(distance) {
      if (done || !allowed || !Number.isFinite(distance) || distance < 8) return;
      this.complete();
    },
    complete() {
      if (done) return;
      done = true;
      allowed = false;
      writeCompletion();
      document.documentElement.classList.remove('has-first-visit-guide');
      document.removeEventListener('visibilitychange', render);
      if (!element || element.hidden || document.hidden) { remove(); return; }
      element.setAttribute('aria-hidden', 'true');
      element.classList.add('onboarding-complete');
      cleanupTimer = setTimeout(remove, 180);
    }
  };
}
