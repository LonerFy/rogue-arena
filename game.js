"use strict";
/* ROGUE ARENA — survie, vagues, boss, triple contrôle, traînées + glitch, rideau + score */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);
const ui = {
  hpFill: $("hpFill"), hpText: $("hpText"), xpFill: $("xpFill"), xpText: $("xpText"),
  score: $("score"), wave: $("wave"), kills: $("kills"), time: $("time"),
  bossBar: $("bossBar"), bossFill: $("bossFill"), bossName: $("bossName"),
  menu: $("menu"), gameover: $("gameover"), pauseOverlay: $("pauseOverlay"),
  menuBest: $("menuBest"), scoreDetail: $("scoreDetail"), newBest: $("newBest"),
  rideau: $("rideau"), flash: $("flash"), toast: $("toast"),
  btnPlay: $("btnPlay"), btnReplay: $("btnReplay"), btnMenu: $("btnMenu"),
  btnPause: $("btnPause"), btnSound: $("btnSound"), btnResume: $("btnResume"),
  joystick: $("joystick"), stick: $("stick")
};

const BEST_KEY = "rogueArenaBest";
let W = 800, H = 500, DPR = 1;

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(320, Math.floor(r.width));
  H = Math.max(320, Math.floor(r.height));
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // fond opaque initial (pour les traînées en fade ensuite)
  ctx.fillStyle = "#080a14";
  ctx.fillRect(0, 0, W, H);
}
window.addEventListener("resize", resize);

// ---------- Audio (bips WebAudio, aucun asset) ----------
let audioCtx = null, soundOn = true;
function beep(freq, dur, type, vol) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || "square"; o.frequency.value = freq;
    g.gain.value = vol || 0.06;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (dur || 0.08));
    o.stop(audioCtx.currentTime + (dur || 0.08));
  } catch (e) { /* silencieux */ }
}
const sfx = {
  hit: () => beep(160, 0.12, "sawtooth", 0.08),
  slash: () => beep(700 + Math.random() * 300, 0.06, "square", 0.04),
  gem: () => beep(950 + Math.random() * 250, 0.07, "sine", 0.05),
  level: () => { beep(523, 0.1, "square", 0.07); setTimeout(() => beep(784, 0.14, "square", 0.07), 90); },
  boss: () => beep(90, 0.4, "sawtooth", 0.1),
  over: () => { beep(300, 0.2, "sawtooth", 0.08); setTimeout(() => beep(150, 0.4, "sawtooth", 0.08), 180); }
};

// ---------- État ----------
const S = {
  state: "menu", // menu | playing | paused | over
  mode: "keyboard", // keyboard | mouse | touch
  paused: false,
  time: 0, score: 0, kills: 0, wave: 1,
  spawnQueue: 0, spawnTimer: 0,
  enemies: [], gems: [], parts: [], bullets: [], slashes: [],
  boss: null, bossBullets: [],
  glitchT: 0, shakeT: 0, flashT: 0,
  shakeX: 0, shakeY: 0
};
const player = {
  x: 400, y: 250, r: 14, hp: 100, maxHp: 100,
  speed: 230, level: 1, xp: 0, xpNext: 10,
  dmg: 12, atkCd: 0, atkRate: 0.32, range: 230,
  angle: 0, hurtCd: 0
};

function getBest() {
  try { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; }
  catch (e) { return 0; }
}
function setBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) {} }
function fmtTime(s) {
  s = Math.floor(s);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { ui.toast.style.opacity = "0"; }, 1600);
}

// ---------- Contrôles ----------
const keys = {};
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  keys[k] = true;
  if (k === "p") togglePause();
  if (k === "m") toggleSound();
  if (k === "enter" && S.state === "menu") startGame();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

const mouse = { x: 400, y: 250, active: false };
canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  mouse.active = true;
});
canvas.addEventListener("mousedown", (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  mouse.active = true;
});

