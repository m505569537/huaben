(function(){
  'use strict';

  var $ = function(s){ return document.querySelector(s); };
  var CN = ['壹','贰','叁','肆','伍','陆','柒','捌'];

  // 当前游戏 id：内联打包时由 HUABEN.game 注入，开发时读 ?game= 参数
  var GAME_ID  = (window.HUABEN && window.HUABEN.game) ||
                 new URLSearchParams(location.search).get('game') || 'zhiwei';
  var SAVE_KEY = 'huaben.save.' + GAME_ID;
  var ENDS_KEY = 'huaben.ends.' + GAME_ID;

  var S = { stats:{}, flags:{}, node:null, log:[], chapter:'' };
  var finishTyping = null;

  /* ---------------- 工具 ---------------- */
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  /* ---------------- 存储（带健康检查，绝不静默失败） ---------------- */
  var LS = (function(){
    var probe = '__zw_probe__';
    try{
      localStorage.setItem(probe, '1');
      var ok = localStorage.getItem(probe) === '1';
      localStorage.removeItem(probe);
      if(ok){
        return {
          ok: true,
          get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
          set: function(k, v){ try{ localStorage.setItem(k, v); return true; }catch(e){ return false; } },
          del: function(k){ try{ localStorage.removeItem(k); }catch(e){} }
        };
      }
    }catch(e){ /* file:// 或被策略禁止 */ }
    return { ok:false, get:function(){ return null; }, set:function(){ return false; }, del:function(){} };
  })();

  function store(k, v){ return LS.set(k, v); }
  function read(k){ return LS.get(k); }
  function drop(k){ LS.del(k); }

  /* ---------------- 存档码（与 localStorage 无关，永远可用） ---------------- */
  function b64enc(str){
    var bytes = new TextEncoder().encode(str), bin = '';
    for(var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64dec(b64){
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function makeCode(){
    return 'ZW1:' + b64enc(JSON.stringify({
      v:1, s:S.stats, f:S.flags, n:S.node, c:S.chapter
    }));
  }

  function parseCode(txt){
    txt = String(txt || '').replace(/\s+/g, '');
    if(txt.indexOf('ZW1:') !== 0) throw new Error('开头应该是 ZW1:');
    var d = JSON.parse(b64dec(txt.slice(4)));
    if(!d || !d.n || !STORY.nodes[d.n]) throw new Error('节点无效');
    return d;
  }

  function applyCode(d){
    S.stats = {};
    STORY.stats.forEach(function(s){
      S.stats[s.key] = (d.s && d.s[s.key] != null) ? d.s[s.key] : s.init;
    });
    S.flags = d.f || {};
    S.chapter = d.c || '';
    S.log = [];
    buildHUD();
    show('scr-game');
    $('#prose').textContent = '';
    $('#choices').innerHTML = '';
    goto(d.n);
  }

  /* ---------------- 存档 ---------------- */
  function save(){
    store(SAVE_KEY, JSON.stringify({
      stats: S.stats, flags: S.flags, node: S.node,
      log: S.log.slice(-120), chapter: S.chapter
    }));
  }
  function hasSave(){ return !!read(SAVE_KEY); }

  function readSave(){
    try{ return JSON.parse(read(SAVE_KEY) || 'null'); }catch(e){ return null; }
  }

  function endings(){
    try{ return JSON.parse(read(ENDS_KEY) || '[]'); }catch(e){ return []; }
  }
  function totalEndings(){
    var n = 0;
    for (var k in STORY.nodes) if (STORY.nodes[k].ending) n++;
    return n;
  }

  /* ---------------- 条件与结算 ---------------- */
  function cond(expr){
    if(!expr) return true;
    try{
      var scope = { has: function(f){ return !!S.flags[f]; } };
      STORY.stats.forEach(function(s){ scope[s.key] = S.stats[s.key] || 0; });
      var keys = Object.keys(scope);
      var vals = keys.map(function(k){ return scope[k]; });
      return !!new Function(keys.join(','), '"use strict";return (' + expr + ');')(...vals);
    }catch(e){
      console.warn('[知微] 条件写错了：' + expr, e);
      return true;
    }
  }

  function applyEffect(eff){
    var changes = [];
    if(!eff) return changes;
    Object.keys(eff).forEach(function(k){
      var v = eff[k];
      if(k === 'flags'){
        (v || []).forEach(function(f){ S.flags[f] = true; });
        return;
      }
      if(typeof v === 'number'){
        var cfg = null;
        for(var i=0;i<STORY.stats.length;i++) if(STORY.stats[i].key === k) cfg = STORY.stats[i];
        var min = cfg ? cfg.min : 0;
        var max = cfg ? cfg.max : 9999;
        var before = (S.stats[k] == null) ? (cfg ? cfg.init : 0) : S.stats[k];
        var after = Math.max(min, Math.min(max, before + v));
        S.stats[k] = after;
        if(after !== before) changes.push({ key:k, d:after - before });
      } else if(typeof v === 'boolean'){
        S.flags[k] = v;
      }
    });
    return changes;
  }

  /* ---------------- 界面 ---------------- */
  function show(id){
    document.querySelectorAll('.screen').forEach(function(el){
      el.classList.toggle('is-on', el.id === id);
    });
  }

  function buildHUD(){
    $('#stats').innerHTML = STORY.stats.map(function(s){
      return '<div class="stat" data-k="' + esc(s.key) + '">' +
        '<div class="stat-name">' + esc(s.key) + '</div>' +
        '<div class="stat-val">' + (S.stats[s.key] || 0) + '</div>' +
        '<div class="stat-bar"><i style="background:' + (s.color || '#d3b073') + '"></i></div>' +
      '</div>';
    }).join('');
    paintHUD();
  }

  function paintHUD(){
    STORY.stats.forEach(function(s){
      var el = document.querySelector('.stat[data-k="' + s.key + '"]');
      if(!el) return;
      var v = S.stats[s.key] || 0;
      el.querySelector('.stat-val').textContent = v;
      var pct = (v - s.min) / Math.max(1, s.max - s.min) * 100;
      pct = Math.max(0, Math.min(100, pct));
      el.querySelector('.stat-bar i').style.width = pct.toFixed(1) + '%';
    });
  }

  function toast(c){
    var el = document.createElement('div');
    el.className = 'toast ' + (c.d > 0 ? 'up' : 'down');
    el.textContent = (c.d > 0 ? '+' : '') + c.d + ' ' + c.key;
    $('#toasts').appendChild(el);
    setTimeout(function(){ el.remove(); }, 1750);
  }

  function setChapter(txt){
    if(txt) S.chapter = txt;
    $('#chapter').textContent = S.chapter || '';
  }

  /* ---------------- 打字机 ---------------- */
  function typeText(host, text, onDone){
    var speed = 17;
    var i = 0;
    var stopped = false;
    var tw = document.createElement('span');
    var caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▍';
    host.innerHTML = '';
    host.appendChild(tw);
    host.appendChild(caret);

    function finish(){
      if(stopped) return;
      stopped = true;
      clearInterval(timer);
      tw.textContent = text;
      if(caret.parentNode) caret.remove();
      finishTyping = null;
      onDone && onDone();
    }

    var timer = setInterval(function(){
      i += 1;
      tw.textContent = text.slice(0, i);
      if(i >= text.length) finish();
    }, speed);

    finishTyping = finish;
    return finish;
  }

  /* ---------------- 渲染节点 ---------------- */
  function goto(id, extraChanges){
    var node = STORY.nodes[id];
    if(!node){
      console.error('[知微] 找不到节点：' + id);
      return;
    }
    S.node = id;

    var changes = (extraChanges || []).concat(applyEffect(node.effect));
    paintHUD();
    changes.forEach(toast);

    if(node.ending){ showEnding(node.ending); return; }

    if(node.chapter) setChapter(node.chapter);
    S.log.push({ ch: S.chapter, text: node.text || '' });
    save();

    $('#stage').scrollTop = 0;
    typeText($('#prose'), node.text || '', function(){
      requestAnimationFrame(function(){ revealChoices(node); });
    });
    renderChoices(node, true);
  }

  function renderChoices(node, hidden){
    var box = $('#choices');
    box.innerHTML = '';
    box.style.visibility = hidden ? 'hidden' : 'visible';

    var list = node.choices;
    if(!list && node.next) list = [{ text:'继续', next: node.next }];
    if(!list){
      var d = document.createElement('div');
      d.className = 'deadend';
      d.textContent = '这条线到这里断了。';
      box.appendChild(d);
      return;
    }

    var open = 0;
    list.forEach(function(c, i){
      var ok = cond(c.require);
      if(ok) open++;
      var b = document.createElement('button');
      b.className = 'choice' + (ok ? '' : ' is-locked');
      b.style.animationDelay = (i * 66) + 'ms';
      b.type = 'button';
      b.innerHTML =
        '<span class="mark">' + (CN[i] || (i + 1)) + '</span>' +
        '<span class="ctext">' + esc(c.text) +
          (ok ? '' : '<span class="lock">' + esc(c.hint || c.require || '条件不足') + '</span>') +
        '</span>';
      if(ok){
        b.addEventListener('click', function(){ pick(c); });
      }
      box.appendChild(b);
    });

    if(open === 0){
      var tip = document.createElement('div');
      tip.className = 'deadend';
      tip.textContent = '条件都不满足——这个剧本需要一条兜底选项。';
      box.appendChild(tip);
    }
  }

  function revealChoices(node){
    var box = $('#choices');
    box.style.visibility = 'visible';
    var first = box.firstElementChild;
    if(!first) return;

    var st = $('#stage');
    var sr = st.getBoundingClientRect();
    var br = box.getBoundingClientRect();
    if(br.bottom <= sr.bottom - 8) return;

    // 选项整体放得下就滚到底，让玩家一眼看到全部；放不下就只保证第一个完整可见
    if(br.height < sr.height - 32){
      st.scrollTo({ top: st.scrollHeight, behavior:'smooth' });
    } else {
      first.scrollIntoView({ block:'nearest', behavior:'smooth' });
    }
  }

  function pick(c){
    if(finishTyping) finishTyping();
    document.querySelectorAll('.choice').forEach(function(el){ el.classList.add('is-dead'); });
    var changes = applyEffect(c.effect);
    setTimeout(function(){ goto(c.next, changes); }, 110);
  }

  /* ---------------- 结局 ---------------- */
  function showEnding(e){
    var list = endings();
    if(list.indexOf(e.title) === -1){
      list.push(e.title);
      store(ENDS_KEY, JSON.stringify(list));
    }
    drop(SAVE_KEY);
    finishTyping = null;

    $('#end-label').textContent = e.label || '结局';
    $('#end-title').textContent = e.title || '';
    $('#end-rank').textContent = e.rank || '';
    $('#end-rank').style.display = e.rank ? '' : 'none';
    $('#end-text').textContent = e.text || '';
    $('#end-comment').textContent = e.comment || '';
    $('#end-progress').textContent = '已解锁结局 ' + list.length + ' / ' + totalEndings();
    show('scr-end');
    $('#scr-end').scrollTop = 0;
  }

  /* ---------------- 流程 ---------------- */
  function newGame(){
    S.stats = {}; S.flags = {}; S.log = []; S.chapter = '';
    STORY.stats.forEach(function(s){ S.stats[s.key] = s.init; });
    buildHUD();
    show('scr-game');
    $('#prose').textContent = '';
    $('#choices').innerHTML = '';
    goto(STORY.start);
  }

  function resume(){
    var d = readSave();
    if(!d) return newGame();
    S.stats = {};
    STORY.stats.forEach(function(s){
      S.stats[s.key] = (d.stats && d.stats[s.key] != null) ? d.stats[s.key] : s.init;
    });
    S.flags = d.flags || {};
    S.log = d.log || [];
    S.chapter = d.chapter || '';
    buildHUD();
    show('scr-game');
    $('#prose').textContent = '';
    $('#choices').innerHTML = '';
    goto(d.node || STORY.start);
  }

  function toCover(){
    show('scr-title');
    var has = hasSave();
    var start = $('#btn-start'), cont = $('#btn-continue');
    start.textContent = has ? '重新开始' : '开 始';
    start.className = has ? 'btn-ghost' : 'btn-primary';
    cont.hidden = !has;
    cont.className = has ? 'btn-primary' : 'btn-ghost';
    var n = endings().length;
    var btn = $('#btn-ends');
    if(n > 0){
      btn.hidden = false;
      btn.textContent = '已解锁结局 ' + n + ' / ' + totalEndings();
    } else {
      btn.hidden = true;
    }
  }

  /* ---------------- 存储告警 ---------------- */
  function checkStore(){
    if(LS.ok) return;
    var cover = $('#warnbar');
    cover.hidden = false;
    cover.innerHTML = location.protocol === 'file:'
      ? '<b>进度不会自动保存。</b>你是双击打开文件的，浏览器把本地存储当成临时数据。在项目目录运行 <b>./serve.sh</b>，' +
        '改用 <b>http://127.0.0.1:8765</b> 打开就会自动存档；也可以用下面的「存档码」手动保存。'
      : '<b>进度不会自动保存。</b>浏览器禁用了本地存储（无痕模式或站点设置拦截了）。请用工具栏的「存档」导出存档码。';

    var game = $('#warnbar-game');
    game.hidden = false;
    game.textContent = '进度不会保存 · 点下方「存档」导出存档码';
    $('#btn-code-cover').hidden = false;
  }

  /* ---------------- 存档码界面 ---------------- */
  function openCode(){
    var out = $('#code-out');
    var msg = $('#code-msg');
    msg.textContent = '';
    msg.className = 'code-msg';
    if(S.node){
      out.value = makeCode();
      out.placeholder = '';
    } else {
      out.value = '';
      out.placeholder = '还没有进行中的游戏';
    }
    $('#code-sheet').classList.add('is-on');
  }

  function closeCode(){ $('#code-sheet').classList.remove('is-on'); }

  function copyCode(){
    var box = $('#code-out'), msg = $('#code-msg');
    var txt = box.value;
    if(!txt){ msg.textContent = '还没有可导出的存档'; msg.className = 'code-msg bad'; return; }

    function ok(){ msg.textContent = '已复制到剪贴板'; msg.className = 'code-msg ok'; }
    function fb(){
      box.focus(); box.select();
      try{ document.execCommand('copy'); ok(); }
      catch(e){ msg.textContent = '复制失败，请长按选中手动复制'; msg.className = 'code-msg bad'; }
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(ok).catch(fb);
    } else fb();
  }

  function loadCode(){
    var msg = $('#code-msg');
    try{
      var d = parseCode($('#code-in').value);
      closeCode();
      applyCode(d);
    }catch(e){
      msg.textContent = '存档码无效：' + (e.message || '解析失败');
      msg.className = 'code-msg bad';
    }
  }

  /* ---------------- 绑定 ---------------- */
  function init(){
    $('#t-title').textContent = STORY.meta.title;
    $('#t-sub').textContent = STORY.meta.subtitle;
    $('#t-tag').textContent = STORY.meta.tagline;
    $('#btn-continue').hidden = !hasSave();
    document.title = STORY.meta.title;

    $('#btn-start').addEventListener('click', function(){
      drop(SAVE_KEY);
      newGame();
    });
    $('#btn-continue').addEventListener('click', resume);
    $('#btn-again').addEventListener('click', newGame);
    $('#btn-end-home').addEventListener('click', toCover);
    $('#btn-home').addEventListener('click', toCover);

    $('#btn-log').addEventListener('click', function(){
      var body = $('#sheet-body');
      body.innerHTML = S.log.length
        ? S.log.map(function(l){
            return '<div class="log-item">' +
              (l.ch ? '<div class="log-ch">' + esc(l.ch) + '</div>' : '') +
              '<div class="log-tx">' + esc(l.text) + '</div></div>';
          }).join('')
        : '<div class="log-empty">还没有记录</div>';
      $('#sheet').classList.add('is-on');
      body.scrollTop = body.scrollHeight;
    });
    $('#btn-sheet-close').addEventListener('click', function(){
      $('#sheet').classList.remove('is-on');
    });

    $('#btn-code').addEventListener('click', openCode);
    $('#btn-code-cover').addEventListener('click', openCode);
    $('#btn-code-close').addEventListener('click', closeCode);
    $('#btn-copy').addEventListener('click', copyCode);
    $('#btn-load-code').addEventListener('click', loadCode);

    // 刷新/关页前再落一次盘
    window.addEventListener('pagehide', function(){
      if(S.node && !$('#scr-end').classList.contains('is-on')) save();
    });

    // 点正文区跳过打字机
    $('#stage').addEventListener('click', function(){
      if(finishTyping) finishTyping();
    });

    toCover();
    checkStore();
  }

  /* ---------------- 启动：优先用已内联的剧本，否则动态加载 ---------------- */
  function boot(){ init(); }

  if (typeof STORY !== 'undefined' && STORY && STORY.nodes) {
    boot();
  } else {
    var gid  = GAME_ID;
    var base = (window.HUABEN && window.HUABEN.gamesBase) || '../games/';
    var tag  = document.createElement('script');
    tag.src  = base + gid + '/story.js';
    tag.onload  = boot;
    tag.onerror = function(){
      document.body.innerHTML = '<pre style="padding:48px 28px;color:#c0473a;font:13px/1.9 ui-monospace,monospace;white-space:pre-wrap">'
        + '找不到剧本\n\n  ' + tag.src + '\n\n检查 games/' + gid + '/story.js 是否存在，\n或地址栏的 ?game= 参数写错了。</pre>';
    };
    document.head.appendChild(tag);
  }
})();

