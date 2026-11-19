import { AUTHOR, ISLANDS, type IslandId, type IslandInfo } from '../content';
import { formatTime } from '../core/math';
import { GAME_IDS, type GameId, type Records } from '../core/Store';
import type { GameAction, GameHud, GameOutcome, Stat } from '../games/types';
import { ICONS, hydrateIcons, stampSvg } from './icons';

export type Mode = 'title' | 'fly' | 'map' | 'travel' | 'island' | 'game';

export interface UIHandlers {
  start(): void;
  openMap(): void;
  /** Take off from the island and fly freely. */
  fly(): void;
  /** Do whatever the on-screen prompt offers: call at an island, or board the ship. */
  act(): void;
  travel(id: IslandId): void;
  /** Primary action on the island ticket. */
  play(): void;
  exitGame(): void;
  replay(): void;
  cycleTime(): void;
  toggleSound(): void;
  reset(): void;
  celebrate(): void;
  /** A map pin gained or lost pointer/keyboard focus. */
  hover(id: IslandId | null): void;
  /** Move a conversation on to its next line, or end it after the last. */
  talkNext(): void;
  /** Put on a costume. */
  wear(id: string): void;
}

/** A costume as the stamp book shows it. */
export interface OutfitChoice {
  id: string;
  name: string;
  jacket: string;
  scarf: string;
  unlocked: boolean;
  /** How to unlock it, shown while it is still locked. */
  hint: string;
}

/** A one-key action offered at the bottom of the screen. */
export interface Prompt {
  code: string;
  /** Verb phrase before the name, such as "Singgah di". */
  lead: string;
  name: string;
}

export interface TicketState {
  stamped: boolean;
  record: string | null;
  stampCount: number;
}

const LAYERS = ['title', 'hud', 'pins', 'maphint', 'flight', 'ticket', 'travel', 'game'] as const;
type Layer = (typeof LAYERS)[number];

const VISIBLE: Record<Mode, readonly Layer[]> = {
  title: ['title'],
  fly: ['hud', 'pins', 'flight'],
  map: ['hud', 'pins', 'maphint'],
  travel: ['hud', 'travel'],
  // On foot the ticket only slides in at the island's game spot; see setTicket().
  island: ['hud', 'flight'],
  game: ['hud', 'game'],
};

/** Each stamp lands at its own slight angle, like a real passport page. */
const TILT: Record<IslandId, number> = { hub: -6, ubin: -11, rimba: 8, angin: -5, lentera: 13 };

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export function recordText(id: GameId, records: Readonly<Records>): string | null {
  switch (id) {
    case 'ubin':
      return records.ubin ? `${records.ubin.moves} langkah · ${formatTime(records.ubin.time)}` : null;
    case 'rimba':
      return records.rimba ? formatTime(records.rimba.time) : null;
    case 'angin':
      return records.angin ? `${records.angin.rings} cincin` : null;
    default:
      return records.lentera ? `sisa ${records.lentera.lives} nyawa` : null;
  }
}

/** All DOM outside the canvas. It renders state and reports intent; it never decides game flow. */
export class UI {
  readonly hud: GameHud;
  /** On-screen stick and lift buttons for touch screens, each axis in -1..1. */
  readonly touch = { x: 0, y: 0, lift: 0 };
  private promptKey = '';
  private guideLabel = '';
  private guideHalf = { x: 0, y: 0 };
  private controlsTimer = 0;

  private readonly layers = Object.fromEntries(LAYERS.map((name) => [name, $(name)])) as Record<Layer, HTMLElement>;
  private readonly pins = new Map<IslandId, HTMLButtonElement>();
  /** Half the rendered width of each pin, cached so placing them never forces a layout. */
  private readonly pinReach = new Map<IslandId, number>();
  private readonly statValues: HTMLElement[] = [];
  private statLabels = '';
  private timeText = '';
  private resetArmed = 0;

