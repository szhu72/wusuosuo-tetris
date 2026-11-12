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

class SlimeTetris {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.nextCanvas = document.getElementById('next-canvas');
        this.nextCtx = this.nextCanvas.getContext('2d');

        this.COLS = 10;
        this.ROWS = 20;
        this.SIZE = 20;

        this.board = Array.from({ length: this.ROWS }, () => Array(this.COLS).fill(0));
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.combo = 0;
        this.gameOver = false;
        
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
                const j = Math.floor(Math.random() * (i + 1));
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
    drawSlimeBlock(ctx, x, y, color, size = this.SIZE) {
        const px = x * size;
        const py = y * size;
        const radius = size * 0.3;

        ctx.save();
        
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
        this.nextCtx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);
        const m = this.nextPiece.m;
        const size = 16;
        const offsetX = (this.nextCanvas.width - m[0].length * size) / 2;
        const offsetY = (this.nextCanvas.height - m.length * size) / 2;

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
        this.dropCounter += deltaTime;

        // 10 階段難度遞減 (Level 1: 1000ms -> Level 10: 100ms)
        const speed = Math.max(100, 1000 - (this.level - 1) * 100);

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

    softDropStep() {
        if (!this.move(0, 1)) {
            this.lock();
        }
    }

    softDropManual() {
        if (this.gameOver) return;
        if (this.move(0, 1)) {
            this.score += 1; // Soft drop 每格 +1 分
            this.updateUI();
        } else {
            this.lock();
        }
    }

    hardDropManual() {
        if (this.gameOver) return;
        let dropped = 0;
        while (this.move(0, 1)) {
            dropped++;
        }
        this.score += dropped * 2; // Hard drop 額外加分
        this.triggerSquish();
        this.lock();
    }

    move(dx, dy) {
        if (this.collide(this.piece.x + dx, this.piece.y + dy, this.piece.m)) {
            return false;
        }
        this.piece.x += dx;
        this.piece.y += dy;
        return true;
    }

    rotate() {
        if (this.gameOver) return;
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
        this.clearLines();

        // 產生下一個方塊
        this.piece = this.spawnNext();

        // 檢查 Game Over
        if (this.collide(this.piece.x, this.piece.y, this.piece.m)) {
            this.endGame();
        }
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
        } else {
            this.combo = 0;
        }

        this.updateUI();
    }

    updateUI() {
        document.getElementById('score-val').innerText = Math.floor(this.score);
        document.getElementById('level-val').innerText = this.level;
        document.getElementById('lines-val').innerText = this.lines;
        document.getElementById('combo-val').innerText = this.combo;
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        
        // 落地輕微 Squish 擠壓繪製效果
        if (this.squishFactor !== 1.0) {
            this.ctx.translate(0, this.canvas.height);
            this.ctx.scale(1.0, this.squishFactor);
            this.ctx.translate(0, -this.canvas.height);
        }

        // 繪製背景網格底色
        this.ctx.fillStyle = '#090914';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 繪製固定於盤面上的史萊姆
        for (let r = 0; r < this.ROWS; r++) {
            for (let c = 0; c < this.COLS; c++) {
                if (this.board[r][c]) {
                    this.drawSlimeBlock(this.ctx, c, r, this.board[r][c]);
                }
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
    }

    endGame() {
        this.gameOver = true;
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
            switch(e.key) {
                case 'ArrowLeft':
                    this.move(-1, 0);
                    break;
                case 'ArrowRight':
                    this.move(1, 0);
                    break;
                case 'ArrowUp':
                    this.rotate();
                    break;
                case 'ArrowDown':
                    this.softDropManual();
                    break;
                case ' ':
                    e.preventDefault();
                    this.hardDropManual();
                    break;
            }
        });

        // 觸控按鈕綁定 (支援連續按壓/長按 Soft Drop)
        const bindButton = (id, action, allowRepeat = false) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            
            let timer = null;

            const start = (e) => {
                e.preventDefault();
                action();
                if (allowRepeat) {
                    timer = setInterval(action, 80);
                }
            };

            const stop = (e) => {
                if (e) e.preventDefault();
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
            };

            btn.addEventListener('touchstart', start, { passive: false });
            btn.addEventListener('touchend', stop, { passive: false });
            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', stop);
            btn.addEventListener('mouseleave', stop);
        };

        bindButton('btn-left', () => this.move(-1, 0), true);
        bindButton('btn-right', () => this.move(1, 0), true);
        bindButton('btn-soft-drop', () => this.softDropManual(), true);
        bindButton('btn-rotate', () => this.rotate(), false);
        bindButton('btn-hard-drop', () => this.hardDropManual(), false);

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
    new SlimeTetris();
});