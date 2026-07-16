/* ============================================================
   SPLASH SIEGE
   Water balloons fall from the sky. Shoot them before they land,
   or the water grows plants that wall you in — and if a plant
   reaches the top of the screen, the garden wins.
   Chainsaw balloons drop saws: grab one and walk into a plant
   to cut it down and buy yourself time. Six levels. Keep score.
   ============================================================ */

(() => {
  'use strict';

  // ---------- Canvas & constants ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 480
  const H = canvas.height;  // 720

  const GROUND_Y = H - 44;        // top of the soil band
  const TOP_MARGIN = 56;          // plants reaching here = game over
  const LOW_LINE = GROUND_Y - 150; // pop below this line → half splash
  const LANES = 10;
  const LANE_W = W / LANES;
  const MAX_PLANT = GROUND_Y - TOP_MARGIN;
  const WARN_H = Math.round(MAX_PLANT * 0.20); // plants turn brown here; bullets can chip them
  const CUT_MIN = 16;                          // smallest plant a saw will bother cutting

  // ---------- Level design: each level tightens every screw ----------
  // spawn: seconds between balloons | fall: px/s | target: pops to clear
  // growth: px of plant per landed balloon | sawChance: chainsaw balloons
  // splashSpread: neighbours also get watered (later levels only)
  // volley: chance a spawn brings a 2nd balloon in a far lane (3rd from L4 at half chance)
  // menace: chance a balloon targets the tallest plant's lane — the garden fights back
  const LEVELS = [
    { spawn: 1.05, fall: 95,  target: 15, growth: 55,  sawChance: 0.20, splashSpread: 0.00, volley: 0.25, menace: 0.10 },
    { spawn: 0.90, fall: 112, target: 20, growth: 66,  sawChance: 0.17, splashSpread: 0.00, volley: 0.35, menace: 0.18 },
    { spawn: 0.78, fall: 130, target: 26, growth: 78,  sawChance: 0.14, splashSpread: 0.15, volley: 0.45, menace: 0.26 },
    { spawn: 0.66, fall: 150, target: 32, growth: 92,  sawChance: 0.12, splashSpread: 0.20, volley: 0.55, menace: 0.34 },
    { spawn: 0.56, fall: 172, target: 38, growth: 108, sawChance: 0.10, splashSpread: 0.25, volley: 0.65, menace: 0.42 },
    { spawn: 0.46, fall: 198, target: 45, growth: 126, sawChance: 0.08, splashSpread: 0.30, volley: 0.75, menace: 0.50 },
  ];

  const BALLOON_COLORS = ['#ff5d73', '#4cc9f0', '#ffd166', '#b388eb', '#7ae582'];

  // ---------- State ----------
  let state = 'menu'; // menu | playing | over
  let level, pops, score, best = 0, username = 'anonymous';
  let player, balloons, bullets, saws, particles, plants, floaters;
  let spawnTimer, gunCooldown, cutCooldown, banner, shake, elapsed, streak;
  let won = false;
  const keys = new Set();
  let touchShoot = false;

  // ---------- Sound: tiny synthesized SFX via Web Audio ----------
  let audioCtx = null;
  let muted = false;
  let noiseBuf = null;
  function ac() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function noise(ctx) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }
  function tone(ctx, type, f0, f1, dur, vol, t0) {
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    gn.gain.setValueAtTime(vol, t0);
    gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(gn).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sfx(name) {
    if (muted) return;
    try {
      const ctx = ac();
      if (!ctx) return;
      const t = ctx.currentTime;
      if (name === 'shoot') {
        tone(ctx, 'triangle', 880, 300, 0.07, 0.12, t);
      } else if (name === 'pop') {
        tone(ctx, 'sine', 620, 90, 0.09, 0.3, t);
        const n = noise(ctx), g2 = ctx.createGain(), hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1800;
        g2.gain.setValueAtTime(0.25, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        n.connect(hp).connect(g2).connect(ctx.destination);
        n.start(t); n.stop(t + 0.07);
      } else if (name === 'splash') {
        const n = noise(ctx), g2 = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2200, t);
        lp.frequency.exponentialRampToValueAtTime(240, t + 0.28);
        g2.gain.setValueAtTime(0.3, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        n.connect(lp).connect(g2).connect(ctx.destination);
        n.start(t); n.stop(t + 0.32);
      } else if (name === 'saw') {
        tone(ctx, 'sawtooth', 180, 70, 0.22, 0.22, t);
        tone(ctx, 'sawtooth', 187, 74, 0.22, 0.14, t); // detuned pair = mechanical growl
        const n = noise(ctx), g2 = ctx.createGain(), bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
        g2.gain.setValueAtTime(0.14, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        n.connect(bp).connect(g2).connect(ctx.destination);
        n.start(t); n.stop(t + 0.22);
      }
    } catch { /* audio is decoration — never let it break the game */ }
  }

  // ---------- Daily challenge: seeded RNG drives all spawn decisions ----------
  let mode = 'classic';
  let roll = Math.random; // reseeded from the date for daily runs
  const todayKey = () => new Date().toISOString().slice(0, 10);
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rrand = (a, b) => a + roll() * (b - a);

  function resetGame() {
    level = 0; pops = 0; score = 0; elapsed = 0; won = false;
    player = { x: W / 2, w: 36, h: 34, speed: 250 , saw: 0, facing: 1 };
    balloons = []; bullets = []; saws = []; particles = []; floaters = []; streak = 0;
    plants = new Array(LANES).fill(0);
    spawnTimer = 1; gunCooldown = 0; cutCooldown = 0; shake = 0;
    banner = { text: 'LEVEL 1', t: 2 };
  }

  // ---------- Helpers ----------
  const cfg = () => LEVELS[level];
  const laneOf = (x) => Math.max(0, Math.min(LANES - 1, Math.floor(x / LANE_W)));
  const laneCenter = (i) => i * LANE_W + LANE_W / 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  function burst(x, y, color, n, spread, gravity) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: rand(-spread, spread), vy: rand(-spread, spread * 0.4),
        g: gravity, r: rand(2, 4.5), color, life: rand(0.35, 0.8),
      });
    }
  }

  function floatText(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 0.9 });
    if (floaters.length > 12) floaters.shift();
  }

  function growPlant(lane, amount) {
    if (amount <= 0) return;
    plants[lane] = Math.min(MAX_PLANT + 4, plants[lane] + amount);
    const s = cfg().splashSpread;
    if (s > 0) {
      if (lane > 0) plants[lane - 1] = Math.min(MAX_PLANT + 4, plants[lane - 1] + amount * s);
      if (lane < LANES - 1) plants[lane + 1] = Math.min(MAX_PLANT + 4, plants[lane + 1] + amount * s);
    }
    if (plants.some((h) => h >= MAX_PLANT)) endGame(false);
  }

  // ---------- Spawning ----------
  function spawnBalloon(awayFrom = -1) {
    let lane = Math.floor(roll() * LANES);
    // The garden is greedy: some balloons aim for the tallest plant.
    // Both rolls are always consumed so daily-seed streams stay in sync.
    const menaceRoll = roll(), offsetRoll = roll();
    if (menaceRoll < cfg().menace) {
      let tall = 0;
      for (let i = 1; i < LANES; i++) if (plants[i] > plants[tall]) tall = i;
      if (plants[tall] > 0) lane = Math.max(0, Math.min(LANES - 1, tall + (Math.floor(offsetRoll * 3) - 1)));
    }
    if (awayFrom >= 0) {
      // Volley partner lands far away, so saving both is a real choice.
      const far = [];
      for (let i = 0; i < LANES; i++) if (Math.abs(i - awayFrom) >= 3) far.push(i);
      lane = far[Math.floor(roll() * far.length)];
    }
    balloons.push({
      x: laneCenter(lane) + rrand(-8, 8),
      y: -30,
      r: rrand(15, 20),
      vy: cfg().fall * rrand(0.8, 1.35),
      swayA: rrand(6, 16), swayF: rrand(1.2, 2.4), swayP: rrand(0, 6.28),
      color: BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)], // cosmetic only
      saw: roll() < cfg().sawChance,
    });
    return lane;
  }

  // ---------- Actions ----------
  function shoot() {
    if (state !== 'playing' || gunCooldown > 0) return;
    gunCooldown = 0.26;
    sfx('shoot');
    bullets.push({ x: player.x, y: GROUND_Y - player.h - 6, vy: -540 });
  }

  function popBalloon(b, byBullet) {
    balloons.splice(balloons.indexOf(b), 1);
    sfx('pop');
    pops++;
    const mult = streak >= 10 ? 3 : streak >= 5 ? 2 : 1;
    const pts = (b.saw ? 15 : 10) * mult;
    score += pts;
    streak++;
    floatText(b.x, b.y, '+' + pts + (mult > 1 ? ' \u00d7' + mult : ''), '#ffd166');
    burst(b.x, b.y, b.color, 14, 130, 260);
    burst(b.x, b.y, '#bfe8ff', 10, 110, 320);
    if (b.saw) saws.push({ x: b.x, y: b.y, vy: 150, ttl: -1 });
    // A low pop still douses the ground with half the water.
    if (byBullet && b.y > LOW_LINE) growPlant(laneOf(b.x), cfg().growth * 0.5);
    if (pops >= cfg().target) nextLevel();
  }

  function nextLevel() {
    score += 100 * (level + 1);
    floatText(W / 2, H / 2 + 34, '+' + 100 * (level + 1), '#f2e3c6');
    if (level >= LEVELS.length - 1) { endGame(true); return; }
    level++; pops = 0;
    // A short breather: the storm pauses and every plant wilts a little.
    plants = plants.map((h) => h * 0.94);
    banner = { text: 'LEVEL ' + (level + 1), t: 2 };
    spawnTimer = 1.4;
  }

  function cutPlant(lane) {
    player.saw--;
    cutCooldown = 0.35;
    sfx('saw');
    const clutch = plants[lane] >= MAX_PLANT * 0.75;
    score += clutch ? 100 : 25;
    floatText(laneCenter(lane), GROUND_Y - plants[lane] - 12,
      clutch ? 'CLUTCH! +100' : '+25', clutch ? '#ff5d73' : '#7ae582');
    burst(laneCenter(lane), GROUND_Y - plants[lane] * 0.5, '#57a96b', 16, 150, 300);
    burst(laneCenter(lane), GROUND_Y - 20, '#8a6b3f', 8, 120, 300);
    plants[lane] = 0;
    shake = clutch ? 0.45 : 0.2;
  }

  function endGame(didWin) {
    if (state !== 'playing') return;
    state = 'over';
    won = didWin;
    if (didWin) score += 250; // clearing all six levels
    showOverScreen();
    submitScore(score);
  }

  // ---------- Update ----------
  function update(dt) {
    elapsed += dt;
    gunCooldown = Math.max(0, gunCooldown - dt);
    cutCooldown = Math.max(0, cutCooldown - dt);
    shake = Math.max(0, shake - dt);
    if (banner.t > 0) banner.t -= dt;

    // Player movement, walled in by grown plants
    let dir = 0;
    if (keys.has('ArrowLeft') || keys.has('a')) dir -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) dir += 1;
    if (dir !== 0) player.facing = dir;
    let nx = player.x + dir * player.speed * dt;

    const half = player.w / 2;
    player.x = Math.max(half, Math.min(W - half, nx));

    // Holding a saw? Walking over (or standing on) a plant cuts it down.
    const pl = laneOf(player.x);
    if (player.saw > 0 && cutCooldown <= 0 && plants[pl] >= CUT_MIN) cutPlant(pl);

    if (touchShoot || keys.has(' ')) shoot();

    // Balloons
    if (banner.t <= 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        const first = spawnBalloon();
        const v1 = roll(), v2 = roll();
        if (v1 < cfg().volley) spawnBalloon(first);
        if (level >= 3 && v2 < cfg().volley * 0.5) spawnBalloon(first);
        spawnTimer = cfg().spawn * rrand(0.8, 1.2);
      }
    }
    for (const b of [...balloons]) {
      b.y += b.vy * dt;
      b.x += Math.cos(elapsed * b.swayF + b.swayP) * b.swayA * dt;
      b.x = Math.max(b.r, Math.min(W - b.r, b.x));
      if (b.y + b.r >= GROUND_Y) {
        sfx('splash');
        balloons.splice(balloons.indexOf(b), 1);
        burst(b.x, GROUND_Y - 4, '#bfe8ff', 18, 150, 300);
        growPlant(laneOf(b.x), cfg().growth);
        if (b.saw) burst(b.x, GROUND_Y - 10, '#9aa0a6', 6, 90, 300); // the saw sinks into the mud
        shake = Math.max(shake, 0.12);
      }
    }

    // Bullets
    for (const p of [...bullets]) {
      p.y += p.vy * dt;
      if (p.y < -10) { bullets.splice(bullets.indexOf(p), 1); streak = 0; continue; }
      let hit = false;
      for (const b of balloons) {
        const dx = b.x - p.x, dy = b.y - p.y;
        if (dx * dx + dy * dy < (b.r + 5) * (b.r + 5)) {
          bullets.splice(bullets.indexOf(p), 1);
          popBalloon(b, true);
          hit = true;
          break;
        }
      }
      if (hit) continue;
      // Shots chip away at brown (dangerous) plants — slow, but it works.
      for (let i = 0; i < LANES; i++) {
        if (plants[i] < WARN_H) continue;
        if (Math.abs(p.x - laneCenter(i)) < 16 && p.y >= GROUND_Y - plants[i]) {
          bullets.splice(bullets.indexOf(p), 1);
          streak = 0;
          plants[i] = Math.max(0, plants[i] - 14);
          burst(p.x, p.y, '#57a96b', 6, 90, 260);
          break;
        }
      }
    }

    // Falling / landed chainsaws
    for (const s of [...saws]) {
      if (s.ttl < 0) {
        s.y += s.vy * dt;
        if (s.y >= GROUND_Y - 12) { s.y = GROUND_Y - 12; s.ttl = 6; }
      } else {
        s.ttl -= dt;
        if (s.ttl <= 0) { saws.splice(saws.indexOf(s), 1); continue; }
      }
      if (Math.abs(s.x - player.x) < 30 && s.y > GROUND_Y - player.h - 26) {
        saws.splice(saws.indexOf(s), 1);
        player.saw = Math.min(9, player.saw + 3);
        score += 5;
        floatText(player.x, GROUND_Y - player.h - 16, '+3 cuts', '#ffd166');
        burst(player.x, GROUND_Y - player.h, '#ffd166', 10, 120, 260);
      }
    }

    // Particles
    for (const p of [...particles]) {
      p.life -= dt;
      if (p.life <= 0) { particles.splice(particles.indexOf(p), 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    // Floating score text drifts up and fades
    for (const f of [...floaters]) {
      f.life -= dt; f.y -= 34 * dt;
      if (f.life <= 0) floaters.splice(floaters.indexOf(f), 1);
    }

    updateHud();
  }

  // ---------- Drawing ----------
  function skyColor() {
    // The dusk deepens as the levels climb.
    const t = level / (LEVELS.length - 1);
    const mix = (a, b) => Math.round(a + (b - a) * t);
    return {
      top: `rgb(${mix(43, 20)},${mix(54, 24)},${mix(92, 56)})`,
      bot: `rgb(${mix(110, 74)},${mix(127, 84)},${mix(178, 128)})`,
    };
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-4, 4) * shake * 5, rand(-4, 4) * shake * 5);

    // Sky
    const sky = skyColor();
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, sky.top);
    g.addColorStop(1, sky.bot);
    ctx.fillStyle = g;
    ctx.fillRect(-8, -8, W + 16, H + 16);

    // Danger line — a clothesline with little warning flags
    ctx.strokeStyle = 'rgba(242,227,198,0.5)';
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(0, TOP_MARGIN); ctx.lineTo(W, TOP_MARGIN); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,93,115,0.7)';
    for (let x = 24; x < W; x += 96) {
      ctx.beginPath();
      ctx.moveTo(x, TOP_MARGIN); ctx.lineTo(x + 12, TOP_MARGIN + 5); ctx.lineTo(x, TOP_MARGIN + 10);
      ctx.fill();
    }

    // Soil
    ctx.fillStyle = '#4a3524';
    ctx.fillRect(-8, GROUND_Y, W + 16, H - GROUND_Y + 8);
    ctx.fillStyle = '#3a5a34';
    for (let x = 0; x < W; x += 10) ctx.fillRect(x, GROUND_Y - 3, 6, 5);

    drawPlants();
    for (const s of saws) drawSaw(s);
    drawPlayer();
    for (const p of bullets) { ctx.fillStyle = '#f2e3c6'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill(); }
    for (const b of balloons) drawBalloon(b);
    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      ctx.globalAlpha = 1;
    }
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.fillStyle = f.color;
      ctx.font = 'bold 17px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    // Menu ambience: decorative balloons drift down behind the start screen
    if (state === 'menu') {
      const t = performance.now() / 1000;
      for (let i = 0; i < 4; i++) {
        const x = ((i * 131 + 60) % (W - 80)) + 40 + Math.sin(t * (0.6 + i * 0.2) + i * 2) * 14;
        const y = ((t * (26 + i * 9) + i * 240) % (H + 120)) - 60;
        const r = 14 + (i % 3) * 3;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = BALLOON_COLORS[i % BALLOON_COLORS.length];
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.85, r, 0, 0, 6.29); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.25, r * 0.32, 0, 0, 6.29); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Level banner
    if (banner.t > 0 && state === 'playing') {
      ctx.globalAlpha = Math.min(1, banner.t);
      ctx.fillStyle = '#f2e3c6';
      ctx.font = 'bold 44px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(banner.text, W / 2, H / 2 - 40);
      ctx.font = '16px "Courier New", monospace';
      ctx.fillText('pop ' + cfg().target + ' balloons', W / 2, H / 2 - 12);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawPlants() {
    for (let i = 0; i < LANES; i++) {
      const h = plants[i];
      if (h < 4) continue;
      const x = laneCenter(i);
      const danger = h / MAX_PLANT;
      const stem = danger > 0.75 ? '#5c4326' : h >= WARN_H ? '#8a6b3f' : '#57a96b';
      ctx.strokeStyle = stem;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y);
      const segs = Math.max(2, Math.floor(h / 26));
      for (let s = 1; s <= segs; s++) {
        const sy = GROUND_Y - (h * s) / segs;
        const sx = x + Math.sin(s * 1.7 + i) * 7;
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      // Leaves
      ctx.fillStyle = stem;
      for (let s = 1; s < segs; s++) {
        const sy = GROUND_Y - (h * s) / segs;
        const side = s % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.ellipse(x + side * 12, sy, 10, 5, side * 0.5, 0, 7);
        ctx.fill();
      }
      // Bud — turns red as it nears the sky
      ctx.fillStyle = danger > 0.75 ? '#ff5d73' : '#7ae582';
      ctx.beginPath();
      ctx.arc(x + Math.sin(segs * 1.7 + i) * 7, GROUND_Y - h, 8, 0, 7);
      ctx.fill();
    }
  }

  function drawBalloon(b) {
    // String + knot
    ctx.strokeStyle = 'rgba(242,227,198,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(b.x, b.y + b.r); ctx.lineTo(b.x, b.y + b.r + 14); ctx.stroke();
    // Body
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.ellipse(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.22, b.r * 0.32, -0.4, 0, 7); ctx.fill();
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.moveTo(b.x - 4, b.y + b.r); ctx.lineTo(b.x + 4, b.y + b.r); ctx.lineTo(b.x, b.y + b.r - 5); ctx.fill();
    if (b.saw) drawSaw({ x: b.x, y: b.y + b.r + 20 });
  }

  function drawSaw(s) {
    if (s.ttl >= 0 && s.ttl < 2 && Math.floor(s.ttl * 8) % 2 === 0) return; // blink before vanishing
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = '#e0862f';                       // motor housing
    ctx.fillRect(-12, -6, 12, 12);
    ctx.fillStyle = '#9aa0a6';                       // blade
    ctx.fillRect(0, -3, 18, 6);
    ctx.fillStyle = '#6b7076';                       // teeth
    for (let t = 2; t < 18; t += 5) ctx.fillRect(t, -5, 3, 2);
    ctx.restore();
  }

  function drawPlayer() {
    const x = player.x, y = GROUND_Y;
    ctx.save();
    ctx.translate(x, y);
    // Body + overalls
    ctx.fillStyle = '#4cc9f0';
    ctx.fillRect(-10, -26, 20, 18);
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath(); ctx.arc(0, -30, 8, 0, 7); ctx.fill();
    ctx.fillStyle = '#e0862f'; // sun hat
    ctx.fillRect(-11, -38, 22, 4);
    ctx.fillRect(-6, -43, 12, 6);
    // Boots
    ctx.fillStyle = '#4a3524';
    ctx.fillRect(-10, -8, 8, 8);
    ctx.fillRect(2, -8, 8, 8);
    // Pop-gun barrel
    ctx.fillStyle = '#8a6b3f';
    ctx.fillRect(-3, -52, 6, 14);
    // Saw in hand
    if (player.saw > 0) drawSaw({ x: player.facing * 16, y: -18 });
    ctx.restore();
  }

  // ---------- HUD / screens ----------
  const $ = (id) => document.getElementById(id);
  let hudCache = '';
  function updateHud() {
    const mult = streak >= 10 ? 3 : streak >= 5 ? 2 : 1;
    const text = `${score}|${level}|${pops}|${player.saw}|${mult}`;
    if (text === hudCache) return;
    hudCache = text;
    $('hud-score').textContent = mult > 1 ? `${score} \u00d7${mult}` : score;
    $('hud-level').textContent = `${level + 1}/6`;
    $('hud-pops').textContent = `${pops}/${cfg().target}`;
    $('hud-saw').textContent = player.saw > 0 ? '🪚 ' + player.saw : '–';
  }

  function showOverScreen() {
    $('hud').hidden = true;
    $('over-title').textContent = won ? 'You beat the storm' : 'The garden won';
    $('over-sub').textContent = won
      ? 'Six levels, one dry gardener. The sky is out of balloons.'
      : 'A plant touched the sky. Somewhere, a balloon giggles.';
    $('final-score').textContent = score;
    $('final-level').textContent = level + 1;
    $('btn-retry').textContent = mode === 'daily' ? "Retry today's challenge" : 'Play again';
    $('screen-over').hidden = false;
    loadLeaderboard();
  }

  // ---------- Server (best scores live in Redis via the Devvit server) ----------
  async function initPlayer() {
    try {
      const r = await fetch('/api/init');
      const d = await r.json();
      username = d.username; best = d.best || 0;
      if (best > 0) {
        $('best-line').hidden = false;
        $('best-line').textContent = `${username} — personal best ${best}`;
      }
    } catch { /* playing outside Reddit: score just isn't saved */ }
  }

  async function submitScore(s) {
    try {
      const r = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: s, mode }),
      });
      const d = await r.json();
      if (d.best) best = d.best;
    } catch { /* offline */ }
  }

  async function loadLeaderboard() {
    const el = $('leaderboard');
    el.innerHTML = '';
    try {
      const r = await fetch('/api/leaderboard?mode=' + mode);
      const d = await r.json();
      if (!d.top || d.top.length === 0) return;
      const title = mode === 'daily' ? "Today's top gardeners" : 'Top gardeners';
      el.innerHTML =
        `<div class="lb-title">${title}</div><ol>` +
        d.top
          .map((e, i) => `<li><span class="rank">${i + 1}.</span>${escapeHtml(e.member)} — ${e.score}</li>`)
          .join('') +
        '</ol>' +
        (d.rank ? `<div class="lb-title">You: #${d.rank} of ${d.players} today</div>` : '');
    } catch { /* offline */ }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Input ----------
  addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (e.key === ' ') shoot();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));

  canvas.addEventListener('pointerdown', () => { if (state === 'playing') shoot(); });

  function bindHold(id, key) {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add(key); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
      el.addEventListener(ev, () => keys.delete(key));
  }
  bindHold('t-left', 'ArrowLeft');
  bindHold('t-right', 'ArrowRight');
  $('t-shoot').addEventListener('pointerdown', (e) => { e.preventDefault(); touchShoot = true; shoot(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
    $('t-shoot').addEventListener(ev, () => (touchShoot = false));

  if (matchMedia('(pointer: coarse)').matches) $('touch-controls').hidden = false;

  $('btn-mute').addEventListener('click', () => {
    muted = !muted;
    $('btn-mute').textContent = muted ? '\u{1F507}' : '\u{1F50A}';
  });
  $('btn-start').addEventListener('click', () => startGame('classic'));
  $('btn-daily').addEventListener('click', () => startGame('daily'));
  $('btn-retry').addEventListener('click', () => startGame(mode));
  $('btn-daily').textContent = 'Daily Challenge \u00b7 ' +
    new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function startGame(m) {
    ac(); // unlock audio inside the user gesture
    mode = m === 'daily' ? 'daily' : 'classic';
    roll = mode === 'daily' ? mulberry32(Number(todayKey().replace(/-/g, ''))) : Math.random;
    resetGame();
    $('screen-start').hidden = true;
    $('screen-over').hidden = true;
    $('hud').hidden = false;
    hudCache = '';
    state = 'playing';
  }

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  initPlayer();
  resetGame();
  requestAnimationFrame(frame);
})();