  constructor(private readonly handlers: UIHandlers) {
    hydrateIcons(document);
    $('credit-name').textContent = AUTHOR;
    this.buildPins();
    if (window.matchMedia('(pointer: coarse)').matches) {
      $('maphint').textContent = 'Ketuk pulau tujuan · seret untuk memutar · cubit untuk mendekat';
    }

    $('btn-start').addEventListener('click', () => handlers.start());
    $('btn-map').addEventListener('click', () => handlers.openMap());
    $('btn-back').addEventListener('click', () => handlers.fly());
    $('prompt').addEventListener('click', () => handlers.act());
    this.bindTouchControls();
    $('btn-play').addEventListener('click', () => handlers.play());
    $('btn-exit').addEventListener('click', () => handlers.exitGame());
    $('btn-done').addEventListener('click', () => handlers.exitGame());
    $('btn-again').addEventListener('click', () => handlers.replay());
    $('btn-time').addEventListener('click', () => handlers.cycleTime());
    $('btn-sound').addEventListener('click', () => handlers.toggleSound());
    $('btn-stamps').addEventListener('click', () => this.openStamps());
    $('btn-help').addEventListener('click', () => $<HTMLDialogElement>('help').showModal());
    $('btn-celebrate').addEventListener('click', () => {
      $<HTMLDialogElement>('stampbook').close();
      handlers.celebrate();
    });
    $('btn-reset').addEventListener('click', () => this.confirmReset());
    $('talk-next').addEventListener('click', () => handlers.talkNext());

    // Clicking the dimmed backdrop closes a dialog, as people expect.
    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    this.hud = {
      setStats: (stats) => this.setStats(stats),
      setHint: (text) => {
        $('game-hint').textContent = text;
      },
      setActions: (actions) => this.setActions(actions),
      setPreview: (src) => this.setPreview(src),
      setBanner: (text) => this.setBanner(text),
    };
  }

  // ------------------------------------------------------------ global state

  ready(): void {
    const button = $<HTMLButtonElement>('btn-start');
    button.disabled = false;
    $('start-label').textContent = 'Mulai berlayar';
  }

  setMode(mode: Mode): void {
    document.body.dataset.mode = mode;
    for (const name of LAYERS) this.layers[name].classList.toggle('is-on', VISIBLE[mode].includes(name));
    if (mode === 'map') this.measure();
  }

  /** Re-read sizes that positioning depends on. Call after anything that can change layout. */
  measure(): void {
    for (const [id, pin] of this.pins) this.pinReach.set(id, pin.offsetWidth / 2);
  }

  setPlace(info: IslandInfo, label = info.name): void {
    const place = $('place');
    (place.firstElementChild as HTMLElement).textContent = info.code;
    (place.lastElementChild as HTMLElement).textContent = label;
  }

  setTime(phase: string, clock: string, time: number): void {
    const text = `${phase} · ${clock}`;
    if (text === this.timeText) return;
    this.timeText = text;
    $('time-label').textContent = text;
    $('btn-time').style.setProperty('--t', time.toFixed(3));
  }

