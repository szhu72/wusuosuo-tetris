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
        this.sfx = window.__slimeSfx || (window.__slimeSfx = new SlimeSFX());
        // 方向鍵長按：鍵盤 / 觸控分開設定（DAS＝開始連續移動前的等待，ARR＝之後每格間隔，毫秒）
        this.TIMING = { key: { das: 130, arr: 40 }, touch: { das: 160, arr: 60 }, soft: { das: 90, arr: 35 } };
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
        return {
            type: type,
            m: this.SHAPES[type],
            c: this.COLORS[type],
            x: 0,
            y: 0
        };
    }

    spawnNext() {
        const p = this.nextPiece;
        this.nextPiece = this.generatePiece();
        p.x = Math.floor((this.COLS - p.m[0].length) / 2);
        p.y = 0;
        
        this.drawNext();
        return p;
    }

    // 繪製 Q 版史萊姆單一方塊 (圓角 + 高光水滴 + Q版大眼睛)
    drawSlimeBlock(ctx, x, y, color, size = this.SIZE, fx = null) {
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
                    this.drawSlimeBlock(this.nextCtx, (offsetX / size) + c, (offsetY / size) + r, this.nextPiece.c, size);
                }
            }
        }
    }

    triggerSquish() {
        this.squishFactor = 0.85; // 垂直擠壓 15%
        this.squishTimer = 6;      // 持續約 6 幀
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

        // 10 階段難度遞減 (Level 1: 1000ms -> Level 10: 100ms)
        const effLevel = Math.max(this.level, this.opts.minLevel ? this.opts.minLevel() : 1);
        const speed = Math.max(100, 1000 - (effLevel - 1) * 100);

        if (this.dropCounter > speed) {
            this.softDropStep();
            this.dropCounter = 0;
        }

        // 動態擠壓復原動畫
        if (this.squishTimer > 0) {
            this.squishTimer--;
            if (this.squishTimer === 0) {
                this.squishFactor = 1.0;
            }
        }

        this.draw();
        requestAnimationFrame(this.gameLoop.bind(this));
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
        if (!this.move(0, 1)) {
            this.lock();
        }
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
        return true;
    }

    rotate() {
        if (this.gameOver || !this.piece || this.paused) return;
        this.sfx.rotate();
        const m = this.piece.m;
        // 順時針旋轉矩陣
        const rotated = m[0].map((_, i) => m.map(row => row[i]).reverse());
        
        // 簡易 Kick 檢測
        let offset = 0;
        if (!this.collide(this.piece.x, this.piece.y, rotated)) {
            this.piece.m = rotated;
            return;
        }
        
        // 嘗試左右微移 (Wall Kick)
        if (!this.collide(this.piece.x - 1, this.piece.y, rotated)) {
            this.piece.x -= 1;
            this.piece.m = rotated;
            return;
        }
        if (!this.collide(this.piece.x + 1, this.piece.y, rotated)) {
            this.piece.x += 1;
            this.piece.m = rotated;
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
                        this.board[boardY][boardX] = this.piece.c;
                    }
                }
            });
        });

        this.triggerSquish();

        // 有滿行 → 先播放消除動畫（史萊姆開心表情 + 閃爍消失），動畫結束才真正消除
        const full = [];
        for (let r = 0; r < this.ROWS; r++) if (this.board[r].every(cell => cell !== 0)) full.push(r);
        if (full.length) {
            this.clearing = { rows: full, t0: performance.now() };
            this.piece = null;
            this.sfx.clear(full.length, this.combo + 1);
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
        this.clearing = null;
        this.clearLines();
        this.spawnAndCheck();
    }

    spawnAndCheck() {
        this.piece = this.spawnNext();
        if (this.collide(this.piece.x, this.piece.y, this.piece.m)) {
            this.endGame();
        }
    }

    spawnParticles(rows) {
        const now = performance.now();
        rows.forEach((r) => {
            for (let c = 0; c < this.COLS; c++) {
                const color = this.board[r][c] || '#ffffff';
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
            
            // 連擊（Combo）加權：得分 = 基礎得分 × (1 + Combo數 × 0.5)
            const addScore = base * (1 + this.combo * 0.5);
            this.score += addScore;
            this.lines += cleared;
            this.combo++;

            // 難度遞增：每消除 10 行升 1 Level (最高 10 階)
            this.level = Math.min(10, Math.floor(this.lines / 10) + 1);
            if (this.opts.onClear) this.opts.onClear(cleared, this.combo);
        } else {
            this.combo = 0;
        }

        this.updateUI();
        return cleared;
    }

    // ---- PK 攻擊：收到對手的垃圾行 ----
    queueGarbage(n) {
        if (this.gameOver || n <= 0) return;
        this.sfx.garbage();
        this.pendingGarbage = Math.min(20, this.pendingGarbage + n);
        if (this.opts.onGarbageChange) this.opts.onGarbageChange(this.pendingGarbage);
    }

    // 用自己消除的行數抵銷待收的垃圾行，回傳抵銷後剩下的攻擊量
    cancelGarbage(attack) {
        const used = Math.min(attack, this.pendingGarbage);
        this.pendingGarbage -= used;
        if (this.opts.onGarbageChange) this.opts.onGarbageChange(this.pendingGarbage);
        return attack - used;
    }

    // 把待收垃圾行從底部推上來（同一批缺口在同一欄）。回傳 true 表示被推出頂端 → 輸
    applyGarbage() {
        const n = this.pendingGarbage;
        this.pendingGarbage = 0;
        if (this.opts.onGarbageChange) this.opts.onGarbageChange(0);
        let toppedOut = false;
        const hole = Math.floor(this.garbageRng() * this.COLS);
        for (let i = 0; i < n; i++) {
            const top = this.board.shift();
            if (top.some(cell => cell !== 0)) toppedOut = true;
            const row = Array(this.COLS).fill('#6b6b80');
            row[hole] = 0;
            this.board.push(row);
        }
        return toppedOut;
    }

    // 給對手看的精簡盤面（含目前操作中的方塊）
    snapshot() {
        const grid = this.board.map(row => row.map(c => (c ? (c === '#6b6b80' ? 'g' : 'x') : '.')));
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
        document.getElementById('level-val').innerText = this.level;
        document.getElementById('lines-val').innerText = this.lines;
        document.getElementById('combo-val').innerText = this.combo;
    }

    draw() {
        this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
        this.ctx.clearRect(0, 0, this.W, this.H);

        this.ctx.save();
        
        // 落地輕微 Squish 擠壓繪製效果
        if (this.squishFactor !== 1.0) {
            this.ctx.translate(0, this.H);
            this.ctx.scale(1.0, this.squishFactor);
            this.ctx.translate(0, -this.H);
        }

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
        const clr = this.clearing;
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
                } else {
                    this.drawSlimeBlock(this.ctx, c, r, this.board[r][c]);
                }
            }
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

        // 繪製目前操作中的史萊姆
        if (this.piece) {
            this.piece.m.forEach((row, y) => {
                row.forEach((val, x) => {
                    if (val) {
                        this.drawSlimeBlock(this.ctx, this.piece.x + x, this.piece.y + y, this.piece.c);
                    }
                });
            });
        }

        this.ctx.restore();

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
        const maxW = main.clientWidth * 0.62;
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