// Joystick tactile
const joy = { active: false, id: null, dx: 0, dy: 0 };
function joyCenter() {
  const r = ui.joystick.getBoundingClientRect();
  const pr = canvas.parentElement.getBoundingClientRect();
  return { x: r.left - pr.left + r.width / 2, y: r.top - pr.top + r.height / 2, rad: r.width / 2 };
}
function setupJoystick() {
  const el = ui.joystick;
  const move = (t) => {
    const c = joyCenter();
    let dx = t.clientX - (el.getBoundingClientRect().left + c.rad);
    let dy = t.clientY - (el.getBoundingClientRect().top + c.rad);
    const d = Math.hypot(dx, dy) || 1, max = c.rad;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    joy.dx = dx / max; joy.dy = dy / max;
    ui.stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  el.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joy.active = true; joy.id = t.identifier; move(t);
  }, { passive: false });
  window.addEventListener("touchmove", (e) => {
    if (!joy.active) return;
    for (const t of e.changedTouches) if (t.identifier === joy.id) { e.preventDefault(); move(t); }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) if (t.identifier === joy.id) {
      joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
      ui.stick.style.transform = "translate(-50%,-50%)";
    }
  };
  window.addEventListener("touchend", end);
  window.addEventListener("touchcancel", end);
  // Tactile aussi : toucher l'arène déplace au doigt si joystick inactif ? Non : joystick seul.
}

// Sélecteur de mode
document.querySelectorAll(".mode-btn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    S.mode = b.dataset.mode;
    document.body.classList.toggle("touch-mode", S.mode === "touch");
    toast(S.mode === "keyboard" ? "⌨️ Mode clavier : ZQSD / flèches" : S.mode === "mouse" ? "🖱️ Mode souris : le guerrier suit le curseur" : "👆 Mode tactile : joystick en bas à gauche");
  });
});
if ("ontouchstart" in window) {
  document.querySelector('[data-mode="touch"]').click();
}

// ---------- Vagues & ennemis ----------
function waveSize(w) { return 4 + w * 2; }
function startWave(w) {
  S.wave = w;
  if (w % 5 === 0) {
    spawnBoss(w);
    S.spawnQueue = Math.floor(waveSize(w) / 2);
    toast("👹 BOSS — vague " + w + " !");
    sfx.boss();
  } else {
    S.spawnQueue = waveSize(w);
    toast("🌊 Vague " + w);
  }
  S.spawnTimer = 0;
  ui.wave.textContent = String(w);
}
function enemyHp(base) { return Math.floor(base * (1 + S.wave * 0.15)); }
function spawnEnemy(edge) {
  const m = 20;
  let x = Math.random() * W, y = Math.random() * H;
  if (edge !== false) {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = Math.random() * W; y = -m; }
    else if (side === 1) { x = W + m; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = H + m; }
    else { x = -m; y = Math.random() * H; }
  }
  const roll = Math.random();
  let e;
  if (S.wave >= 3 && roll < 0.15) {
    e = { kind: "shooter", x, y, r: 12, hp: enemyHp(30), maxHp: enemyHp(30), speed: 90, dmg: 10, xp: 3, color: "#4db8ff", shootCd: 1 + Math.random(), hitCd: 0 };
  } else if (roll < 0.35) {
    e = { kind: "speeder", x, y, r: 9, hp: enemyHp(14), maxHp: enemyHp(14), speed: 170, dmg: 7, xp: 2, color: "#ff9a3d", hitCd: 0 };
  } else if (roll < 0.55) {
    e = { kind: "tank", x, y, r: 20, hp: enemyHp(70), maxHp: enemyHp(70), speed: 55, dmg: 16, xp: 5, color: "#b565ff", hitCd: 0 };
  } else {
    e = { kind: "chaser", x, y, r: 12, hp: enemyHp(26), maxHp: enemyHp(26), speed: 110, dmg: 10, xp: 2, color: "#ff4d6d", hitCd: 0 };
  }
  S.enemies.push(e);
}
function spawnBoss(w) {
  const tier = Math.floor(w / 5);
  const hp = 400 * tier + w * 40;
  S.boss = {
    x: W / 2, y: 90, r: 34 + tier * 4, hp, maxHp: hp,
    speed: 70, dmg: 22, xp: 30, tier,
    t: 0, dashCd: 3, dashT: 0, dvx: 0, dvy: 0,
    radialCd: 2.2, minionCd: 5, hitCd: 0, color: "#ff0033"
  };
  ui.bossBar.classList.remove("hidden");
  ui.bossName.textContent = "👹 BOSS vague " + w;
}
function killEnemy(e, idx) {
  S.enemies.splice(idx, 1);
  S.kills++; S.score += e.kind === "tank" ? 150 : e.kind === "shooter" ? 150 : 100;
  for (let i = 0; i < e.xp; i++) {
    S.gems.push({ x: e.x + (Math.random() - 0.5) * 20, y: e.y + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120, r: 5, t: 0 });
  }
  burst(e.x, e.y, e.color, 10);
}
function burst(x, y, color, n) {
  for (let i = 0; i < (n || 8); i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.3, t: 0, color });
  }
}