  setSound(muted: boolean): void {
    const button = $('btn-sound');
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? 'Nyalakan suara' : 'Matikan suara');
    (button.firstElementChild as HTMLElement).innerHTML = (muted ? ICONS.mute : ICONS.sound) ?? '';
  }

  toast(text: string): void {
    const toast = document.createElement('p');
    toast.className = 'toast';
    toast.textContent = text;
    $('toasts').append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  // ------------------------------------------------------------ map pins

  private buildPins(): void {
    const container = this.layers.pins;
    for (const info of ISLANDS) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pin';
      pin.innerHTML = `
        <span class="pin__card">
          <span class="pin__code">${info.code}</span>
          <span class="pin__text"><span class="pin__name">${info.name}</span><span class="pin__kind">${info.kind}</span></span>
          <span class="pin__mark"></span>
        </span>
        <span class="pin__stem"></span>`;
      pin.addEventListener('click', () => this.handlers.travel(info.id));
      pin.addEventListener('pointerenter', () => this.handlers.hover(info.id));
      pin.addEventListener('pointerleave', () => this.handlers.hover(null));
      pin.addEventListener('focus', () => this.handlers.hover(info.id));
      pin.addEventListener('blur', () => this.handlers.hover(null));
      container.append(pin);
      this.pins.set(info.id, pin);
    }
  }

  placePin(id: IslandId, x: number, y: number, visible: boolean): void {
    const pin = this.pins.get(id);
    if (!pin) return;
    pin.classList.toggle('is-off', !visible);
    if (!visible) return;
    // Slide pins in from the edge rather than letting them hang off the screen.
    const reach = (this.pinReach.get(id) ?? 0) + 8;
    const clamped = Math.min(Math.max(x, reach), Math.max(reach, window.innerWidth - reach));
    pin.style.transform = `translate3d(${clamped.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  highlightPin(id: IslandId | null): void {
    for (const [key, pin] of this.pins) pin.classList.toggle('is-hot', key === id);
  }

  setProgress(current: IslandId, stamps: readonly GameId[]): void {
    for (const info of ISLANDS) {
      const pin = this.pins.get(info.id);
      if (!pin) continue;
      const here = info.id === current;
      const done = info.id !== 'hub' && stamps.includes(info.id);
      pin.classList.toggle('is-current', here);
      pin.classList.toggle('is-done', done);
      const mark = pin.querySelector<HTMLElement>('.pin__mark');
      if (mark) mark.innerHTML = (here ? ICONS.ship : done ? ICONS.check : '') ?? '';
      pin.setAttribute(
        'aria-label',
        `${info.name}, ${info.kind}${done ? ', cap sudah didapat' : ''}${here ? ', kapalmu ada di sini' : ''}`,
      );
    }
    $('stamp-count').textContent = `${stamps.length}/${GAME_IDS.length}`;
  }

  // ------------------------------------------------------------ island ticket

  showTicket(info: IslandInfo, state: TicketState): void {
    const index = ISLANDS.indexOf(info);
    $('ticket-kind').textContent = info.kind;
    $('ticket-alt').textContent = `${info.altitude.toLocaleString('id-ID')} m`;
    $('ticket-name').textContent = info.name;
    $('ticket-blurb').textContent = info.blurb;
    $('ticket-code').textContent = info.code;
    $('ticket-serial').textContent = `DW · 0${index + 1}`;

    const complete = state.stampCount === GAME_IDS.length;
    const facts: [string, string][] = info.game
      ? [
          ['Permainan', info.game.title],
          ['Tujuan', info.game.goal],
          ['Rekor', state.record ?? 'Belum ada'],
        ]
      : [
          ['Cap', `${state.stampCount} dari ${GAME_IDS.length} terkumpul`],
          ['Mercusuar', complete ? 'Menyala penuh' : 'Menunggu semua cap'],
        ];
    const list = $('ticket-facts');
    list.replaceChildren(
      ...facts.map(([term, detail]) => {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = term;
        dd.textContent = detail;
        row.append(dt, dd);
        return row;
      }),
    );

    $('play-label').textContent = info.game ? (state.stamped ? 'Main lagi' : 'Mulai main') : 'Buka buku cap';
    const sealed = info.game ? state.stamped : complete;
    const stamp = $('ticket-stamp');
    stamp.classList.toggle('is-empty', !sealed);
    stamp.innerHTML = sealed ? stampSvg(info.code, info.name, TILT[info.id]) : '';
  }

  // ------------------------------------------------------------ travel caption

  showTravel(from: IslandInfo, to: IslandInfo): void {
    this.layers.travel.classList.remove('is-short');
    $('travel-from').textContent = from.code;
    $('travel-to').textContent = to.code;
    $('travel-text').textContent = `Menuju ${to.name}`;
    this.setTravelProgress(0);
  }

  /** Caption for the short hop from open sky to a pier. */
  showDocking(to: IslandInfo): void {
    this.layers.travel.classList.add('is-short');
    $('travel-text').textContent = `Merapat ke ${to.name}`;
    this.setTravelProgress(0);
  }

  // ------------------------------------------------------------ free flight

  /** Offer a one-key action, or hide the offer with null. */
  setPrompt(offer: Prompt | null): void {
    const key = offer ? `${offer.code}|${offer.lead}|${offer.name}` : '';
    if (key === this.promptKey) return;
    this.promptKey = key;
    const prompt = $<HTMLButtonElement>('prompt');
    prompt.hidden = offer === null;
    if (!offer) return;
    $('prompt-code').textContent = offer.code;
    $('prompt-lead').textContent = offer.lead;
    $('prompt-name').textContent = offer.name;
    prompt.classList.remove('is-pop');
    void prompt.offsetWidth; // restart the entrance animation
    prompt.classList.add('is-pop');
  }

  // ------------------------------------------------------------ islanders

  /** Show one line of a conversation. `last` changes the button from "next" to "done". */
  showTalk(name: string, role: string, text: string, last: boolean): void {
    $('talk-name').textContent = name;
    $('talk-role').textContent = role;
    $('talk-text').textContent = text;
    $('talk-next-label').textContent = last ? 'Selesai' : 'Lanjut';
    const talk = $('talk');
    talk.hidden = false;
    talk.style.animation = 'none';
    void talk.offsetWidth; // replay the entrance for every new line
    talk.style.animation = '';
  }

  hideTalk(): void {
    $('talk').hidden = true;
  }

  /**
   * Pin the guide chip to a screen position, with its arrow turned towards the target.
   * Pass null to hide it.
   */
  setGuide(at: { x: number; y: number; angle: number; label: string } | null): void {
    const guide = $('guide');
    guide.hidden = at === null;
    if (!at) return;
    if (at.label !== this.guideLabel) {
      this.guideLabel = at.label;
      $('guide-label').textContent = at.label;
      // Measured only when the text changes, so moving the chip never forces a layout.
      this.guideHalf = { x: guide.offsetWidth / 2, y: guide.offsetHeight / 2 };
    }
    $('guide-arrow').style.transform = `rotate(${at.angle.toFixed(3)}rad)`;
    // Keep the whole chip on screen, whatever its label length.
    const margin = 10;
    const x = Math.min(Math.max(at.x, this.guideHalf.x + margin), window.innerWidth - this.guideHalf.x - margin);
    const y = Math.min(Math.max(at.y, this.guideHalf.y + margin), window.innerHeight - this.guideHalf.y - margin);
    guide.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  }

  /** Slide the island ticket in or out while walking around. */
  setTicket(open: boolean): void {
    this.layers.ticket.classList.toggle('is-on', open);
  }

  /** Show the key list for one control scheme for a few seconds, then let it fade. */
  flashControls(scheme: 'fly' | 'walk', seconds = 5): void {
    const fly = $('controls-fly');
    const walk = $('controls-walk');
    const shown = scheme === 'fly' ? fly : walk;
    const other = scheme === 'fly' ? walk : fly;
    other.hidden = true;
    other.classList.add('is-faded');
    shown.hidden = false;
    void shown.offsetWidth; // let the fade-in run from the faded state
    shown.classList.remove('is-faded');
    window.clearTimeout(this.controlsTimer);
    this.controlsTimer = window.setTimeout(() => shown.classList.add('is-faded'), seconds * 1000);
  }

  private bindTouchControls(): void {
    const stick = $('stick');
    const knob = $('stick-knob');
    let active = -1;
    const move = (event: PointerEvent): void => {
      const rect = stick.getBoundingClientRect();
      const radius = rect.width / 2;
      let x = (event.clientX - rect.left - radius) / radius;
      let y = (event.clientY - rect.top - radius) / radius;
      const length = Math.hypot(x, y);
      if (length > 1) {
        x /= length;
        y /= length;
      }
      this.touch.x = x;
      this.touch.y = -y;
      knob.style.transform = `translate(${(x * radius * 0.6).toFixed(1)}px, ${(y * radius * 0.6).toFixed(1)}px)`;
    };
    const release = (): void => {
      active = -1;
      this.touch.x = 0;
      this.touch.y = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerdown', (event) => {
      active = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      move(event);
    });
    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId === active) move(event);
    });
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    for (const [id, direction] of [
      ['lift-up', 1],
      ['lift-down', -1],
    ] as const) {
      const button = $(id);
      button.addEventListener('pointerdown', (event) => {
        button.setPointerCapture(event.pointerId);
        this.touch.lift = direction;
      });
      const stop = (): void => {
        if (this.touch.lift === direction) this.touch.lift = 0;
      };
      button.addEventListener('pointerup', stop);
      button.addEventListener('pointercancel', stop);
    }
  }

  setTravelProgress(progress: number): void {
    $('travel-bar').style.transform = `scaleX(${Math.min(1, Math.max(0, progress)).toFixed(3)})`;
  }

  // ------------------------------------------------------------ stamp book

  renderStamps(stamps: readonly GameId[], records: Readonly<Records>): void {
    const complete = stamps.length === GAME_IDS.length;
    $('stampbook-lead').textContent = complete
      ? 'Semua cap terkumpul. Mercusuar Labuan Fajar sekarang menyala penuh buat kamu.'
      : `${stamps.length} dari ${GAME_IDS.length} cap terkumpul. Menangkan permainan di tiap pulau buat melengkapinya.`;
    $('btn-celebrate').hidden = !complete;

    $('stamps').replaceChildren(
      ...ISLANDS.filter((info) => info.game).map((info) => {
        const id = info.id as GameId;
        const done = stamps.includes(id);
        const slot = document.createElement('li');
        slot.className = `stamps__slot${done ? ' is-done' : ''}`;
        const seal = document.createElement('div');
        seal.className = 'stamps__seal';
        seal.innerHTML = done ? stampSvg(info.code, info.name, TILT[info.id]) : `<span class="stamps__empty">${info.code}</span>`;
        const name = document.createElement('p');
        name.className = 'stamps__name';
        name.textContent = info.name;
        const meta = document.createElement('p');
        meta.className = 'stamps__meta';
        meta.textContent = done ? (recordText(id, records) ?? 'Selesai') : (info.game?.title ?? '');
        slot.append(seal, name, meta);
        return slot;
      }),
    );
  }

  /** Feather count and the costume picker in the stamp book. */
  renderExtras(feathers: number, total: number, outfits: readonly OutfitChoice[], current: string): void {
    $('feather-count').textContent = `${feathers}/${total}`;
    $('outfits').replaceChildren(
      ...outfits.map((outfit) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'outfit';
        button.disabled = !outfit.unlocked;
        button.setAttribute('aria-pressed', String(outfit.id === current));
        const swatch = document.createElement('span');
        swatch.className = 'outfit__swatch';
        swatch.setAttribute('aria-hidden', 'true');
        for (const color of [outfit.jacket, outfit.scarf]) {
          const disc = document.createElement('i');
          disc.style.background = color;
          swatch.append(disc);
        }
        const name = document.createElement('span');
        name.className = 'outfit__name';
        name.textContent = outfit.name;
        button.append(swatch, name);
        if (!outfit.unlocked) {
          const lock = document.createElement('span');
          lock.className = 'outfit__lock';
          lock.textContent = outfit.hint;
          button.append(lock);
        }
        button.addEventListener('click', () => this.handlers.wear(outfit.id));
        item.append(button);
        return item;
      }),
    );
  }

  openStamps(): void {
    const dialog = $<HTMLDialogElement>('stampbook');
    if (!dialog.open) dialog.showModal();
  }

  /** Destructive, so it takes a second click within a few seconds. */
  private confirmReset(): void {
    const button = $('btn-reset');
    if (this.resetArmed) {
      window.clearTimeout(this.resetArmed);
      this.resetArmed = 0;
      button.textContent = 'Hapus progres';
      this.handlers.reset();
      return;
    }
    button.textContent = 'Yakin? Klik sekali lagi';
    this.resetArmed = window.setTimeout(() => {
      this.resetArmed = 0;
      button.textContent = 'Hapus progres';
    }, 3500);
  }

  // ------------------------------------------------------------ mini game HUD

  openGame(info: IslandInfo): void {
    $('game-island').textContent = info.name;
    $('game-title').textContent = info.game?.title ?? '';
    this.statLabels = '';
    this.statValues.length = 0;
    $('game-stats').replaceChildren();
    $('game-actions').replaceChildren();
    $('game-hint').textContent = '';
    this.setPreview(null);
    this.setBanner(null);
    this.hideResult();
  }

  showResult(info: IslandInfo, outcome: GameOutcome, newStamp: boolean): void {
    $('result-eyebrow').textContent = outcome.won ? (newStamp ? 'Cap baru di buku cap' : 'Selesai') : 'Belum berhasil';
    $('result-title').textContent = outcome.headline;
    $('result-lines').replaceChildren(
      ...outcome.lines.map((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        return item;
      }),
    );
    const stamp = $('result-stamp');
    stamp.innerHTML = outcome.won ? stampSvg(info.code, info.name, TILT[info.id]) : '';
    stamp.hidden = !outcome.won;

    const result = $('result');
    result.hidden = false;
    result.classList.toggle('is-won', outcome.won);
    $('game-hint').textContent = '';
    $(outcome.won ? 'btn-done' : 'btn-again').focus({ preventScroll: true });
  }

  hideResult(): void {
    $('result').hidden = true;
  }

  private setStats(stats: readonly Stat[]): void {
    const labels = stats.map((stat) => stat.label).join('|');
    if (labels !== this.statLabels) {
      this.statLabels = labels;
      this.statValues.length = 0;
      $('game-stats').replaceChildren(
        ...stats.map((stat) => {
          const row = document.createElement('div');
          const dt = document.createElement('dt');
          const dd = document.createElement('dd');
          dt.textContent = stat.label;
          this.statValues.push(dd);
          row.append(dt, dd);
          return row;
        }),
      );
    }
    // Stats refresh every frame, so only touch the DOM when a value really changed.
    stats.forEach((stat, i) => {
      const cell = this.statValues[i];
      if (cell && cell.textContent !== stat.value) cell.textContent = stat.value;
    });
  }

  private setActions(actions: readonly GameAction[]): void {
    $('game-actions').replaceChildren(
      ...actions.map((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--ghost btn--small';
        button.textContent = action.label;
        button.addEventListener('click', action.onClick);
        return button;
      }),
    );
  }

  private setPreview(src: string | null): void {
    const figure = $('game-preview');
    figure.hidden = src === null;
    figure.querySelector('img')?.remove();
    if (src === null) return;
    const image = new Image();
    image.src = src;
    image.alt = 'Gambar mozaik yang utuh';
    figure.prepend(image);
  }

  private setBanner(text: string | null): void {
    const banner = $('game-banner');
    banner.textContent = text ?? '';
    banner.classList.remove('is-pop');
    if (text === null) return;
    void banner.offsetWidth; // restart the pop animation for each new value
    banner.classList.add('is-pop');
  }
}
