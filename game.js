// 安全型 SafeStorage 包裝，解決 Sandbox 環境中存取 localStorage 的 SecurityError
const SafeStorage = {
    memoryStore: {},
    getItem(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            return this.memoryStore[key] || null;
        }
    },
    setItem(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (e) {
            this.memoryStore[key] = String(value);
        }
    }
};

// 模擬與 REST/雲端排行榜 API 的非同步連線 (帶 fallback)
const LeaderboardAPI = {
    async fetchTopScores() {
        try {
            // 嘗試從 SafeStorage 讀取快取
            const data = SafeStorage.getItem('slime_tetris_top5');
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {}
        
        // 預設預設排行榜資料
        const defaultScores = [
            { name: '史萊姆王', score: 5000 },
            { name: '波利', score: 3200 },
            { name: '阿碼', score: 2400 },
            { name: '小橘', score: 1500 },
            { name: '新手', score: 800 }
        ];
        SafeStorage.setItem('slime_tetris_top5', JSON.stringify(defaultScores));
        return defaultScores;
    },

    async submitScore(name, score) {
        const list = await this.fetchTopScores();
        list.push({ name: name || '無名氏', score: Math.floor(score) });
        list.sort((a, b) => b.score - a.score);
        const top5 = list.slice(0, 5);
        SafeStorage.setItem('slime_tetris_top5', JSON.stringify(top5));
        return top5;
    }
};

// ---------------- 音效（Web Audio 即時合成，不需要音檔） ----------------
class SlimeSFX {
    constructor() {
        this.ctx = null;
        this.muted = SafeStorage.getItem('slime_sfx_muted') === '1';
        const unlock = () => { this.ensure(); };
        ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
    }
    ensure() {
        if (this.muted) return null;
        try {
            if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.ctx.state === 'suspended') this.ctx.resume();
        } catch (e) { return null; }
        return this.ctx;
    }
    setMuted(m) { this.muted = m; SafeStorage.setItem('slime_sfx_muted', m ? '1' : '0'); }
    tone(freq, dur, { type = 'sine', vol = 0.18, slide = 0, delay = 0 } = {}) {
        const ctx = this.ensure(); if (!ctx) return;
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn).connect(ctx.destination);
        o.start(t); o.stop(t + dur + 0.02);
    }
    // 消除：行數越多音階越高越華麗，連擊會整體升調
    clear(lines, combo) {
        const up = Math.pow(2, Math.min(combo - 1, 8) / 12);
        const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        const n = Math.min(lines + 1, 5);
        for (let i = 0; i < n; i++) this.tone(scale[i] * up, 0.16, { type: 'triangle', vol: 0.16, delay: i * 0.055 });
        this.tone(220 * up, 0.12, { type: 'sine', vol: 0.12, slide: 2.2 }); // 「啵」的 Q 彈感
        if (lines >= 4) {
            [1046.5, 1318.5, 1568].forEach((f) => this.tone(f * up, 0.45, { type: 'sine', vol: 0.1, delay: 0.3 }));
        }
    }
    land() { this.tone(180, 0.07, { type: 'sine', vol: 0.09, slide: 0.6 }); }
    blackhole() { this.tone(400, 0.6, { type: 'sine', vol: 0.12, slide: 0.15 }); this.tone(800, 0.5, { type: 'triangle', vol: 0.05, slide: 0.1, delay: 0.05 }); }
    purify() { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.tone(f, 0.1, { type: 'sine', vol: 0.07, delay: 0.15 + i * 0.05 })); }
    levelUp() { [659.25, 880, 1174.7].forEach((f, i) => this.tone(f, 0.12, { type: 'square', vol: 0.06, delay: i * 0.07 })); }
    bomb() { this.tone(90, 0.35, { type: 'sawtooth', vol: 0.14, slide: 0.4 }); this.tone(60, 0.4, { type: 'square', vol: 0.06, slide: 0.5, delay: 0.03 }); }
    melt() { this.tone(900, 0.14, { type: 'sine', vol: 0.08, slide: 0.45 }); }
    zombie() { [196, 185, 174.6].forEach((f, i) => this.tone(f, 0.22, { type: 'sawtooth', vol: 0.06, delay: i * 0.12 })); }
    crack() { this.tone(1400, 0.05, { type: 'square', vol: 0.06 }); this.tone(700, 0.08, { type: 'square', vol: 0.05, delay: 0.04 }); }
    hardDrop() { this.tone(140, 0.12, { type: 'triangle', vol: 0.2, slide: 0.45 }); }
    rotate() { this.tone(880, 0.04, { type: 'square', vol: 0.03 }); }
    garbage() { this.tone(110, 0.25, { type: 'sawtooth', vol: 0.08, slide: 0.7 }); }
    attack() { this.tone(660, 0.12, { type: 'square', vol: 0.05, slide: 1.6 }); }
    countdown(go) { this.tone(go ? 1046.5 : 659.25, go ? 0.3 : 0.12, { type: 'triangle', vol: 0.15 }); }
    win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.15, delay: i * 0.11 })); }
    lose() { [392, 329.6, 261.6, 196].forEach((f, i) => this.tone(f, 0.25, { type: 'sine', vol: 0.13, delay: i * 0.14 })); }
}