// ---------- Dégâts joueur : glitch hit ----------
function hurtPlayer(dmg) {
  if (player.hurtCd > 0 || S.state !== "playing" || S.paused) return;
  player.hurtCd = 0.5;
  player.hp -= dmg;
  S.glitchT = 0.28; S.shakeT = 0.3; S.flashT = 0.25;
  canvas.classList.add("glitch");
  ui.flash.style.opacity = "1";
  setTimeout(() => { canvas.classList.remove("glitch"); ui.flash.style.opacity = "0"; }, 220);
  burst(player.x, player.y, "#ff4d6d", 12);
  sfx.hit();
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
}

// ---------- Boucle ----------
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  if (S.state === "playing" && !S.paused) update(dt);
  render(dt);
}

function update(dt) {
  S.time += dt;
  // --- mouvement joueur selon mode ---
  let dx = 0, dy = 0;
  if (S.mode === "keyboard") {
    if (keys["z"] || keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["q"] || keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    const n = Math.hypot(dx, dy) || 1;
    player.x += (dx / n) * player.speed * dt * (dx || dy ? 1 : 0);
    player.y += (dy / n) * player.speed * dt * (dx || dy ? 1 : 0);
    if (dx || dy) player.angle = Math.atan2(dy, dx);
  } else if (S.mode === "mouse") {
    const tx = mouse.x, ty = mouse.y;
    const vx = tx - player.x, vy = ty - player.y;
    const d = Math.hypot(vx, vy);
    if (d > 4) {
      const step = Math.min(d, player.speed * 1.25 * dt);
      player.x += vx / d * step; player.y += vy / d * step;
      player.angle = Math.atan2(vy, vx);
    }
  } else {
    if (joy.active && (joy.dx || joy.dy)) {
      const n = Math.hypot(joy.dx, joy.dy) || 1;
      const k = Math.min(1, n);
      player.x += (joy.dx / (n || 1)) * player.speed * k * dt * 1.2 + joy.dx * player.speed * 0.2 * dt;
      player.y += (joy.dy / (n || 1)) * player.speed * k * dt * 1.2 + joy.dy * player.speed * 0.2 * dt;
      player.angle = Math.atan2(joy.dy, joy.dx);
    } else {
      // clavier en secours même en mode tactile
      if (keys["z"] || keys["w"] || keys["arrowup"]) dy -= 1;
      if (keys["s"] || keys["arrowdown"]) dy += 1;
      if (keys["q"] || keys["a"] || keys["arrowleft"]) dx -= 1;
      if (keys["d"] || keys["arrowright"]) dx += 1;
      if (dx || dy) {
        const n = Math.hypot(dx, dy) || 1;
        player.x += dx / n * player.speed * dt;
        player.y += dy / n * player.speed * dt;
        player.angle = Math.atan2(dy, dx);
      }
    }
  }
  player.x = Math.max(player.r, Math.min(W - player.r, player.x));
  player.y = Math.max(player.r, Math.min(H - player.r, player.y));
  if (player.hurtCd > 0) player.hurtCd -= dt;

  // --- spawn de vague ---
  if (S.spawnQueue > 0) {
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      spawnEnemy(true);
      S.spawnQueue--;
      S.spawnTimer = Math.max(0.25, 1.1 - S.wave * 0.07);
    }
  } else if (S.enemies.length === 0 && !S.boss) {
    S.score += S.wave * 50; // bonus de vague
    startWave(S.wave + 1);
  }

  // --- attaque auto (lame) ---
  player.atkCd -= dt;
  if (player.atkCd <= 0) {
    let best = null, bd = player.range;
    const all = S.boss ? S.enemies.concat([S.boss]) : S.enemies;
    for (const e of all) {
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      player.atkCd = player.atkRate;
      best.hp -= player.dmg;
      player.angle = Math.atan2(best.y - player.y, best.x - player.x);
      S.slashes.push({ x1: player.x, y1: player.y, x2: best.x, y2: best.y, t: 0.12 });
      burst(best.x, best.y, "#ffffff", 4);
      sfx.slash();
      if (best.hp <= 0) {
        if (S.boss && best === S.boss) killBoss();
        else { const i = S.enemies.indexOf(best); if (i >= 0) killEnemy(best, i); }
      }
    }
  }

  // --- ennemis ---
  for (let i = S.enemies.length - 1; i >= 0; i--) {
    const e = S.enemies[i];
    const vx = player.x - e.x, vy = player.y - e.y;
    const d = Math.hypot(vx, vy) || 1;
    e.x += vx / d * e.speed * dt;
    e.y += vy / d * e.speed * dt;
    if (e.hitCd > 0) e.hitCd -= dt;
    // shooter : tire
    if (e.kind === "shooter") {
      e.shootCd -= dt;
      if (e.shootCd <= 0 && d < 420) {
        e.shootCd = 1.6;
        S.bullets.push({ x: e.x, y: e.y, vx: vx / d * 200, vy: vy / d * 200, r: 4, t: 3 });
      }
    }
    // contact
    if (d < e.r + player.r && e.hitCd <= 0) {
      e.hitCd = 0.8;
      hurtPlayer(e.dmg);
    }
    if (e.hp <= 0) killEnemy(e, i);
  }

  // --- boss ---
  if (S.boss) {
    const b = S.boss;
    b.t += dt;
    if (b.hitCd > 0) b.hitCd -= dt;
    const vx = player.x - b.x, vy = player.y - b.y;
    const d = Math.hypot(vx, vy) || 1;
    if (b.dashT > 0) {
      b.dashT -= dt;
      b.x += b.dvx * dt; b.y += b.dvy * dt;
    } else {
      b.x += vx / d * b.speed * dt;
      b.y += vy / d * b.speed * dt;
      b.dashCd -= dt;
      if (b.dashCd <= 0 && d < 500) {
        b.dashCd = 3.2; b.dashT = 0.45;
        b.dvx = vx / d * 420; b.dvy = vy / d * 420;
        toast("👹 Charge du BOSS !");
      }
    }
    b.radialCd -= dt;
    if (b.radialCd <= 0) {
      b.radialCd = 2.4;
      const n = 8 + b.tier * 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + b.t;
        S.bullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, r: 5, t: 3.2, boss: true });
      }
      sfx.boss();
    }
    b.minionCd -= dt;
    if (b.minionCd <= 0) { b.minionCd = 6; spawnEnemy(true); spawnEnemy(true); }
    b.x = Math.max(b.r, Math.min(W - b.r, b.x));
    b.y = Math.max(b.r, Math.min(H - b.r, b.y));
    if (d < b.r + player.r && b.hitCd <= 0) { b.hitCd = 0.8; hurtPlayer(b.dmg); }
    if (b.hp <= 0) killBoss();
    ui.bossFill.style.width = Math.max(0, b.hp / b.maxHp * 100) + "%";
  }

  // --- projectiles ennemis ---
  for (let i = S.bullets.length - 1; i >= 0; i--) {
    const p = S.bullets[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt;
    if (p.t <= 0 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { S.bullets.splice(i, 1); continue; }
    if (Math.hypot(p.x - player.x, p.y - player.y) < p.r + player.r) {
      S.bullets.splice(i, 1);
      hurtPlayer(p.boss ? 14 : 9);
    }
  }

  // --- gemmes XP (magnétisme) ---
  for (let i = S.gems.length - 1; i >= 0; i--) {
    const g = S.gems[i];
    g.t += dt;
    g.x += g.vx * dt; g.y += g.vy * dt;
    g.vx *= 0.92; g.vy *= 0.92;
    const dxg = player.x - g.x, dyg = player.y - g.y;
    const dg = Math.hypot(dxg, dyg) || 1;
    if (dg < 130) { g.x += dxg / dg * 320 * dt; g.y += dyg / dg * 320 * dt; }
    if (dg < player.r + 8) {
      S.gems.splice(i, 1);
      player.xp++; S.score += 10;
      sfx.gem();
      if (player.xp >= player.xpNext) {
        player.xp = 0; player.level++;
        player.xpNext = 8 + player.level * 4;
        player.maxHp += 12; player.hp = Math.min(player.maxHp, player.hp + 25);
        player.dmg += 2; player.speed += 6;
        burst(player.x, player.y, "#38e1a0", 18);
        toast("⬆️ Niveau " + player.level + " !");
        sfx.level();
      }
    }
  }

  // --- particules / slash ---
  for (let i = S.parts.length - 1; i >= 0; i--) {
    const p = S.parts[i];
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.t >= p.life) S.parts.splice(i, 1);
  }
  for (let i = S.slashes.length - 1; i >= 0; i--) {
    S.slashes[i].t -= dt;
    if (S.slashes[i].t <= 0) S.slashes.splice(i, 1);
  }
  if (S.glitchT > 0) S.glitchT -= dt;
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    S.shakeX = (Math.random() - 0.5) * 14;
    S.shakeY = (Math.random() - 0.5) * 14;
  } else { S.shakeX = 0; S.shakeY = 0; }

  // --- HUD ---
  ui.hpFill.style.width = (player.hp / player.maxHp * 100) + "%";
  ui.hpText.textContent = Math.ceil(player.hp) + "/" + player.maxHp + " HP";
  ui.xpFill.style.width = (player.xp / player.xpNext * 100) + "%";
  ui.xpText.textContent = "Nv " + player.level + " • " + player.xp + "/" + player.xpNext + " XP";
  ui.score.textContent = String(S.score);
  ui.kills.textContent = String(S.kills);
  ui.time.textContent = fmtTime(S.time);
}

