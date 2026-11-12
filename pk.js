// =====================================================================
//  史萊姆方塊：個人識別碼 + 1 對 1 PK 房間（計時 / 生存）+ 雲端個人最佳排行榜
//  連線：Firebase Realtime Database（firebase-config.js 設定後啟用）
//  測試：網址加上 ?net=local，可用同一台裝置的兩個分頁模擬兩位玩家
// =====================================================================
(function () {
    'use strict';

    const FB_VER = '10.14.1';
    const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const ATTACK_BY_LINES = [0, 0, 1, 2, 4];               // 消 1/2/3/4 行 → 送出 0/1/2/4 行垃圾
    const COMBO_BONUS = [0, 0, 1, 1, 2, 2, 3, 3, 4];        // 連擊加成（combo 從 1 開始計）
    const DISCONNECT_FORFEIT_MS = 10000;
    const SURVIVAL_SPEEDUP_MS = 40000;                     // 生存 PK：每 40 秒最低速度 +1 級
    const PUBLISH_MS = 300;

    const qs = new URLSearchParams(location.search);
    // 部分 App 內建瀏覽器（LINE、IG 等）不支援 confirm/alert/prompt，失敗時用預設值
    const safeConfirm = (msg) => { try { return window.confirm(msg); } catch { return true; } };
    const safeAlert = (msg) => { try { window.alert(msg); } catch {} };
    const $ = (sel) => document.querySelector(sel);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const shortCode = (uid) => { let h = 2166136261; for (const ch of uid) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } let s = ''; h >>>= 0; for (let i = 0; i < 4; i++) { s += ROOM_ALPHABET[h % ROOM_ALPHABET.length]; h = Math.floor(h / ROOM_ALPHABET.length); } return s; };

    // ------------------------------------------------------------------
    //  連線層：Firebase 與本機測試兩種實作，提供相同的介面
    // ------------------------------------------------------------------
    async function createFirebaseNet(config) {
        const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
        const appMod = await import(base + 'firebase-app.js');
        const authMod = await import(base + 'firebase-auth.js');
        const db = await import(base + 'firebase-database.js');
        const app = appMod.initializeApp(config);
        const auth = authMod.getAuth(app);
        const database = db.getDatabase(app);
        const user = await new Promise((resolve, reject) => {
            const off = authMod.onAuthStateChanged(auth, (u) => { if (u) { off(); resolve(u); } });
            authMod.signInAnonymously(auth).catch(reject);
        });
        let offset = 0;
        db.onValue(db.ref(database, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
        const r = (p) => db.ref(database, p);
        return {
            kind: 'firebase',
            uid: user.uid,
            now: () => Date.now() + offset,
            get: async (p) => (await db.get(r(p))).val(),
            set: (p, v) => db.set(r(p), v),
            update: (p, v) => db.update(r(p), v),
            remove: (p) => db.remove(r(p)),
            push: (p, v) => db.push(r(p), v),
            watch: (p, cb) => db.onValue(r(p), (s) => cb(s.val())),
            transaction: async (p, fn) => (await db.runTransaction(r(p), fn)).snapshot.val(),
            onDisconnectUpdate: (p, v) => db.onDisconnect(r(p)).update(v),
            cancelOnDisconnect: (p) => db.onDisconnect(r(p)).cancel(),
            topBest: async (n) => {
                const s = await db.get(db.query(r('players'), db.orderByChild('best'), db.limitToLast(n)));
                const list = []; s.forEach((c) => { list.push(c.val()); });
                return list.filter((p) => p && p.best > 0).sort((a, b) => b.best - a.best);
            },
        };
    }

    // 本機測試：資料存在 localStorage，用 BroadcastChannel 通知其他分頁（每個分頁是一位玩家）
    function createLocalNet() {
        const KEY = 'pk_local_db_v1';
        const chan = 'BroadcastChannel' in window ? new BroadcastChannel('pk_local_net') : null;
        let uid = sessionStorage.getItem('pk_local_uid');
        if (!uid) { uid = 'local-' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('pk_local_uid', uid); }
        const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
        const write = (t) => { localStorage.setItem(KEY, JSON.stringify(t)); notify(); };
        const parts = (p) => p.split('/').filter(Boolean);
        const getAt = (t, p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), t);
        const setAt = (t, p, v) => { const ks = parts(p); let o = t; ks.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }); if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v; };
        const sv = (v) => (v && typeof v === 'object' ? (v['.sv'] === 'timestamp' ? Date.now() : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sv(x)]))) : v);
        const watchers = new Set();
        function notify() { watchers.forEach((w) => w()); if (chan) chan.postMessage(1); }
        if (chan) chan.onmessage = () => watchers.forEach((w) => w());
        const discUpdates = [];
        window.addEventListener('pagehide', () => { if (!discUpdates.length) return; const t = read(); discUpdates.forEach(([p, v]) => Object.entries(v).forEach(([k, val]) => setAt(t, p + '/' + k, val === '__now__' ? Date.now() : val))); write(t); });
        return {
            kind: 'local',
            uid,
            now: () => Date.now(),
            get: async (p) => { const v = getAt(read(), p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
            set: async (p, v) => { const t = read(); setAt(t, p, sv(v)); write(t); },
            update: async (p, v) => { const t = read(); Object.entries(v).forEach(([k, val]) => setAt(t, p + '/' + k, sv(val))); write(t); },
            remove: async (p) => { const t = read(); setAt(t, p, null); write(t); },
            push: async (p, v) => { const t = read(); setAt(t, p + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), sv(v)); write(t); },
            watch: (p, cb) => { let last; const w = () => { const v = getAt(read(), p); const s = JSON.stringify(v ?? null); if (s !== last) { last = s; cb(v === undefined ? null : JSON.parse(s)); } }; watchers.add(w); w(); return () => watchers.delete(w); },
            transaction: async (p, fn) => { const t = read(); const cur = getAt(t, p); const nv = fn(cur === undefined ? null : cur); if (nv !== undefined) { setAt(t, p, sv(nv)); write(t); } return getAt(read(), p) ?? null; },
            onDisconnectUpdate: async (p, v) => { discUpdates.push([p, Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === 'object' ? '__now__' : val]))]); },
            cancelOnDisconnect: async () => { discUpdates.length = 0; },
            topBest: async (n) => Object.values(read().players || {}).filter((p) => p && p.best > 0).sort((a, b) => b.best - a.best).slice(0, n),
        };
    }

    const SERVER_TIME = { '.sv': 'timestamp' };

    // ------------------------------------------------------------------
    //  狀態
    // ------------------------------------------------------------------
    let net = null;
    let me = null;               // { uid, name, code, best, wins, losses, draws }
    let roomCode = null;
    let room = null;
    let unwatchRoom = null;
    let game = null;
    let match = null;            // { seed, startAt, mode, duration, processed:Set, publishTimer, tick, resolved }

    // ------------------------------------------------------------------
    //  介面
    // ------------------------------------------------------------------
    function injectUI() {
        const lobby = document.createElement('div');
        lobby.id = 'pk-lobby';
        lobby.className = 'pk-overlay';
        lobby.innerHTML = `
          <div class="pk-card">
            <h2 class="pk-title">史萊姆方塊 <span>Q彈大冒險</span></h2>
            <div id="pk-me" class="pk-me"></div>
            <button id="pk-single" class="ui-btn primary pk-big">🎮 單人遊戲</button>
            <div id="pk-online" class="pk-section">
              <h3>⚔ 1 對 1 PK</h3>
              <div class="pk-modes" id="pk-modes">
                <button data-mode="timed" data-dur="120">計時 2 分</button>
                <button data-mode="timed" data-dur="180" class="on">計時 3 分</button>
                <button data-mode="timed" data-dur="300">計時 5 分</button>
                <button data-mode="survival" data-dur="0">生存</button>
              </div>
              <p class="pk-hint" id="pk-mode-hint"></p>
              <button id="pk-create" class="ui-btn action pk-big">＋ 建立房間</button>
              <div class="pk-join">
                <input id="pk-code" type="text" maxlength="5" placeholder="房間碼" autocomplete="off" autocapitalize="characters">
                <button id="pk-join" class="ui-btn primary">加入</button>
              </div>
            </div>
            <p id="pk-status" class="pk-status"></p>
          </div>
          <div class="pk-card hidden" id="pk-room">
            <h3>房間 <b id="pk-room-code" class="pk-roomcode"></b></h3>
            <p class="pk-hint" id="pk-room-mode"></p>
            <button id="pk-share" class="ui-btn primary">📨 邀請好友</button>
            <ul id="pk-players" class="pk-players"></ul>
            <button id="pk-ready" class="ui-btn primary pk-big">準備</button>
            <button id="pk-start" class="ui-btn action pk-big hidden">▶ 開始對戰</button>
            <button id="pk-leave" class="ui-btn pk-ghost">離開房間</button>
            <p id="pk-room-status" class="pk-status"></p>
          </div>`;
        document.body.appendChild(lobby);

        const panel = document.createElement('div');
        panel.className = 'panel pk-panel hidden';
        panel.id = 'pk-panel';
        panel.innerHTML = `
          <div class="panel-title" id="pk-timer">PK</div>
          <div class="pk-opp-name" id="pk-opp-name">對手</div>
          <canvas id="pk-opp-canvas" width="60" height="120"></canvas>
          <div class="stat-item"><span>行數</span><span class="val" id="pk-opp-lines">0</span></div>
          <div class="stat-item"><span>分數</span><span class="val" id="pk-opp-score">0</span></div>
          <div class="pk-garbage"><span>來襲</span><i id="pk-garbage-bar"></i><b id="pk-garbage-n">0</b></div>`;
        const lb = document.querySelector('.leaderboard-panel');
        lb.parentNode.insertBefore(panel, lb);

        const banner = document.createElement('div');
        banner.id = 'pk-banner';
        banner.className = 'pk-banner hidden';
        document.getElementById('canvas-container').appendChild(banner);

        const result = document.createElement('div');
        result.id = 'pk-result';
        result.className = 'pk-overlay hidden';
        result.innerHTML = `<div class="pk-card" id="pk-result-card"></div>`;
        document.body.appendChild(result);

        const menuBtn = document.createElement('button');
        menuBtn.id = 'pk-menu-btn';
        menuBtn.className = 'pk-menu-btn hidden';
        menuBtn.textContent = '☰ 大廳';
        menuBtn.onclick = () => { if (!match || safeConfirm('離開目前這局，回到大廳？')) location.href = location.pathname; };
        document.querySelector('.game-header').appendChild(menuBtn);
    }

    const show = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !on); };
    const status = (t) => { $('#pk-status').textContent = t || ''; };

    function renderMe() {
        if (!me) {
            $('#pk-me').innerHTML = `<span class="pk-hint">單人模式（PK 連線尚未啟用）</span>`;
            return;
        }
        $('#pk-me').innerHTML = `
          <div><b>${esc(me.name || '尚未命名')}</b> <span class="pk-tag">#${esc(me.code)}</span>
            <button id="pk-rename" class="pk-link">✎ 改名</button></div>
          <div class="pk-hint">最佳 ${me.best || 0} 分 · ${me.wins || 0} 勝 ${me.losses || 0} 敗${me.draws ? ` ${me.draws} 和` : ''}</div>`;
        $('#pk-rename').onclick = () => askName(true);
    }

    // 暱稱輸入：直接在頁面上顯示輸入框（不使用 prompt，避免 App 內建瀏覽器不支援）
    function askName(force) {
        if (me.name && !force) return Promise.resolve();
        return new Promise((resolve) => {
            $('#pk-me').innerHTML = `
              <label class="pk-hint" for="pk-name-input">${me.name ? '修改暱稱' : '先取一個暱稱，朋友會看到這個名字'}（最多 8 個字）</label>
              <div class="pk-join" style="margin-top:6px">
                <input id="pk-name-input" type="text" maxlength="8" placeholder="例如：史萊姆王" value="${esc(me.name || '')}" autocomplete="off">
                <button id="pk-name-ok" class="ui-btn primary">確定</button>
              </div>`;
            const input = $('#pk-name-input');
            const done = async () => {
                const name = input.value.trim().slice(0, 8) || me.name || ('史萊姆' + me.code);
                $('#pk-name-ok').disabled = true;
                me.name = name;
                try { await net.update(`players/${me.uid}`, { name, code: me.code, updatedAt: SERVER_TIME }); }
                catch (e) { status('暱稱儲存失敗：' + (e.code || e.message || e)); }
                renderMe();
                resolve();
            };
            $('#pk-name-ok').onclick = done;
            input.onkeydown = (e) => { if (e.key === 'Enter') done(); };
            if (!me.name) setTimeout(() => input.focus(), 50);
        });
    }

    let selMode = { mode: 'timed', duration: 180 };
    function modeText(m) { return m.mode === 'survival' ? '生存 PK：不限時間，先堆到頂的人輸，每 40 秒自動加速。' : `計時 PK：${m.duration / 60} 分鐘內消除行數多的人贏；中途有人堆到頂就直接判輸、提早結束。`; }

    // ------------------------------------------------------------------
    //  大廳 / 房間
    // ------------------------------------------------------------------
    async function createRoom() {
        let code = '';
        for (let i = 0; i < 8; i++) {
            code = Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
            if (!(await net.get(`rooms/${code}/host`))) break;
        }
        await net.set(`rooms/${code}`, {
            host: me.uid, mode: selMode.mode, duration: selMode.duration, status: 'waiting', createdAt: SERVER_TIME,
            players: { [me.uid]: { name: me.name, code: me.code, ready: false, online: true, joinedAt: SERVER_TIME } },
        });
        await enterRoom(code);
    }

    async function joinRoom(code) {
        code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 5) { status('房間碼是 5 個字。'); return; }
        const r = await net.get(`rooms/${code}`);
        if (!r || !r.host) { status('找不到這個房間，可能已經關閉。'); return; }
        const members = Object.keys(r.players || {});
        if (!members.includes(me.uid)) {
            if (members.length >= 2) { status('房間已滿（1 對 1）。'); return; }
            if (r.status === 'playing') { status('這個房間正在對戰中。'); return; }
            if (r.guest && r.guest !== me.uid) { status('房間已滿（1 對 1）。'); return; }
            await net.update(`rooms/${code}`, { guest: me.uid, [`players/${me.uid}`]: { name: me.name, code: me.code, ready: false, online: true, joinedAt: SERVER_TIME } });
        } else {
            await net.update(`rooms/${code}/players/${me.uid}`, { online: true, offAt: null });
        }
        await enterRoom(code);
    }

    async function enterRoom(code) {
        roomCode = code;
        history.replaceState(null, '', `${location.pathname}?room=${code}${qs.get('net') ? '&net=' + qs.get('net') : ''}`);
        await net.onDisconnectUpdate(`rooms/${code}/players/${me.uid}`, { online: false, offAt: SERVER_TIME });
        show('pk-room', true);
        document.querySelector('#pk-lobby .pk-card').classList.add('hidden');
        if (unwatchRoom) unwatchRoom();
        unwatchRoom = net.watch(`rooms/${code}`, onRoom);
    }

    async function leaveRoom() {
        if (!roomCode) return;
        const r = await net.get(`rooms/${roomCode}`);
        await net.cancelOnDisconnect(`rooms/${roomCode}/players/${me.uid}`);
        if (unwatchRoom) { unwatchRoom(); unwatchRoom = null; }
        const others = Object.keys((r && r.players) || {}).filter((u) => u !== me.uid);
        if (!others.length) await net.remove(`rooms/${roomCode}`);
        else if (r.host === me.uid) await net.update(`rooms/${roomCode}`, { host: others[0], guest: null, [`players/${me.uid}`]: null });
        else await net.update(`rooms/${roomCode}`, { guest: null, [`players/${me.uid}`]: null });
        location.href = location.pathname + (qs.get('net') ? '?net=' + qs.get('net') : '');
    }

    function renderRoom() {
        const r = room;
        $('#pk-room-code').textContent = roomCode;
        $('#pk-room-mode').textContent = modeText(r);
        const ps = Object.entries(r.players || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
        $('#pk-players').innerHTML = ps.map(([uid, p]) => `
            <li class="${p.online === false ? 'off' : ''}">
              <span>${uid === r.host ? '👑 ' : ''}${esc(p.name)} <span class="pk-tag">#${esc(p.code || '')}</span>${uid === me.uid ? '（你）' : ''}</span>
              <span>${p.online === false ? '離線' : p.ready ? '✅ 準備好了' : '⏳ 等待中'}</span>
            </li>`).join('') + (ps.length < 2 ? `<li class="pk-empty"><span>等待好友加入…</span><span>把房間碼 <b>${roomCode}</b> 傳給朋友</span></li>` : '');
        const mine = (r.players || {})[me.uid] || {};
        $('#pk-ready').textContent = mine.ready ? '取消準備' : '準備';
        const isHost = r.host === me.uid;
        const allReady = ps.length === 2 && ps.every(([, p]) => p.ready && p.online !== false);
        show('pk-start', isHost);
        $('#pk-start').disabled = !allReady;
        $('#pk-room-status').textContent = r.status === 'ended' ? (isHost ? '上一局已結束。雙方準備好後可以再開一局。' : '上一局已結束，等待房主開新局。')
            : ps.length < 2 ? '' : allReady ? (isHost ? '雙方都準備好了，按「開始對戰」！' : '等待房主開始…') : '雙方都按「準備」後，房主就能開始。';
    }

    async function startMatch() {
        const r = await net.get(`rooms/${roomCode}`);
        const players = {};
        Object.keys(r.players || {}).forEach((uid) => {
            players[`players/${uid}/alive`] = true; players[`players/${uid}/score`] = 0; players[`players/${uid}/lines`] = 0;
            players[`players/${uid}/board`] = ''; players[`players/${uid}/outAt`] = null; players[`players/${uid}/ready`] = false;
        });
        await net.update(`rooms/${roomCode}`, {
            ...players, status: 'playing', seed: Math.floor(Math.random() * 2 ** 31), startAt: net.now() + 4000,
            result: null, attacks: null, matchId: Date.now().toString(36),
        });
    }

    // ------------------------------------------------------------------
    //  房間狀態變化
    // ------------------------------------------------------------------
    function onRoom(r) {
        if (!r) { if (!match) { safeAlert('房間已關閉。'); location.href = location.pathname; } return; }
        room = r;
        if (r.status === 'playing' && !match) {
            if (!(r.players || {})[me.uid]) return;
            beginMatch(r);
        } else if (!match) {
            renderRoom();
        }
        if (match) {
            updateOpponent();
            receiveAttacks();
            resolve();
        }
    }

    function opponentEntry() {
        return Object.entries(room.players || {}).find(([uid]) => uid !== me.uid) || [null, null];
    }

    function beginMatch(r) {
        match = { seed: r.seed, startAt: r.startAt, mode: r.mode, duration: r.duration, matchId: r.matchId, processed: new Set(), resolved: false };
        show('pk-lobby', false);
        show('pk-panel', true);
        document.body.classList.add('pk-mode');
        show('pk-menu-btn', true);
        document.querySelector('.leaderboard-panel').classList.add('hidden');
        const pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) pauseBtn.classList.add('hidden');
        const [, opp] = opponentEntry();
        $('#pk-opp-name').textContent = 'VS ' + (opp ? opp.name : '對手');
        match.tick = setInterval(tick, 200);
        tick();
    }

    function tick() {
        const now = net.now();
        const banner = $('#pk-banner');
        if (!game) {
            const left = match.startAt - now;
            const sfx = window.__slimeSfx || (window.__slimeSfx = new SlimeSFX());
            if (left > 0) {
                const n = Math.ceil(left / 1000);
                if (n !== match.lastBeep && n <= 3) { match.lastBeep = n; sfx.countdown(false); }
                banner.textContent = n; show('pk-banner', true); return;
            }
            sfx.countdown(true);
            banner.textContent = 'GO!'; setTimeout(() => show('pk-banner', false), 600);
            startGame();
        }
        if (match.mode === 'timed') {
            const remain = Math.max(0, match.startAt + match.duration * 1000 - now);
            const m = Math.floor(remain / 60000), s = Math.floor((remain % 60000) / 1000);
            $('#pk-timer').textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
            $('#pk-timer').classList.toggle('pk-urgent', remain < 15000);
        } else {
            const el = Math.max(0, now - match.startAt);
            $('#pk-timer').textContent = `♾ 生存 ${Math.floor(el / 60000)}:${String(Math.floor((el % 60000) / 1000)).padStart(2, '0')}`;
        }
        resolve();
    }

    function startGame() {
        game = new SlimeTetris({
            seed: match.seed,
            pvp: true,
            minLevel: () => (match.mode === 'survival' ? 1 + Math.floor(Math.max(0, net.now() - match.startAt) / SURVIVAL_SPEEDUP_MS) : 1),
            onClear: (cleared, combo) => {
                let atk = (ATTACK_BY_LINES[cleared] ?? cleared) + (COMBO_BONUS[Math.min(combo - 1, COMBO_BONUS.length - 1)] || 0);
                atk = game.cancelGarbage(atk);
                if (atk > 0 && !match.resolved) {
                    net.push(`rooms/${roomCode}/attacks`, { from: me.uid, n: atk, t: SERVER_TIME });
                    flash(`⚔ 攻擊 +${atk}`);
                    game.sfx.attack();
                }
            },
            onGarbageChange: (n) => {
                $('#pk-garbage-n').textContent = n;
                $('#pk-garbage-bar').style.background = `linear-gradient(to top, #e94560 ${Math.min(100, n * 10)}%, #2a2a4a 0)`;
            },
            onGameOver: (g) => {
                net.update(`rooms/${roomCode}/players/${me.uid}`, { alive: false, outAt: SERVER_TIME, score: Math.floor(g.score), lines: g.lines, board: g.snapshot() });
            },
        });
        window.__game = game;
        publish();
        match.publishTimer = setInterval(publish, PUBLISH_MS);
    }

    function publish() {
        if (!game || match.resolved || game.gameOver) return;
        net.update(`rooms/${roomCode}/players/${me.uid}`, { score: Math.floor(game.score), lines: game.lines, board: game.snapshot(), alive: true });
    }

    function receiveAttacks() {
        if (!game) return;
        const atks = room.attacks || {};
        Object.keys(atks).sort().forEach((id) => {
            if (match.processed.has(id)) return;
            match.processed.add(id);
            const a = atks[id];
            if (a && a.from !== me.uid && !match.resolved) { game.queueGarbage(a.n); flash(`💥 收到 ${a.n} 行垃圾`); }
        });
    }

    function updateOpponent() {
        const [, opp] = opponentEntry();
        if (!opp) return;
        $('#pk-opp-lines').textContent = opp.lines || 0;
        $('#pk-opp-score').textContent = opp.score || 0;
        $('#pk-opp-name').textContent = `VS ${opp.name}${opp.online === false ? '（斷線）' : ''}`;
        const c = $('#pk-opp-canvas');
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        if (c.width !== 60 * dpr) { c.width = 60 * dpr; c.height = 120 * dpr; }
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#090914'; ctx.fillRect(0, 0, 60, 120);
        const b = opp.board || '';
        for (let i = 0; i < b.length && i < 200; i++) {
            if (b[i] === '.') continue;
            ctx.fillStyle = b[i] === 'g' ? '#6b6b80' : '#4ecca3';
            ctx.fillRect((i % 10) * 6 + 0.5, Math.floor(i / 10) * 6 + 0.5, 5, 5);
        }
        if (opp.alive === false) { ctx.fillStyle = 'rgba(233,69,96,.75)'; ctx.fillRect(0, 50, 60, 20); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('KO', 30, 64); }
    }

    let flashTimer = null;
    function flash(text) {
        const b = $('#pk-banner');
        b.textContent = text; b.classList.add('pk-small'); show('pk-banner', true);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { show('pk-banner', false); b.classList.remove('pk-small'); }, 900);
    }

    // ------------------------------------------------------------------
    //  判定勝負（雙方都會判定，用 transaction 確保只寫入一次結果）
    // ------------------------------------------------------------------
    function decide() {
        const now = net.now();
        const entries = Object.entries(room.players || {});
        if (entries.length < 2) return null;
        const dead = entries.filter(([, p]) => p.alive === false).sort((a, b) => (a[1].outAt || 0) - (b[1].outAt || 0));
        if (dead.length) {
            const loser = dead[0][0];
            const winner = entries.find(([u]) => u !== loser)[0];
            return { winner, loser, reason: 'topout' };
        }
        for (const [uid, p] of entries) {
            if (p.online === false && p.offAt && now - p.offAt > DISCONNECT_FORFEIT_MS) {
                return { winner: entries.find(([u]) => u !== uid)[0], loser: uid, reason: 'disconnect' };
            }
        }
        if (room.mode === 'timed' && now >= room.startAt + room.duration * 1000) {
            const [a, b] = entries;
            const cmp = (b[1].lines || 0) - (a[1].lines || 0) || (b[1].score || 0) - (a[1].score || 0);
            if (cmp === 0) return { winner: null, loser: null, reason: 'time', draw: true };
            const w = cmp < 0 ? a : b, l = cmp < 0 ? b : a;
            return { winner: w[0], loser: l[0], reason: 'time' };
        }
        return null;
    }

    async function resolve() {
        if (!match || !room || match.resolved) return;
        if (room.result && room.matchId === match.matchId) { finishMatch(room.result); return; }
        if (room.status !== 'playing') return;
        const res = decide();
        if (!res) return;
        res.at = net.now();
        res.matchId = match.matchId;
        res.scores = Object.fromEntries(Object.entries(room.players).map(([u, p]) => [u, { name: p.name, score: u === me.uid && game ? Math.floor(game.score) : (p.score || 0), lines: u === me.uid && game ? game.lines : (p.lines || 0) }]));
        const final = await net.transaction(`rooms/${roomCode}/result`, (cur) => (cur && cur.matchId === match.matchId ? undefined : res));
        await net.update(`rooms/${roomCode}`, { status: 'ended' });
        finishMatch(final && final.matchId === match.matchId ? final : res);
    }

    async function finishMatch(result) {
        if (match.resolved) return;
        match.resolved = true;
        clearInterval(match.tick); clearInterval(match.publishTimer);
        if (game) { publishFinal(); game.stop(); }
        show('pk-banner', false);

        const myScore = game ? Math.floor(game.score) : 0;
        const outcome = result.draw ? 'draw' : result.winner === me.uid ? 'win' : 'loss';
        // 戰績 + 個人最佳（只在超過舊紀錄時更新）
        const isPB = myScore > (me.best || 0);
        const statKey = outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws';
        const doneKey = `pk_counted_${roomCode}_${result.matchId}`;
        if (!sessionStorage.getItem(doneKey)) {
            sessionStorage.setItem(doneKey, '1');
            me[statKey] = (me[statKey] || 0) + 1;
            const upd = { [statKey]: me[statKey], name: me.name, code: me.code, updatedAt: SERVER_TIME };
            if (isPB) { me.best = myScore; upd.best = myScore; }
            await net.update(`players/${me.uid}`, upd);
        }

        const [oppUid] = opponentEntry();
        const mine = (result.scores || {})[me.uid] || { score: myScore, lines: game ? game.lines : 0 };
        const theirs = (result.scores || {})[oppUid] || {};
        const reason = { topout: outcome === 'win' ? '對手堆到頂了！' : '你堆到頂了…', time: '時間到！', disconnect: outcome === 'win' ? '對手斷線超過 10 秒' : '你斷線超過 10 秒' }[result.reason] || '';
        $('#pk-result-card').innerHTML = `
          <div class="pk-outcome pk-${outcome}">${outcome === 'win' ? '🏆 勝利！' : outcome === 'loss' ? '😵 落敗' : '🤝 平手'}</div>
          <p class="pk-hint">${esc(reason)}</p>
          <table class="pk-score-table">
            <tr><th></th><th>行數</th><th>分數</th></tr>
            <tr class="me"><td>${esc(me.name)}</td><td>${mine.lines || 0}</td><td>${mine.score || 0}</td></tr>
            <tr><td>${esc(theirs.name || '對手')}</td><td>${theirs.lines || 0}</td><td>${theirs.score || 0}</td></tr>
          </table>
          ${isPB ? `<p class="pk-pb">🎉 新個人紀錄 ${myScore} 分！已更新排行榜</p>` : `<p class="pk-hint">個人最佳：${me.best || 0} 分</p>`}
          <button id="pk-again" class="ui-btn primary pk-big">↻ 回房間再來一局</button>
          <button id="pk-tolobby" class="ui-btn pk-ghost">離開房間</button>`;
        show('pk-result', true);
        const sfx = window.__slimeSfx;
        if (sfx) { if (outcome === 'win') sfx.win(); else if (outcome === 'loss') sfx.lose(); else sfx.countdown(true); }
        $('#pk-again').onclick = async () => {
            if (room && room.host === me.uid) await net.update(`rooms/${roomCode}`, { status: 'waiting' });
            location.href = `${location.pathname}?room=${roomCode}${qs.get('net') ? '&net=' + qs.get('net') : ''}`;
        };
        $('#pk-tolobby').onclick = () => leaveRoom();
    }

    function publishFinal() {
        if (!game) return;
        net.update(`rooms/${roomCode}/players/${me.uid}`, { score: Math.floor(game.score), lines: game.lines, board: game.snapshot() });
    }

    // ------------------------------------------------------------------
    //  單人模式：結束時自動更新個人最佳
    // ------------------------------------------------------------------
    function startSingle() {
        show('pk-lobby', false);
        show('pk-menu-btn', true);
        game = new SlimeTetris(net && me ? {
            onGameOver: async (g) => {
                const score = Math.floor(g.score);
                document.getElementById('final-score-text').innerText = '得分: ' + score;
                const ig = document.querySelector('#game-overlay .input-group');
                if (ig) ig.classList.add('hidden');
                let note = document.getElementById('pk-single-pb');
                if (!note) { note = document.createElement('p'); note.id = 'pk-single-pb'; note.className = 'pk-pb'; document.getElementById('final-score-text').after(note); }
                if (score > (me.best || 0)) {
                    me.best = score;
                    await net.update(`players/${me.uid}`, { best: score, name: me.name, code: me.code, updatedAt: SERVER_TIME });
                    note.textContent = `🎉 新個人紀錄！已更新排行榜`;
                    g.loadLeaderboard();
                } else note.textContent = `個人最佳：${me.best || 0} 分`;
                document.getElementById('game-overlay').classList.remove('hidden');
            },
        } : {});
        window.__game = game;
    }

    // ------------------------------------------------------------------
    //  啟動
    // ------------------------------------------------------------------
    async function boot() {
        injectUI();
        const useLocal = qs.get('net') === 'local';
        const cfg = window.FIREBASE_CONFIG;

        $('#pk-single').onclick = startSingle;
        document.querySelectorAll('#pk-modes button').forEach((b) => b.onclick = () => {
            document.querySelectorAll('#pk-modes button').forEach((x) => x.classList.remove('on'));
            b.classList.add('on');
            selMode = { mode: b.dataset.mode, duration: +b.dataset.dur };
            $('#pk-mode-hint').textContent = modeText(selMode);
        });
        $('#pk-mode-hint').textContent = modeText(selMode);

        if (!cfg && !useLocal) {
            show('pk-online', false);
            renderMe();
            status('PK 對戰需要先完成 Firebase 設定。');
            return;
        }
        status('連線中…');
        try {
            net = useLocal ? createLocalNet() : await createFirebaseNet(cfg);
        } catch (e) {
            console.warn(e);
            show('pk-online', false); renderMe();
            status('無法連線到 PK 伺服器，先玩單人模式吧。（' + (e.code || e.message || e) + '）');
            return;
        }
        const saved = (await net.get(`players/${net.uid}`)) || {};
        me = { uid: net.uid, code: shortCode(net.uid), name: saved.name || '', best: saved.best || 0, wins: saved.wins || 0, losses: saved.losses || 0, draws: saved.draws || 0 };
        renderMe();
        status('');
        const namePromise = askName(false);

        // 雲端排行榜：每位玩家的個人最佳
        LeaderboardAPI.fetchTopScores = async () => {
            const list = await net.topBest(5);
            return list.length ? list.map((p) => ({ name: `${p.name}`, score: p.best })) : [{ name: '還沒有紀錄', score: 0 }];
        };
        LeaderboardAPI.submitScore = async () => LeaderboardAPI.fetchTopScores();

        const needName = () => { if (!me.name) { status('請先輸入暱稱。'); const i = $('#pk-name-input'); if (i) i.focus(); return true; } return false; };
        $('#pk-create').onclick = () => { if (!needName()) createRoom().catch((e) => status('建立房間失敗：' + (e.code || e.message || e))); };
        $('#pk-join').onclick = () => { if (!needName()) joinRoom($('#pk-code').value).catch((e) => status('加入失敗：' + (e.code || e.message || e))); };
        $('#pk-ready').onclick = () => { const mine = (room.players || {})[me.uid] || {}; net.update(`rooms/${roomCode}/players/${me.uid}`, { ready: !mine.ready }); };
        $('#pk-start').onclick = () => startMatch();
        $('#pk-leave').onclick = () => leaveRoom();
        $('#pk-share').onclick = async () => {
            const url = `${location.origin}${location.pathname}?room=${roomCode}`;
            const text = `來跟我 PK 史萊姆方塊！房間碼 ${roomCode}`;
            try { if (navigator.share) { await navigator.share({ title: '史萊姆方塊 PK', text, url }); return; } } catch {}
            try { await navigator.clipboard.writeText(`${text}\n${url}`); $('#pk-room-status').textContent = '已複製邀請連結，貼給朋友就可以了！'; }
            catch { $('#pk-room-status').innerHTML = `長按複製這個連結傳給朋友：<br><span style="user-select:all;-webkit-user-select:all;word-break:break-all">${esc(url)}</span>`; }
        };

        const code = qs.get('room');
        if (code) {
            if (!me.name) status(`先取暱稱，再自動加入房間 ${code}`);
            await namePromise;
            await joinRoom(code);
        }
    }

    window.SlimePK = { boot };
})();