// 可重現的亂數（PK 雙方用同一個種子 → 拿到一模一樣的方塊順序）
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class SlimeTetris {
    /**
     * opts（皆為選填，單人模式不需要）：
     *  seed        PK 共用種子
     *  onClear(cleared, combo)  消行時回呼（用來計算攻擊）
     *  onGameOver(game)         堆到頂時回呼；有提供時不顯示單人結束畫面
     *  minLevel()               回傳目前最低速度等級（生存 PK 隨時間加速）
     *  pvp                      PK 模式：停用暫停
     */
    constructor(opts = {}) {
        this.opts = opts;
        this.rng = typeof opts.seed === 'number' ? mulberry32(opts.seed) : Math.random;
        this.garbageRng = typeof opts.seed === 'number' ? mulberry32(opts.seed ^ 0x9E3779B9) : Math.random;
        this.pendingGarbage = 0;   // 待收的垃圾行
        this.pendingHard = 0;      // 其中幾行是硬殼垃圾（特殊模式 PK）
        // 特殊史萊姆模式：約每 9 塊出現 1 個特殊史萊姆（PK 用共同種子，雙方同時同位置出現）
        this.special = !!opts.special;
        this.specialRng = typeof opts.seed === 'number' ? mulberry32(opts.seed ^ 0x51ED5EED) : Math.random;
        this.SPECIAL_RATE = 1 / 9;
        this.SPECIAL_KINDS = [['star', 0.27], ['bomb', 0.23], ['melt', 0.18], ['zombie', 0.22], ['blackhole', 0.10]];
        this.clearMods = null;
        this.sfx = window.__slimeSfx || (window.__slimeSfx = new SlimeSFX());
        // 方向鍵長按：鍵盤 / 觸控分開設定（DAS＝開始連續移動前的等待，ARR＝之後每格間隔，毫秒）
        this.TIMING = { key: { das: 150, arr: 55 }, touch: { das: 170, arr: 70 }, soft: { das: 80, arr: 40 } };
        this.LOCK_DELAY = 450;
        // 街機式「越玩越快」：最高 15 級；每 6 行升 1 級，或每 45 秒自動升 1 級（取較高者）
        this.MAX_LEVEL = 15;
        this.LINES_PER_LEVEL = 6;
        this.TIME_PER_LEVEL = 45000;
        this.SPEED_TABLE = [1000, 850, 720, 610, 520, 440, 370, 310, 260, 215, 175, 140, 110, 85, 65]; // 每格下落毫秒
        this.playMs = 0;               // 實際遊玩時間（不含暫停）
        this.shownLevel = 1;
        this.levelUpAt = 0;         // 方塊著地後還能移動/旋轉的時間（毫秒）
        this.lockTimer = 0; this.lockResets = 0;
        this.render = null;            // 畫面上的平滑位置（往實際格子位置補間）
        this.landFx = null;            // 落地疊疊樂彈跳效果
        this.input = { dir: 0, dirSrc: 'key', dirStart: 0, dirMoves: 0, held: { '-1': false, '1': false }, soft: false, softStart: 0, softMoves: 0 };
        this.clearing = null;          // 消除動畫進行中
        this.CLEAR_MS = 360;
        this.particles = [];
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.nextCanvas = document.getElementById('next-canvas');
        this.nextCtx = this.nextCanvas.getContext('2d');

        // 高解析度繪製：依螢幕像素密度放大畫布，邏輯座標維持 200x400 / 80x80
        this.DPR = Math.min(window.devicePixelRatio || 1, 3);
        this.W = 200; this.H = 400; this.NW = 80; this.NH = 80;
        this.canvas.width = this.W * this.DPR; this.canvas.height = this.H * this.DPR;
        this.nextCanvas.width = this.NW * this.DPR; this.nextCanvas.height = this.NH * this.DPR;

        this.COLS = 10;
        this.ROWS = 20;
        this.SIZE = 20;

        this.board = Array.from({ length: this.ROWS }, () => Array(this.COLS).fill(0));
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.combo = 0;
        this.gameOver = false;
        this.paused = false;
        
        // 7-Bag 隨機演算法容器
        this.bag = [];
        
        // 視覺與動畫效果：Squish 落地輕微擠壓變形
        this.squishFactor = 1.0;
        this.squishTimer = 0;

        // 方塊定義與顏色 (對應 Q 版史萊姆)
        this.SHAPES = {
            I: [[1, 1, 1, 1]],
            J: [[1, 0, 0], [1, 1, 1]],
            L: [[0, 0, 1], [1, 1, 1]],
            O: [[1, 1], [1, 1]],
            S: [[0, 1, 1], [1, 1, 0]],
            T: [[0, 1, 0], [1, 1, 1]],
            Z: [[1, 1, 0], [0, 1, 1]]
        };
        
        this.COLORS = {
            I: '#48dbfb', // 天藍史萊姆
            J: '#54a0ff', // 海藍史萊姆
            L: '#feca57', // 金黃史萊姆
            O: '#ff9f43', // 鮮橘史萊姆
            S: '#1dd1a1', // 薄荷綠史萊姆
            T: '#a55eea', // 魅紫史萊姆
            Z: '#ff6b6b'  // 草莓紅史萊姆
        };

        this.nextPiece = this.generatePiece();
        this.piece = this.spawnNext();

        this.lastTime = 0;
        this.dropCounter = 0;

        this.initControls();
        this.loadLeaderboard();
        
        // 開始遊戲迴圈
        requestAnimationFrame(this.gameLoop.bind(this));
    }

    // 標準 7-Bag 隨機生成器
    getNextPieceFromBag() {
        if (this.bag.length === 0) {
            const types = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
            // Fisher-Yates 洗牌
            for (let i = types.length - 1; i > 0; i--) {
                const j = Math.floor(this.rng() * (i + 1));
                [types[i], types[j]] = [types[j], types[i]];
            }
            this.bag = types;
        }
        return this.bag.pop();
    }

    generatePiece() {
        const type = this.getNextPieceFromBag();
        const m = this.SHAPES[type];
        const k = m.map(row => row.map(() => ''));
        if (this.special) {
            const roll = this.specialRng();
            const pickKind = this.specialRng();
            const pickCell = this.specialRng();
            if (roll < this.SPECIAL_RATE) {
                let acc = 0, kind = 'star';
                for (const [name, w] of this.SPECIAL_KINDS) { acc += w; if (pickKind < acc) { kind = name; break; } }
                const cells = [];
                m.forEach((row, r) => row.forEach((v, c) => { if (v) cells.push([r, c]); }));
                const [sr, sc] = cells[Math.floor(pickCell * cells.length)];
                k[sr][sc] = kind;
            }
        }
        return { type, m, k, c: this.COLORS[type], x: 0, y: 0 };
    }

    // 盤面格子的編碼："顏色" 或 "顏色|特殊種類"
    static cellColor(cell) { return typeof cell === 'string' ? cell.split('|')[0] : cell; }
    static cellKind(cell) { return typeof cell === 'string' && cell.includes('|') ? cell.split('|')[1] : ''; }

    spawnNext() {
        const p = this.nextPiece;
        this.nextPiece = this.generatePiece();
        p.x = Math.floor((this.COLS - p.m[0].length) / 2);
        p.y = 0;
        
        this.drawNext();
        return p;
    }

    // 繪製 Q 版史萊姆單一方塊 (圓角 + 高光水滴 + Q版大眼睛)
    drawSlimeBlock(ctx, x, y, cell, size = this.SIZE, fx = null, kindOverride = '') {
        const kind = kindOverride || SlimeTetris.cellKind(cell);
        let color = SlimeTetris.cellColor(cell);
        if (kind === 'zombie') color = '#8aa889';      // 殭屍：灰綠色
        if (kind === 'hard') color = '#55556a';        // 硬殼垃圾：深灰
        if (kind === 'blackhole') color = '#3a2a5e';   // 黑洞：深紫
        this.drawSlimeBody(ctx, x, y, color, size, fx);
        if (kind) this.drawAccessory(ctx, x * size, y * size, size, kind, fx);
    }

    applyFx(ctx, px, py, size, fx) {
        if (!fx) return;
        if (fx.alpha !== undefined) ctx.globalAlpha = Math.max(0, fx.alpha);
        if (fx.scale !== undefined && fx.scale !== 1) { const cx = px + size / 2, cy = py + size / 2; ctx.translate(cx, cy); ctx.scale(fx.scale, fx.scale); ctx.translate(-cx, -cy); }
        if (fx.scaleX !== undefined) { const cx = px + size / 2, cy = fx.anchor === 'bottom' ? py + size : py + size / 2; ctx.translate(cx, cy); ctx.scale(fx.scaleX, fx.scaleY); ctx.translate(-cx, -cy); }
    }

    // 特殊史萊姆的配件：⭐ 星星髮夾、💣 引線、💧 水滴、🧟 縫線、🛡 頭盔
    drawAccessory(ctx, px, py, s, kind, fx) {
        ctx.save();
        this.applyFx(ctx, px, py, s, fx);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (kind === 'star') {
            const cx = px + s * 0.74, cy = py + s * 0.22, R = s * 0.3, r = s * 0.13;
            ctx.beginPath();
            for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
            ctx.closePath(); ctx.fillStyle = '#ffe066'; ctx.fill();
            ctx.lineWidth = Math.max(1.2, s * 0.06); ctx.strokeStyle = '#1e272e'; ctx.stroke();
        } else if (kind === 'bomb') {
            // 炸彈：深色身體 + 粗引線 + 火花
            ctx.fillStyle = 'rgba(20,20,30,.55)';
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px + 1, py + 1, s - 2, s - 2, s * 0.3); else ctx.rect(px + 1, py + 1, s - 2, s - 2); ctx.fill();
            ctx.strokeStyle = '#1e272e'; ctx.lineWidth = Math.max(1.6, s * 0.11);
            ctx.beginPath(); ctx.moveTo(px + s * 0.45, py + s * 0.14); ctx.quadraticCurveTo(px + s * 0.6, py - s * 0.14, px + s * 0.84, py + s * 0.0); ctx.stroke();
            ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.arc(px + s * 0.86, py + s * 0.0, s * 0.15, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(px + s * 0.86, py + s * 0.0, s * 0.08, 0, Math.PI * 2); ctx.fill();
        } else if (kind === 'melt') {
            ctx.fillStyle = 'rgba(255,255,255,.55)';
            [[0.28, 0.86, 0.09], [0.66, 0.92, 0.11]].forEach(([dx, dy, rr]) => {
                const cx = px + s * dx, cy = py + s * dy;
                ctx.beginPath(); ctx.moveTo(cx, cy - s * rr * 1.8); ctx.quadraticCurveTo(cx + s * rr, cy - s * rr * 0.2, cx, cy + s * rr * 0.6); ctx.quadraticCurveTo(cx - s * rr, cy - s * rr * 0.2, cx, cy - s * rr * 1.8); ctx.fill();
            });
            ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, s * 0.05);
            ctx.beginPath(); ctx.moveTo(px + s * 0.18, py + s * 0.18); ctx.lineTo(px + s * 0.3, py + s * 0.12); ctx.stroke();
        } else if (kind === 'zombie') {
            ctx.strokeStyle = '#2d3a2d'; ctx.lineWidth = Math.max(1, s * 0.05);
            ctx.beginPath(); ctx.moveTo(px + s * 0.18, py + s * 0.24); ctx.lineTo(px + s * 0.5, py + s * 0.2);
            for (let i = 0; i < 3; i++) { const sx = px + s * (0.24 + i * 0.1); ctx.moveTo(sx, py + s * 0.16); ctx.lineTo(sx, py + s * 0.28); }
            ctx.stroke();
            ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(px + s * 0.68, py + s * 0.47, s * 0.05, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#2d3a2d'; ctx.lineWidth = Math.max(1, s * 0.06);
            ctx.beginPath(); ctx.moveTo(px + s * 0.35, py + s * 0.74); ctx.lineTo(px + s * 0.45, py + s * 0.7); ctx.lineTo(px + s * 0.55, py + s * 0.74); ctx.lineTo(px + s * 0.65, py + s * 0.7); ctx.stroke();
        } else if (kind === 'blackhole') {
            const cx = px + s / 2, cy = py + s * 0.52;
            ctx.strokeStyle = 'rgba(190,150,255,.9)'; ctx.lineWidth = Math.max(1, s * 0.06);
            for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.ellipse(cx, cy, s * (0.42 - i * 0.12), s * (0.16 - i * 0.05), -0.35, 0, Math.PI * 2); ctx.stroke(); }
            ctx.fillStyle = '#05030c'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.11, 0, Math.PI * 2); ctx.fill();
        } else if (kind === 'hard') {
            ctx.fillStyle = '#9aa0b4';
            ctx.beginPath(); ctx.moveTo(px + s * 0.08, py + s * 0.42); ctx.quadraticCurveTo(px + s * 0.5, py - s * 0.12, px + s * 0.92, py + s * 0.42); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#1e272e'; ctx.lineWidth = Math.max(1, s * 0.05); ctx.stroke();
            ctx.fillStyle = '#1e272e';
            [0.3, 0.5, 0.7].forEach((dx) => { ctx.beginPath(); ctx.arc(px + s * dx, py + s * 0.3, s * 0.035, 0, Math.PI * 2); ctx.fill(); });
        }
        ctx.restore();
    }

    drawSlimeBody(ctx, x, y, color, size = this.SIZE, fx = null) {
        const px = x * size;
        const py = y * size;
        const radius = size * 0.3;

        ctx.save();
        if (fx) {
            if (fx.alpha !== undefined) ctx.globalAlpha = Math.max(0, fx.alpha);
            if (fx.scale !== undefined && fx.scale !== 1) {
                const cx = px + size / 2, cy = py + size / 2;
                ctx.translate(cx, cy); ctx.scale(fx.scale, fx.scale); ctx.translate(-cx, -cy);
            }
            if (fx.scaleX !== undefined) {
                const cx = px + size / 2, cy = fx.anchor === 'bottom' ? py + size : py + size / 2;
                ctx.translate(cx, cy); ctx.scale(fx.scaleX, fx.scaleY); ctx.translate(-cx, -cy);
            }
        }
        
        // 主體圓角矩形 (Q彈史萊姆身軀)
        ctx.fillStyle = color;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(px + 1, py + 1, size - 2, size - 2, radius);
        } else {
            ctx.rect(px + 1, py + 1, size - 2, size - 2);
        }
        ctx.fill();

        // 頂部水滴高光
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.ellipse(px + size * 0.35, py + size * 0.3, size * 0.2, size * 0.12, -Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();

        // 底部陰影感
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.rect(px + 2, py + size - 4, size - 4, 2);
        ctx.fill();

        if (fx && fx.face === 'happy') {
            // 開心表情：^ ^ 眼睛 + 張嘴 + 腮紅
            ctx.strokeStyle = '#1e272e';
            ctx.lineWidth = Math.max(1.2, size * 0.08);
            ctx.lineCap = 'round';
            const ey = py + size * 0.46, ew = size * 0.11;
            [0.33, 0.67].forEach((fxp) => {
                const ex = px + size * fxp;
                ctx.beginPath(); ctx.moveTo(ex - ew, ey + ew * 0.5); ctx.lineTo(ex, ey - ew * 0.5); ctx.lineTo(ex + ew, ey + ew * 0.5); ctx.stroke();
            });
            ctx.fillStyle = '#1e272e';
            ctx.beginPath(); ctx.arc(px + size * 0.5, py + size * 0.64, size * 0.09, 0, Math.PI); ctx.fill();
            ctx.fillStyle = 'rgba(255, 120, 150, 0.6)';
            ctx.beginPath();
            ctx.arc(px + size * 0.2, py + size * 0.62, size * 0.07, 0, Math.PI * 2);
            ctx.arc(px + size * 0.8, py + size * 0.62, size * 0.07, 0, Math.PI * 2);
            ctx.fill();
            if (fx.flash) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(px + 1, py + 1, size - 2, size - 2, radius); else ctx.rect(px + 1, py + 1, size - 2, size - 2);
                ctx.fill();
            }
            ctx.restore();
            return;
        }

        // Q版眼睛 (左眼與右眼)
        const eyeY = py + size * 0.45;
        const leftEyeX = px + size * 0.35;
        const rightEyeX = px + size * 0.65;
        const eyeRadius = size * 0.12;

        // 眼白/黑眼珠
        ctx.fillStyle = '#1e272e';
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY, eyeRadius, 0, Math.PI * 2);
        ctx.arc(rightEyeX, eyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();

        // 眼神亮點
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(leftEyeX - 1, eyeY - 1, eyeRadius * 0.4, 0, Math.PI * 2);
        ctx.arc(rightEyeX - 1, eyeY - 1, eyeRadius * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    drawNext() {
        this.nextCtx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
        this.nextCtx.clearRect(0, 0, this.NW, this.NH);
        const m = this.nextPiece.m;
        const size = 16;
        const offsetX = (this.NW - m[0].length * size) / 2;
        const offsetY = (this.NH - m.length * size) / 2;

        for (let r = 0; r < m.length; r++) {
            for (let c = 0; c < m[r].length; c++) {
                if (m[r][c]) {
                    this.drawSlimeBlock(this.nextCtx, (offsetX / size) + c, (offsetY / size) + r, this.nextPiece.c, size, null, (this.nextPiece.k && this.nextPiece.k[r][c]) || '');
                }
            }
        }
    }

    triggerSquish() {
        // 改為「疊疊樂」效果：只有剛落下的史萊姆與正下方被壓到的史萊姆 Q 彈變形，整個盤面不再晃動
        if (!this.piece) return;
        const landed = new Set(), under = new Set();
        this.piece.m.forEach((row, y) => row.forEach((v, x) => { if (v) landed.add(`${this.piece.x + x},${this.piece.y + y}`); }));
        landed.forEach((k) => { const [x, y] = k.split(',').map(Number); for (let d = 1; d <= 2; d++) { const kk = `${x},${y + d}`; if (!landed.has(kk)) under.add(kk + ':' + d); } });
        this.landFx = { landed, under, t0: performance.now() };
    }

    gameLoop(time = 0) {
        if (this.gameOver) return;

        const deltaTime = time - this.lastTime;
        this.lastTime = time;
        if (this.paused) {               // 暫停中：不下落，只重畫
            this.draw();
            requestAnimationFrame(this.gameLoop.bind(this));
            return;
        }
        if (this.clearing) {                 // 消除動畫中：暫停下落與操作
            if (time - this.clearing.t0 >= this.CLEAR_MS) this.finishClear();
            this.draw();
            requestAnimationFrame(this.gameLoop.bind(this));
            return;
        }
        this.updateHeldInput(time);
        this.dropCounter += deltaTime;
        this.playMs += Math.min(deltaTime, 100);

        const effLevel = this.currentLevel();
        if (effLevel > this.shownLevel) {          // 升級提示：音效 + 畫面閃字
            this.shownLevel = effLevel;
            this.levelUpAt = performance.now();
            this.sfx.levelUp();
            this.updateUI();
        }
        const speed = this.SPEED_TABLE[effLevel - 1];

        if (this.dropCounter > speed) {
            this.softDropStep();
            this.dropCounter = 0;
        }

        // 著地延遲：碰到地面後等 LOCK_DELAY 才鎖定，期間可左右移動或旋轉微調
        if (this.piece && !this.clearing) {
            if (this.collide(this.piece.x, this.piece.y + 1, this.piece.m)) {
                this.lockTimer += deltaTime;
                if (this.lockTimer >= this.lockDelay()) this.lock();
            } else {
                this.lockTimer = 0;
            }
        }


        this.draw();
        requestAnimationFrame(this.gameLoop.bind(this));
    }

    // 目前等級：消行數、遊玩時間、（PK 生存）外部指定的最低等級，三者取最高
    currentLevel() {
        const byLines = 1 + Math.floor(this.lines / this.LINES_PER_LEVEL);
        const byTime = this.opts.pvp ? 1 : 1 + Math.floor(this.playMs / this.TIME_PER_LEVEL);
        const ext = this.opts.minLevel ? this.opts.minLevel() : 1;
        return Math.min(this.MAX_LEVEL, Math.max(byLines, byTime, ext));
    }

    // 等級越高，著地後可微調的時間越短，維持壓迫感
    lockDelay() {
        const lv = this.currentLevel();
        return lv >= 13 ? 170 : lv >= 10 ? 220 : lv >= 6 ? 300 : this.LOCK_DELAY;
    }

    togglePause(force) {
        if (this.gameOver || this.opts.pvp) return;
        this.paused = typeof force === 'boolean' ? force : !this.paused;
        this.dropCounter = 0;
        const btn = document.getElementById('btn-pause');
        if (btn) btn.innerText = this.paused ? '▶ 繼續' : '⏸ 暫停';
        this.draw();
    }

    // 計算目前方塊直接落下後的位置（落點預覽）
    getGhostY() {
        if (!this.piece) return null;
        let y = this.piece.y;
        while (!this.collide(this.piece.x, y + 1, this.piece.m)) y++;
        return y;
    }

    // ---- 長按輸入：在遊戲迴圈中依時間計算，比 setInterval / 系統按鍵重複更穩定 ----
    canAct() { return !this.gameOver && !this.paused; }
    pressDir(d, src) {
        if (!this.canAct()) return;
        this.input.held[d] = true;
        this.input.dir = d; this.input.dirSrc = src; this.input.dirStart = performance.now(); this.input.dirMoves = 0;
        if (this.piece) this.move(d, 0);
    }
    releaseDir(d) {
        this.input.held[d] = false;
        if (this.input.dir === d) {
            const other = -d;
            if (this.input.held[other]) { this.input.dir = other; this.input.dirStart = performance.now(); this.input.dirMoves = 0; }
            else this.input.dir = 0;
        }
    }
    pressSoft() {
        if (!this.canAct()) return;
        this.input.soft = true; this.input.softStart = performance.now(); this.input.softMoves = 0;
        if (this.piece) this.softDropManual();
    }
    releaseSoft() { this.input.soft = false; }
    updateHeldInput(now) {
        if (!this.piece || this.paused) return;
        const inp = this.input;
        if (inp.dir) {
            const t = this.TIMING[inp.dirSrc];
            const el = now - inp.dirStart;
            if (el >= t.das) {
                const target = 1 + Math.floor((el - t.das) / t.arr);
                let steps = Math.min(target - inp.dirMoves, 10);
                while (steps-- > 0) { if (!this.move(inp.dir, 0)) break; }
                inp.dirMoves = target;
            }
        }
        if (inp.soft && this.piece) {
            const t = this.TIMING.soft;
            const el = now - inp.softStart;
            if (el >= t.das) {
                const target = 1 + Math.floor((el - t.das) / t.arr);
                let steps = Math.min(target - inp.softMoves, 10);
                while (steps-- > 0 && this.piece && !this.clearing) this.softDropManual();
                inp.softMoves = target;
                this.dropCounter = 0;
            }
        }
    }

    softDropStep() {
        if (!this.piece) return;
        this.move(0, 1);   // 著地時不立即鎖定，交給著地延遲處理
    }

    softDropManual() {
        if (this.gameOver || !this.piece) return;
        if (this.move(0, 1)) {
            this.score += 1; // Soft drop 每格 +1 分
            this.updateUI();
        } else {
            this.lock();
        }
    }

    hardDropManual() {
        if (this.gameOver || !this.piece || this.paused) return;
        this.sfx.hardDrop();
        let dropped = 0;
        while (this.move(0, 1)) {
            dropped++;
        }
        this.score += dropped * 2; // Hard drop 額外加分
        this.triggerSquish();
        this.lock();
    }

    move(dx, dy) {
        if (!this.piece) return false;
        if (this.collide(this.piece.x + dx, this.piece.y + dy, this.piece.m)) {
            return false;
        }
        this.piece.x += dx;
        this.piece.y += dy;
        if (dx) this.onPieceAdjusted();
        return true;
    }

    onPieceAdjusted() {
        // 著地後移動/旋轉會重設著地計時（最多 15 次，避免無限拖延）
        if (this.lockTimer > 0 && this.lockResets < 15) { this.lockTimer = 0; this.lockResets++; }
    }

    rotate() {
        if (this.gameOver || !this.piece || this.paused) return;
        const before = this.piece.m;
        this.rotateInner();
        if (this.piece && this.piece.m !== before) { this.sfx.rotate(); this.onPieceAdjusted(); }
    }

    rotateInner() {
        const m = this.piece.m;
        // 順時針旋轉矩陣（特殊史萊姆標記跟著一起轉）
        const rotated = m[0].map((_, i) => m.map(row => row[i]).reverse());
        const km = this.piece.k || m.map(row => row.map(() => ''));
        const rotatedK = km[0].map((_, i) => km.map(row => row[i]).reverse());
        const apply = () => { this.piece.k = rotatedK; };
        
        // 簡易 Kick 檢測
        let offset = 0;
        if (!this.collide(this.piece.x, this.piece.y, rotated)) {
            this.piece.m = rotated; apply();
            return;
        }
        
        // 嘗試左右微移 (Wall Kick)
        if (!this.collide(this.piece.x - 1, this.piece.y, rotated)) {
            this.piece.x -= 1;
            this.piece.m = rotated; apply();
            return;
        }
        if (!this.collide(this.piece.x + 1, this.piece.y, rotated)) {
            this.piece.x += 1;
            this.piece.m = rotated; apply();
            return;
        }
    }

    collide(x, y, m) {
        for (let r = 0; r < m.length; r++) {
            for (let c = 0; c < m[r].length; c++) {
                if (m[r][c]) {
                    const newX = x + c;
                    const newY = y + r;
                    if (newX < 0 || newX >= this.COLS || newY >= this.ROWS) {
                        return true;
                    }
                    if (newY >= 0 && this.board[newY][newX]) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    lock() {
        // 鎖定方塊至網格
        this.piece.m.forEach((row, y) => {
            row.forEach((val, x) => {
                if (val) {
                    const boardY = this.piece.y + y;
                    const boardX = this.piece.x + x;
                    if (boardY >= 0 && boardY < this.ROWS) {
                        const kind = this.piece.k ? this.piece.k[y][x] : '';
                        this.board[boardY][boardX] = kind ? `${this.piece.c}|${kind}` : this.piece.c;
                    }
                }
            });
        });

        this.triggerSquish();

        // 💧 融化史萊姆：落地後往下滴，填滿正下方的空洞，之後變回一般史萊姆
        for (let r = this.ROWS - 1; r >= 0; r--) {
            for (let c = 0; c < this.COLS; c++) {
                if (SlimeTetris.cellKind(this.board[r][c]) !== 'melt') continue;
                const color = SlimeTetris.cellColor(this.board[r][c]);
                this.board[r][c] = 0;
                let y = r;
                while (y + 1 < this.ROWS && this.board[y + 1][c] === 0) y++;
                this.board[y][c] = color;
                if (y !== r) this.sfx.melt();
            }
        }

        // 🛡 硬殼垃圾：滿行時第一次只會「脫殼」——頭盔破掉、剛填進去的缺口重新打開，要再消一次
        let cracked = false;
        for (let r = 0; r < this.ROWS; r++) {
            const row = this.board[r];
            if (!row.every(cell => cell !== 0) || !row.some(cell => SlimeTetris.cellKind(cell) === 'hard')) continue;
            for (let c = 0; c < this.COLS; c++) {
                const cell = row[c];
                if (SlimeTetris.cellKind(cell) === 'hard') row[c] = '#6b6b80';
                else if (SlimeTetris.cellColor(cell) !== '#6b6b80') row[c] = 0;
            }
            cracked = true;
        }
        if (cracked) this.sfx.crack();

        // 有滿行 → 先播放消除動畫（史萊姆開心表情 + 閃爍消失），動畫結束才真正消除
        const full = [];
        for (let r = 0; r < this.ROWS; r++) if (this.board[r].every(cell => cell !== 0)) full.push(r);
        if (full.length) {
            // 結算消除行裡的特殊史萊姆：⭐ 計分 ×2、攻擊 +1；💣 炸掉上下格；🧟 自己加兩行垃圾
            // 🧟 殭屍若與 💣 炸彈在同一行、或被 🕳 黑洞吞掉 → 淨化（不懲罰，還加分）
            const mods = { stars: 0, bombs: [], zombies: 0, purified: 0, blackhole: false };
            full.forEach((r) => {
                const kinds = this.board[r].map(SlimeTetris.cellKind);
                const rowHasBomb = kinds.includes('bomb');
                kinds.forEach((k, c) => {
                    if (k === 'star') mods.stars++;
                    else if (k === 'bomb') mods.bombs.push([r, c]);
                    else if (k === 'blackhole') mods.blackhole = true;
                    else if (k === 'zombie') { if (rowHasBomb) mods.purified++; else mods.zombies++; }
                });
            });
            if (mods.blackhole) { mods.purified += mods.zombies; mods.zombies = 0; }
            this.clearMods = mods;
            this.clearing = { rows: full, t0: performance.now(), mods };
            this.piece = null;
            this.sfx.clear(full.length, this.combo + 1);
            if (mods.bombs.length) this.sfx.bomb();
            if (mods.blackhole) this.sfx.blackhole();
            else if (mods.zombies) this.sfx.zombie();
            if (mods.purified) this.sfx.purify();
            this.spawnParticles(full);
            return;
        }

        this.sfx.land();
        this.clearLines();
        if (this.pendingGarbage > 0) {
            this.sfx.garbage();
            if (this.applyGarbage()) { this.endGame(); return; }
        }
        this.spawnAndCheck();
    }

    finishClear() {
        const mods = this.clearMods;
        this.clearing = null;
        // 💣 炸彈：在整行消失前，先把炸彈正上方、正下方（非消除行）的格子炸掉
        if (mods && mods.bombs.length) {
            const rows = new Set();
            for (let r = 0; r < this.ROWS; r++) if (this.board[r].every(cell => cell !== 0)) rows.add(r);
            mods.bombs.forEach(([r, c]) => [r - 1, r + 1].forEach((rr) => {
                if (rr >= 0 && rr < this.ROWS && !rows.has(rr) && this.board[rr][c]) {
                    if (SlimeTetris.cellKind(this.board[rr][c]) === 'zombie') mods.purified++;
                    this.board[rr][c] = 0; mods.blasted = (mods.blasted || 0) + 1;
                }
            }));
        }
        // 🕳 黑洞：吞掉滿行以外的所有方塊（殭屍一起被淨化），本次得分只拿 8 成
        if (mods && mods.blackhole) {
            let vacuumed = 0;
            for (let r = 0; r < this.ROWS; r++) {
                if (this.board[r].every(cell => cell !== 0)) continue;
                this.board[r].forEach((cell) => { if (cell) { vacuumed++; if (SlimeTetris.cellKind(cell) === 'zombie') mods.purified++; } });
            }
            mods.vacuumed = vacuumed;
        }
        this.clearLines();
        this.clearMods = null;
        if (mods && mods.blackhole) this.board = this.board.map(() => Array(this.COLS).fill(0));
        // 🧟 殭屍：每隻殭屍讓自己底下冒出 2 行垃圾（陷阱）
        if (mods && mods.zombies) {
            if (this.addGarbageRows(Math.min(4, mods.zombies * 2), false)) { this.endGame(); return; }
        }
        this.spawnAndCheck();
    }

    spawnAndCheck() {
        this.piece = this.spawnNext();
        this.lockTimer = 0; this.lockResets = 0; this.render = null;
        if (this.collide(this.piece.x, this.piece.y, this.piece.m)) {
            this.endGame();
        }
    }

    spawnParticles(rows) {
        const now = performance.now();
        rows.forEach((r) => {
            for (let c = 0; c < this.COLS; c++) {
                const color = SlimeTetris.cellColor(this.board[r][c]) || '#ffffff';
                for (let k = 0; k < 2; k++) {
                    this.particles.push({
                        x: (c + 0.5) * this.SIZE, y: (r + 0.5) * this.SIZE,
                        vx: (Math.random() - 0.5) * 0.12, vy: -0.05 - Math.random() * 0.1,
                        r: 1.5 + Math.random() * 2.5, color, t0: now + this.CLEAR_MS * 0.55, life: 520,
                    });
                }
            }
        });
    }

    clearLines() {
        let cleared = 0;
        for (let r = this.ROWS - 1; r >= 0; r--) {
            if (this.board[r].every(cell => cell !== 0)) {
                this.board.splice(r, 1);
                this.board.unshift(Array(this.COLS).fill(0));
                cleared++;
                r++; // 重新檢查同一行
            }
        }

        if (cleared > 0) {
            // 計分規則：1行 100 / 2行 300 / 3行 500 / 4行 800
            const baseScores = [0, 100, 300, 500, 800];
            const base = baseScores[cleared] || (cleared * 200);
            
            // 連擊（Combo）加權：得分 = 基礎得分 × (1 + Combo數 × 0.5)；⭐ 星星史萊姆 ×2；💣 每炸掉 1 格 +20
            const mods = this.clearMods || {};
            let addScore = base * (1 + this.combo * 0.5) * (mods.stars ? 2 : 1) + (mods.blasted || 0) * 20 + (mods.purified || 0) * 100;
            if (mods.blackhole) addScore = (addScore + (mods.vacuumed || 0) * 10) * 0.8;
            this.score += addScore;
            this.lines += cleared;
            this.combo++;

            // 難度遞增：每消除 10 行升 1 Level (最高 10 階)
            this.level = this.currentLevel();
            if (this.opts.onClear) this.opts.onClear(cleared, this.combo, { stars: mods.stars || 0 });
        } else {
            this.combo = 0;
        }

        this.updateUI();
        return cleared;
    }

    // ---- PK 攻擊：收到對手的垃圾行 ----
    queueGarbage(n, hard = 0) {
        if (this.gameOver || n <= 0) return;
        this.sfx.garbage();
        this.pendingGarbage = Math.min(20, this.pendingGarbage + n);
        this.pendingHard = Math.min(this.pendingGarbage, this.pendingHard + Math.min(hard, n));
        if (this.opts.onGarbageChange) this.opts.onGarbageChange(this.pendingGarbage);
    }

    // 用自己消除的行數抵銷待收的垃圾行，回傳抵銷後剩下的攻擊量
    cancelGarbage(attack) {
        const used = Math.min(attack, this.pendingGarbage);
        this.pendingGarbage -= used;
        this.pendingHard = Math.min(this.pendingHard, this.pendingGarbage);
        if (this.opts.onGarbageChange) this.opts.onGarbageChange(this.pendingGarbage);
        return attack - used;
    }

    // 把待收垃圾行從底部推上來（同一批缺口在同一欄）。回傳 true 表示被推出頂端 → 輸
    applyGarbage() {
        const n = this.pendingGarbage, hard = this.pendingHard;
        this.pendingGarbage = 0; this.pendingHard = 0;
        if (this.opts.onGarbageChange) this.opts.onGarbageChange(0);
        return this.addGarbageRows(n, hard);
    }

    // 從底部推上 n 行垃圾（同一批缺口同一欄）；前 hard 行是硬殼。回傳 true 表示被推出頂端
    addGarbageRows(n, hard = 0) {
        let toppedOut = false;
        const hole = Math.floor(this.garbageRng() * this.COLS);
        for (let i = 0; i < n; i++) {
            const top = this.board.shift();
            if (top.some(cell => cell !== 0)) toppedOut = true;
            const isHard = i >= n - (hard || 0);
            const row = Array(this.COLS).fill(isHard ? '#6b6b80|hard' : '#6b6b80');
            row[hole] = 0;
            this.board.push(row);
        }
        return toppedOut;
    }

    // 給對手看的精簡盤面（含目前操作中的方塊）
    snapshot() {
        const grid = this.board.map(row => row.map(c => (c ? (SlimeTetris.cellColor(c) === '#6b6b80' ? 'g' : 'x') : '.')));
        if (this.piece && !this.gameOver) {
            this.piece.m.forEach((row, y) => row.forEach((v, x) => {
                const by = this.piece.y + y, bx = this.piece.x + x;
                if (v && by >= 0 && by < this.ROWS && bx >= 0 && bx < this.COLS) grid[by][bx] = 'x';
            }));
        }
        return grid.map(r => r.join('')).join('');
    }

    // 外部結束（對手輸了、時間到）：停止遊戲但不顯示單人結束畫面
    stop() {
        this.gameOver = true;
        this.draw();
    }

    updateUI() {
        document.getElementById('score-val').innerText = Math.floor(this.score);
        document.getElementById('level-val').innerText = this.currentLevel();
        document.getElementById('lines-val').innerText = this.lines;
        document.getElementById('combo-val').innerText = this.combo;
    }

    draw() {
        this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
        this.ctx.clearRect(0, 0, this.W, this.H);

        this.ctx.save();
        

        // 繪製背景網格底色
        this.ctx.fillStyle = '#090914';
        this.ctx.fillRect(0, 0, this.W, this.H);

        // 格線：輔助判斷方塊落點
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
        this.ctx.lineWidth = 1 / this.DPR;
        this.ctx.beginPath();
        for (let c = 1; c < this.COLS; c++) {
            this.ctx.moveTo(c * this.SIZE, 0);
            this.ctx.lineTo(c * this.SIZE, this.H);
        }
        for (let r = 1; r < this.ROWS; r++) {
            this.ctx.moveTo(0, r * this.SIZE);
            this.ctx.lineTo(this.W, r * this.SIZE);
        }
        this.ctx.stroke();

        // 繪製固定於盤面上的史萊姆
        const now = performance.now();
        this.lastDrawAtPrev = this.lastDrawAt;
        const clr = this.clearing;
        // 疊疊樂落地效果（約 260ms）：剛落下的史萊姆橫向壓扁再彈回，下面一兩層跟著輕輕被壓
        const lf = this.landFx && now - this.landFx.t0 < 260 ? this.landFx : null;
        const landScale = (key) => {
            if (!lf) return null;
            const t = (now - lf.t0) / 260;
            const wobble = Math.sin(t * Math.PI * 2.2) * Math.pow(1 - t, 1.6);
            let amp = 0;
            if (lf.landed.has(key)) amp = 0.16;
            else if (lf.under.has(key + ':1')) amp = 0.08;
            else if (lf.under.has(key + ':2')) amp = 0.04;
            if (!amp) return null;
            return { scaleX: 1 + amp * wobble, scaleY: 1 - amp * wobble, anchor: 'bottom' };
        };
        const p = clr ? Math.min(1, (now - clr.t0) / this.CLEAR_MS) : 0;
        for (let r = 0; r < this.ROWS; r++) {
            const isClearing = clr && clr.rows.includes(r);
            for (let c = 0; c < this.COLS; c++) {
                if (!this.board[r][c]) continue;
                if (isClearing) {
                    // 0–55%：開心表情 + 閃爍；55–100%：鼓起後縮小淡出（從中間往兩側，像波浪一樣消失）
                    const stagger = Math.abs(c - 4.5) / 4.5 * 0.12;
                    const q = Math.max(0, (p - 0.55 - stagger * 0.5) / 0.45);
                    const flash = p < 0.55 && Math.floor((now - clr.t0) / 70) % 2 === 0;
                    const scale = q > 0 ? (q < 0.25 ? 1 + q * 0.6 : Math.max(0, 1.15 - (q - 0.25) * 1.55)) : 1 + Math.sin(p * Math.PI * 6) * 0.04;
                    this.drawSlimeBlock(this.ctx, c, r, this.board[r][c], this.SIZE, { face: 'happy', flash, scale, alpha: 1 - q * 0.9 });
                } else if (clr && clr.mods && clr.mods.blackhole) {
                    // 🕳 被吸進黑洞：往中心縮小、淡出
                    this.ctx.save();
                    const k = Math.min(1, p * 1.2);
                    const cx = this.W / 2, cy = this.H / 2;
                    const bx = (c + 0.5) * this.SIZE, by = (r + 0.5) * this.SIZE;
                    this.ctx.translate((cx - bx) * k * k, (cy - by) * k * k);
                    this.drawSlimeBlock(this.ctx, c, r, this.board[r][c], this.SIZE, { scale: 1 - k * 0.9, alpha: 1 - k * 0.8 });
                    this.ctx.restore();
                } else {
                    this.drawSlimeBlock(this.ctx, c, r, this.board[r][c], this.SIZE, landScale(`${c},${r}`));
                }
            }
        }
        if (clr && clr.mods && clr.mods.blackhole) {   // 黑洞漩渦
            const R = 10 + p * 70;
            const grd = this.ctx.createRadialGradient(this.W / 2, this.H / 2, 0, this.W / 2, this.H / 2, R);
            grd.addColorStop(0, 'rgba(0,0,0,.95)'); grd.addColorStop(0.6, 'rgba(90,40,160,.55)'); grd.addColorStop(1, 'rgba(90,40,160,0)');
            this.ctx.fillStyle = grd; this.ctx.beginPath(); this.ctx.arc(this.W / 2, this.H / 2, R, 0, Math.PI * 2); this.ctx.fill();
        }
        if (clr && p < 0.55) {   // 整行發光
            this.ctx.fillStyle = `rgba(255, 255, 255, ${0.12 + 0.1 * Math.sin(p * Math.PI * 8)})`;
            clr.rows.forEach((r) => this.ctx.fillRect(0, r * this.SIZE, this.W, this.SIZE));
        }
        // 彈跳粒子
        if (this.particles.length) {
            this.particles = this.particles.filter((pt) => now - pt.t0 < pt.life);
            this.particles.forEach((pt) => {
                const t = now - pt.t0; if (t < 0) return;
                const k = t / pt.life;
                this.ctx.globalAlpha = 1 - k;
                this.ctx.fillStyle = pt.color;
                this.ctx.beginPath();
                this.ctx.arc(pt.x + pt.vx * t, pt.y + pt.vy * t + 0.00018 * t * t, pt.r * (1 - k * 0.5), 0, Math.PI * 2);
                this.ctx.fill();
            });
            this.ctx.globalAlpha = 1;
        }

        // 落點預覽（虛線外框）：顯示方塊直接落下後的位置
        if (this.piece && !this.gameOver) {
            const gy = this.getGhostY();
            if (gy !== null && gy > this.piece.y) {
                const color = this.piece.c;
                this.ctx.save();
                this.ctx.strokeStyle = typeof color === 'string' && color.startsWith('#') ? color : 'rgba(255,255,255,0.6)';
                this.ctx.globalAlpha = 0.55;
                this.ctx.lineWidth = 1.5;
                this.ctx.setLineDash([3, 2]);
                this.piece.m.forEach((row, y) => {
                    row.forEach((val, x) => {
                        if (val) {
                            const px = (this.piece.x + x) * this.SIZE + 2;
                            const py = (gy + y) * this.SIZE + 2;
                            this.ctx.strokeRect(px, py, this.SIZE - 4, this.SIZE - 4);
                        }
                    });
                });
                this.ctx.restore();
            }
        }

        // 繪製目前操作中的史萊姆（畫面位置平滑補間到實際格子，移動不再一格一格跳）
        if (this.piece) {
            const dt = this.lastDrawAt ? Math.min(50, now - this.lastDrawAt) : 16;
            if (!this.render || this.render.piece !== this.piece || Math.abs(this.render.x - this.piece.x) > 3 || Math.abs(this.render.y - this.piece.y) > 3) {
                this.render = { piece: this.piece, x: this.piece.x, y: this.piece.y };
            } else {
                const k = 1 - Math.exp(-dt / 22);
                this.render.x += (this.piece.x - this.render.x) * k;
                this.render.y += (this.piece.y - this.render.y) * k;
                if (Math.abs(this.render.x - this.piece.x) < 0.01) this.render.x = this.piece.x;
                if (Math.abs(this.render.y - this.piece.y) < 0.01) this.render.y = this.piece.y;
            }
            const rx = this.render.x, ry = this.render.y;
            this.piece.m.forEach((row, y) => {
                row.forEach((val, x) => {
                    if (val) {
                        this.drawSlimeBlock(this.ctx, rx + x, ry + y, this.piece.c, this.SIZE, null, (this.piece.k && this.piece.k[y][x]) || '');
                    }
                });
            });
        }

        this.ctx.restore();

        this.lastDrawAt = now;

        // LEVEL UP 提示（約 0.9 秒）
        if (this.levelUpAt && now - this.levelUpAt < 900 && !this.gameOver) {
            const t = (now - this.levelUpAt) / 900;
            this.ctx.save();
            this.ctx.globalAlpha = 1 - t;
            this.ctx.fillStyle = '#feca57';
            this.ctx.font = `bold ${20 + 6 * Math.sin(Math.min(1, t * 3) * Math.PI)}px sans-serif`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`LEVEL ${this.shownLevel}`, this.W / 2, this.H * 0.32 - t * 20);
            this.ctx.restore();
        }

        if (this.paused && !this.gameOver) {
            this.ctx.fillStyle = 'rgba(9, 9, 20, 0.72)';
            this.ctx.fillRect(0, 0, this.W, this.H);
            this.ctx.fillStyle = '#4ecca3';
            this.ctx.font = 'bold 22px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('暫停中', this.W / 2, this.H / 2 - 6);
            this.ctx.fillStyle = '#a0a0c0';
            this.ctx.font = '11px sans-serif';
            this.ctx.fillText('按「▶ 繼續」或 P 鍵', this.W / 2, this.H / 2 + 16);
        }
    }

    endGame() {
        if (this.gameOver) return;
        this.gameOver = true;
        if (this.opts.onGameOver) { this.draw(); this.opts.onGameOver(this); return; }
        document.getElementById('final-score-text').innerText = '得分: ' + Math.floor(this.score);
        document.getElementById('game-overlay').classList.remove('hidden');
    }

    async loadLeaderboard() {
        const listUl = document.getElementById('leaderboard-list');
        if (!listUl) return;
        const scores = await LeaderboardAPI.fetchTopScores();
        this.renderLeaderboardUI(scores);
    }

    renderLeaderboardUI(scores) {
        const listUl = document.getElementById('leaderboard-list');
        listUl.innerHTML = scores.map((item, index) => 
            `<li><span>${index + 1}. ${item.name}</span><span>${item.score}</span></li>`
        ).join('');
    }

    initControls() {
        // 鍵盤控制
        document.addEventListener('keydown', (e) => {
            if (this.gameOver) return;
            if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
                e.preventDefault();
                this.togglePause();
                return;
            }
            if (this.paused) return;
            if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();
            if (e.repeat) return;   // 不使用系統按鍵重複（間隔不穩定），改由遊戲迴圈處理長按
            switch(e.key) {
                case 'ArrowLeft':
                    this.pressDir(-1, 'key');
                    break;
                case 'ArrowRight':
                    this.pressDir(1, 'key');
                    break;
                case 'ArrowUp':
                    this.rotate();
                    break;
                case 'ArrowDown':
                    this.pressSoft();
                    break;
                case ' ':
                    e.preventDefault();
                    this.hardDropManual();
                    break;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowLeft') this.releaseDir(-1);
            else if (e.key === 'ArrowRight') this.releaseDir(1);
            else if (e.key === 'ArrowDown') this.releaseSoft();
        });
        window.addEventListener('blur', () => { this.releaseDir(-1); this.releaseDir(1); this.releaseSoft(); });

        // 觸控按鈕綁定 (支援連續按壓/長按 Soft Drop)
        const bindButton = (id, action, repeat = null) => {
            const btn = document.getElementById(id);
            if (!btn) return;

            let delayTimer = null;
            let timer = null;
            const run = () => { if (!this.paused && !this.gameOver) action(); };

            const stop = (e) => {
                if (e && e.cancelable) e.preventDefault();
                clearTimeout(delayTimer); delayTimer = null;
                clearInterval(timer); timer = null;
            };

            const start = (e) => {
                e.preventDefault();
                stop();
                run();
                if (repeat) {
                    delayTimer = setTimeout(() => {
                        timer = setInterval(run, repeat.repeatRate);
                    }, repeat.initialDelay);
                }
            };

            btn.addEventListener('touchstart', start, { passive: false });
            btn.addEventListener('touchend', stop, { passive: false });
            btn.addEventListener('touchcancel', stop, { passive: false });
            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', stop);
            btn.addEventListener('mouseleave', stop);
        };

        const bindHold = (id, down, up) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            let active = false;
            const start = (e) => { e.preventDefault(); if (active) return; active = true; btn.classList.add('pressed'); down(); };
            const stop = (e) => { if (e && e.cancelable) e.preventDefault(); if (!active) return; active = false; btn.classList.remove('pressed'); up(); };
            btn.addEventListener('touchstart', start, { passive: false });
            btn.addEventListener('touchend', stop, { passive: false });
            btn.addEventListener('touchcancel', stop, { passive: false });
            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', stop);
            btn.addEventListener('mouseleave', stop);
        };
        bindHold('btn-left', () => this.pressDir(-1, 'touch'), () => this.releaseDir(-1));
        bindHold('btn-right', () => this.pressDir(1, 'touch'), () => this.releaseDir(1));
        bindHold('btn-soft-drop', () => this.pressSoft(), () => this.releaseSoft());
        bindButton('btn-rotate', () => this.rotate());
        bindButton('btn-hard-drop', () => this.hardDropManual());

        // 音效開關
        if (!document.getElementById('btn-sound')) {
            const sb = document.createElement('button');
            sb.id = 'btn-sound';
            sb.className = 'sound-btn';
            const label = () => { sb.textContent = this.sfx.muted ? '🔇' : '🔊'; sb.title = this.sfx.muted ? '開啟音效' : '關閉音效'; };
            label();
            sb.onclick = () => { this.sfx.setMuted(!this.sfx.muted); label(); if (!this.sfx.muted) this.sfx.land(); };
            const header = document.querySelector('.game-header');
            if (header) header.appendChild(sb);
        }

        // 暫停按鈕；切到別的 App 或分頁時自動暫停
        const pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', (e) => { e.preventDefault(); this.togglePause(); });
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.togglePause(true);
        });

        // 分數上傳按鈕
        document.getElementById('btn-submit-score').onclick = async () => {
            const nameInput = document.getElementById('player-name');
            const name = nameInput.value.trim() || '史萊姆';
            const newScores = await LeaderboardAPI.submitScore(name, this.score);
            this.renderLeaderboardUI(newScores);
            document.getElementById('btn-submit-score').disabled = true;
            document.getElementById('btn-submit-score').innerText = '已上傳';
        };

        // 重新開始按鈕
        document.getElementById('btn-restart').onclick = () => {
            location.reload();
        };
    }
}

// 確保 DOM 載入後初始化遊戲
window.addEventListener('DOMContentLoaded', () => {
    if (window.SlimePK) window.SlimePK.boot();   // 有大廳/PK 模組時由它決定何時開始
    else window.__game = new SlimeTetris();
});

// ---- 版面自適應：依可用空間放大遊戲盤面，保持 1:2 比例，按鈕永遠在畫面內 ----
(function () {
    function fitLayout() {
        const main = document.querySelector('.main-layout');
        const wrap = document.getElementById('canvas-container');
        const side = document.querySelector('.sidebar');
        if (!main || !wrap) return;
        const border = 8; // 外框 4px x 2
        const maxW = main.clientWidth * 0.70;
        const maxH = main.clientHeight;
        const inner = Math.max(120, Math.floor(Math.min(maxW - border, (maxH - border) / 2)));
        wrap.style.width = (inner + border) + 'px';
        wrap.style.height = (inner * 2 + border) + 'px';
        if (side) side.style.height = (inner * 2 + border) + 'px';
    }
    window.addEventListener('DOMContentLoaded', fitLayout);
    window.addEventListener('resize', fitLayout);
    window.addEventListener('orientationchange', () => setTimeout(fitLayout, 200));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitLayout);
})();