function killBoss() {
  const b = S.boss;
  if (!b) return;
  burst(b.x, b.y, "#ffcc00", 40);
  S.score += 2000; S.kills++;
  for (let i = 0; i < 15; i++) S.gems.push({ x: b.x + (Math.random() - 0.5) * 60, y: b.y + (Math.random() - 0.5) * 60, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, r: 6, t: 0 });
  S.boss = null;
  ui.bossBar.classList.add("hidden");
  toast("👑 BOSS vaincu ! +2000");
}

// ---------- Rendu : traînées fluides (fade) + glitch ----------
function render(dt) {
  // traînée : voile semi-transparent au lieu d'effacer
  ctx.save();
  ctx.translate(S.shakeX, S.shakeY);
  ctx.fillStyle = "rgba(8,10,20,0.28)";
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // grille arène (discrète, redessinée chaque frame)
  ctx.strokeStyle = "rgba(124,92,255,0.12)";
  ctx.lineWidth = 1;
  const step = 44;
  ctx.beginPath();
  for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // bordure
  ctx.strokeStyle = "rgba(124,92,255,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  const glitch = S.glitchT > 0;
  const jx = glitch ? (Math.random() - 0.5) * 10 : 0;

  // gemmes
  for (const g of S.gems) {
    ctx.fillStyle = "#38e1a0";
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.t * 3);
    const s = g.r;
    ctx.fillRect(-s / 1.6, -s / 1.6, s * 1.25, s * 1.25);
    ctx.restore();
  }
  // projectiles
  for (const p of S.bullets) {
    ctx.fillStyle = p.boss ? "#ff2266" : "#4db8ff";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
  }
  // ennemis (avec traînée naturelle du fade)
  for (const e of S.enemies) drawFighter(e.x + jx, e.y, e.r, e.color, e.kind === "shooter" ? "◆" : e.kind === "tank" ? "■" : "●");
  // boss
  if (S.boss) {
    const b = S.boss;
    drawFighter(b.x + jx, b.y, b.r, b.color, "👹", true);
    ctx.fillStyle = "#fff";
    ctx.font = "20px system-ui";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("👹", b.x, b.y);
  }
  // joueur : cercle + lame orientée ; RGB split si glitch
  if (S.state !== "over") {
    if (glitch) {
      ctx.globalAlpha = 0.8;
      drawPlayer(player.x - 6, player.y, "#ff0033");
      drawPlayer(player.x + 6, player.y, "#00e5ff");
      ctx.globalAlpha = 1;
    }
    drawPlayer(player.x, player.y, "#ffffff");
  }
  // slash
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  for (const s of S.slashes) {
    ctx.globalAlpha = Math.max(0, s.t / 0.12);
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // particules
  for (const p of S.parts) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
function drawPlayer(x, y, core) {
  // anneau + lame
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#1b2450";
  ctx.strokeStyle = "#7c5cff"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, player.r, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
  // lame orientée
  ctx.rotate(player.angle);
  ctx.fillStyle = "#cfe0ff";
  ctx.fillRect(player.r - 2, -3, 20, 6);
  ctx.fillStyle = "#7c5cff";
  ctx.fillRect(player.r + 12, -5, 8, 10);
  ctx.restore();
}
function drawFighter(x, y, r, color, glyph, isBoss) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = isBoss ? 4 : 2.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------- Flow : rideau + score détaillé ----------
function rideauThen(fn) {
  ui.rideau.classList.add("closed");
  setTimeout(() => { fn(); setTimeout(() => ui.rideau.classList.remove("closed"), 350); }, 650);
}
function startGame() {
  rideauThen(() => {
    S.state = "playing"; S.paused = false;
    S.time = 0; S.score = 0; S.kills = 0;
    S.enemies = []; S.gems = []; S.parts = []; S.bullets = []; S.slashes = [];
    S.boss = null; S.glitchT = 0; S.shakeT = 0;
    player.x = W / 2; player.y = H / 2;
    player.maxHp = 100; player.hp = 100; player.level = 1;
    player.xp = 0; player.xpNext = 10; player.dmg = 12; player.speed = 230; player.atkCd = 0;
    ui.bossBar.classList.add("hidden");
    ui.menu.classList.add("hidden");
    ui.gameover.classList.add("hidden");
    ui.pauseOverlay.classList.add("hidden");
    ui.btnPause.textContent = "⏸️";
    startWave(1);
    // fond opaque propre au démarrage
    ctx.fillStyle = "#080a14";
    ctx.fillRect(0, 0, W, H);
  });
}
function gameOver() {
  if (S.state !== "playing") return;
  S.state = "over";
  sfx.over();
  burst(player.x, player.y, "#ffffff", 30);
  const best = getBest();
  const isBest = S.score > best;
  if (isBest) setBest(S.score);
  rideauThen(() => {
    ui.scoreDetail.innerHTML =
      cell("⭐ Score", S.score) + cell("🌊 Vague", S.wave) +
      cell("💀 Kills", S.kills) + cell("⏱️ Temps", fmtTime(S.time)) +
      cell("⬆️ Niveau", player.level) + cell("🏆 Record", Math.max(best, S.score));
    ui.newBest.classList.toggle("hidden", !isBest);
    ui.gameover.classList.remove("hidden");
    ui.menuBest.textContent = "Meilleur score : " + Math.max(best, S.score);
  });
}
function cell(label, val) {
  return `<div class="cell"><small>${label}</small><b>${val}</b></div>`;
}
function togglePause() {
  if (S.state !== "playing") return;
  S.paused = !S.paused;
  ui.pauseOverlay.classList.toggle("hidden", !S.paused);
  ui.btnPause.textContent = S.paused ? "▶️" : "⏸️";
}
function toggleSound() {
  soundOn = !soundOn;
  ui.btnSound.textContent = soundOn ? "🔊" : "🔇";
}

// ---------- Boutons ----------
ui.btnPlay.addEventListener("click", startGame);
ui.btnReplay.addEventListener("click", startGame);
ui.btnMenu.addEventListener("click", () => {
  rideauThen(() => {
    S.state = "menu";
    ui.gameover.classList.add("hidden");
    ui.menu.classList.remove("hidden");
  });
});
ui.btnPause.addEventListener("click", togglePause);
ui.btnResume.addEventListener("click", togglePause);
ui.btnSound.addEventListener("click", toggleSound);

// ---------- Init ----------
resize();
setupJoystick();
ui.menuBest.textContent = "Meilleur score : " + getBest();
ui.wave.textContent = "1";
requestAnimationFrame(loop);
