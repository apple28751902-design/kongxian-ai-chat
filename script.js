// ====== State & Utilities ======
const $ = (sel)=>document.querySelector(sel);
const $$ = (sel)=>Array.from(document.querySelectorAll(sel));

const STORAGE = {
  settings: 'ac_settings_v1',
  characters: 'ac_characters_v1',
  actions: 'ac_actions_v1',
  sessions: 'ac_sessions_v1',
};

const defaultSettings = {
  provider: 'openai',
  apiKey: '',
  apiBase: '',
  model: 'gpt-4o-mini',
  streaming: true,
  force500: true,
};

let state = {
  settings: load(STORAGE.settings, defaultSettings),
  characters: load(STORAGE.characters, []),
  actions: load(STORAGE.actions, [
    {id: id(), label: '撒嬌', prompt: '角色在不失人設的前提下，親密地撒嬌，語氣軟糯，但不越界。'},
    {id: id(), label: '吐槽', prompt: '角色機智吐槽並帶點幽默，保持好感。'},
    {id: id(), label: '安慰', prompt: '角色溫柔安慰，提供實際支持與貼心話語。'},
  ]),
  currentCharId: null,
  sessions: load(STORAGE.sessions, {}), // {charId: {messages:[], memory:'', affection:50}}
};

function id(){ return Math.random().toString(36).slice(2,9) }
function load(k, fallback){ try{ return JSON.parse(localStorage.getItem(k)) ?? fallback }catch{ return fallback } }
function save(k, v){ localStorage.setItem(k, JSON.stringify(v)) }

function ensureSession(charId){
  if(!state.sessions[charId]){
    state.sessions[charId] = { messages: [], memory: '', affection: 50 };
    save(STORAGE.sessions, state.sessions);
  }
  return state.sessions[charId];
}

// ====== UI Init ======
function init(){
  // Settings
  $('#provider').value = state.settings.provider;
  $('#apiKey').value = state.settings.apiKey;
  $('#apiBase').value = state.settings.apiBase;
  $('#model').value = state.settings.model;
  $('#streaming').checked = !!state.settings.streaming;
  $('#force500').checked = !!state.settings.force500;
  $('#tone').value = '甜蜜';

  $('#saveSettings').onclick = saveSettings;

  // Characters
  renderCharList();
  $('#newCharBtn').onclick = ()=> openCharEditor();

  // Actions
  renderActionList();
  $('#newActionBtn').onclick = ()=> openActionEditor();

  // Memory & affection
  $('#saveMemory').onclick = onSaveMemory;
  $('#summarizeMemory').onclick = onSummarizeMemory;
  $('#exportChat').onclick = onExport;
  $('#clearChat').onclick = onClear;

  // Composer
  $('#sendBtn').onclick = onSend;
  $('#userInput').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); onSend(); }
  });
  $('#useOpener').onclick = useOpener;

  // Range
  $('#affectionRange').addEventListener('input', (e)=>{
    $('#affectionValue').textContent = e.target.value;
    const sess = currentSession(); if(sess){ sess.affection = +e.target.value; persistSessions(); }
  });

  // Select first character if exists
  if(state.characters.length){ selectCharacter(state.characters[0].id); }
  fitForIOS();
}

function fitForIOS(){
  // avoid viewport bouncing on iPad when keyboard shows
  const fix = ()=>document.body.style.height = window.innerHeight + 'px';
  window.addEventListener('resize', fix); fix();
}

function saveSettings(){
  state.settings = {
    provider: $('#provider').value,
    apiKey: $('#apiKey').value.trim(),
    apiBase: $('#apiBase').value.trim(),
    model: $('#model').value.trim() || 'gpt-4o-mini',
    streaming: $('#streaming').checked,
    force500: $('#force500').checked,
  };
  save(STORAGE.settings, state.settings);
  alert('設定已儲存（保存在本機瀏覽器）。');
}

function renderCharList(){
  const wrap = $('#charList'); wrap.innerHTML='';
  state.characters.forEach(c=>{
    const item = document.createElement('div');
    item.className='char-item';
    item.innerHTML = `<div>
      <div class="name">${esc(c.name)}</div>
      <div class="desc">${esc(c.persona).slice(0,60)}</div>
    </div>
    <div>
      <button data-id="${c.id}" class="edit">編輯</button>
      <button data-id="${c.id}" class="enter">進入</button>
    </div>`;
    item.querySelector('.edit').onclick = ()=> openCharEditor(c.id);
    item.querySelector('.enter').onclick = ()=> selectCharacter(c.id);
    wrap.appendChild(item);
  });
}

function renderActionList(){
  const wrap = $('#actionList'); wrap.innerHTML='';
  state.actions.forEach(a=>{
    const item = document.createElement('div');
    item.className='action-item';
    item.innerHTML = `<div class="name">${esc(a.label)}</div>
      <div>
        <button data-id="${a.id}" class="use">使用</button>
        <button data-id="${a.id}" class="edit">編輯</button>
      </div>`;
    item.querySelector('.use').onclick = ()=> useAction(a.id);
    item.querySelector('.edit').onclick = ()=> openActionEditor(a.id);
    wrap.appendChild(item);
  });
}

function esc(s){ return (s??'').toString().replace(/[&<>]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m])) }

// ====== Character Editor ======
function openCharEditor(charId=null){
  const dlg = $('#charEditor');
  const editing = state.characters.find(c=>c.id===charId) || { id:id(), name:'', persona:'', opener:'', rules:'' };
  $('#charName').value = editing.name;
  $('#charPersona').value = editing.persona;
  $('#charOpener').value = editing.opener;
  $('#charRules').value = editing.rules;

  $('#deleteChar').style.display = state.characters.find(c=>c.id===charId)?'inline-block':'none';

  dlg.showModal();

  $('#saveChar').onclick = (e)=>{
    e.preventDefault();
    editing.name = $('#charName').value.trim();
    editing.persona = $('#charPersona').value.trim();
    editing.opener = $('#charOpener').value.trim();
    editing.rules = $('#charRules').value.trim();
    if(!editing.name){ alert('請輸入角色名稱'); return }
    const i = state.characters.findIndex(c=>c.id===editing.id);
    if(i>=0){ state.characters[i]=editing } else { state.characters.push(editing) }
    save(STORAGE.characters, state.characters);
    renderCharList();
    dlg.close();
  };

  $('#deleteChar').onclick = ()=>{
    if(confirm('確定刪除此角色？')){
      state.characters = state.characters.filter(c=>c.id!==editing.id);
      save(STORAGE.characters, state.characters);
      renderCharList();
      if(state.currentCharId===editing.id){ state.currentCharId=null; $('#charTitle').textContent='未選擇角色'; $('#charDesc').textContent=''; $('#chat').innerHTML=''; }
      dlg.close();
    }
  };
}

function selectCharacter(charId){
  state.currentCharId = charId;
  const c = currentChar();
  $('#charTitle').textContent = c.name;
  $('#charDesc').textContent = c.persona;
  const sess = ensureSession(charId);
  $('#memory').value = sess.memory || '';
  $('#affectionValue').textContent = (sess.affection??50);
  $('#affectionRange').value = (sess.affection??50);
  renderChat();
}

function currentChar(){ return state.characters.find(c=>c.id===state.currentCharId) }
function currentSession(){ return state.sessions[state.currentCharId] }

// ====== Actions (Custom Buttons) ======
function openActionEditor(actionId=null){
  const dlg = $('#actionEditor');
  const editing = state.actions.find(a=>a.id===actionId) || { id:id(), label:'', prompt:'' };
  $('#actionLabel').value = editing.label;
  $('#actionPrompt').value = editing.prompt;
  $('#deleteAction').style.display = state.actions.find(a=>a.id===actionId)?'inline-block':'none';
  dlg.showModal();

  $('#saveAction').onclick = (e)=>{
    e.preventDefault();
    editing.label = $('#actionLabel').value.trim();
    editing.prompt = $('#actionPrompt').value.trim();
    if(!editing.label){ alert('請填入按鍵名稱'); return }
    const i = state.actions.findIndex(a=>a.id===editing.id);
    if(i>=0){ state.actions[i]=editing } else { state.actions.push(editing) }
    save(STORAGE.actions, state.actions);
    renderActionList();
    dlg.close();
  };

  $('#deleteAction').onclick = ()=>{
    if(confirm('確定刪除此按鍵？')){
      state.actions = state.actions.filter(a=>a.id!==editing.id);
      save(STORAGE.actions, state.actions);
      renderActionList();
      dlg.close();
    }
  };
}

function useAction(actionId){
  const a = state.actions.find(a=>a.id===actionId);
  if(!a) return;
  const area = $('#userInput');
  area.value = (area.value ? area.value + '\n' : '') + `［按鍵：${a.label}］\n`;
  area.focus();
}

// ====== Chat Rendering ======
function renderChat(){
  const sess = currentSession(); const chat = $('#chat'); chat.innerHTML='';
  if(!sess) return;
  sess.messages.forEach(m=> addMsg(m.role, m.content, m.meta));
  chat.scrollTop = chat.scrollHeight;
}

function addMsg(role, content, meta={}){
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (role==='user'?'me':'ai');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  metaEl.textContent = meta.time || new Date().toLocaleString();
  wrap.appendChild(bubble);
  wrap.appendChild(metaEl);
  $('#chat').appendChild(wrap);
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

// ====== Conversation Logic ======
function useOpener(){
  const c = currentChar(); if(!c) return alert('請先建立或選擇角色');
  const sess = currentSession();
  if(c.opener?.trim()){
    sess.messages.push({ role:'assistant', content:c.opener.trim(), meta:{time:new Date().toLocaleString(), opener:true} });
  }else{
    sess.messages.push({ role:'assistant', content:`*靜靜地注視著你，露出一個微妙的笑。*\n「嗨，我是${c.name}。」`, meta:{time:new Date().toLocaleString(), opener:true} });
  }
  persistSessions();
  renderChat();
}

function onSaveMemory(){
  const sess = currentSession(); if(!sess) return;
  sess.memory = $('#memory').value;
  persistSessions();
  alert('記憶已儲存。');
}

function persistSessions(){ save(STORAGE.sessions, state.sessions) }

function onExport(){
  const c = currentChar(); const sess = currentSession();
  if(!c || !sess) return;
  const data = {
    character: c,
    memory: sess.memory,
    affection: sess.affection,
    messages: sess.messages,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${c.name}-chat.json`; a.click();
  URL.revokeObjectURL(url);
}

function onClear(){
  const c = currentChar(); if(!c) return;
  if(confirm('清空目前對話？')){
    state.sessions[c.id].messages = [];
    persistSessions(); renderChat();
  }
}

async function onSummarizeMemory(){
  const sess = currentSession(); const c = currentChar();
  if(!sess || !c) return;
  const last = sess.messages.slice(-8).map(m=>`${m.role=== 'user'?'玩家':'角色'}：${m.content}`).join('\n');
  const prompt = `請將以下對話整理成「角色對玩家的長期記憶」的摘要（100～200字），保留偏好、關係變化、承諾、禁忌與未完成的目標：\n${last}`;
  const result = await callModel([{role:'system', content:'你是擅長提煉關係記憶的助理。'}, {role:'user', content:prompt}], 300);
  if(result.ok){
    sess.memory = (sess.memory? (sess.memory.trim()+'\n') : '') + result.text.trim();
    $('#memory').value = sess.memory;
    persistSessions();
  }else{
    alert(result.error || '整理失敗');
  }
}

// ====== Send & Model Call ======
async function onSend(){
  const c = currentChar(); const sess = currentSession();
  if(!c) return alert('請先建立或選擇角色');
  const input = $('#userInput'); const userText = input.value.trim();
  if(!userText) return;
  input.value = '';
  const tone = $('#tone').value;
  const enforce500 = $('#force500').checked;

  // add user msg
  const userMsg = { role:'user', content:userText, meta:{time:new Date().toLocaleString()} };
  sess.messages.push(userMsg); addMsg('user', userText, userMsg.meta);

  // Build system prompt
  const sessMem = sess.memory || '';
  const affection = sess.affection ?? 50;
  const actionHints = collectActionHints(userText);
  const system = [
    `你是戀愛向角色扮演AI，使用「繁體中文小說體」。`,
    `格式要求：以*斜體*描寫動作、心理與環境；對白使用「」；避免口語註解與列表格式。`,
    `每次輸出字數${enforce500 ? '不少於500字（若不足，請補充內心戲、動作、細節）' : '視情況調整，建議300–600字' }。`,
    `角色：${c.name}。人設：${c.persona || '（無）'}。規則：${c.rules || '（無）' }。`,
    `與玩家關係的長期記憶（可引用但不要逐字背誦）：${sessMem || '（暫無）' }。`,
    `好感度（0–100）：${affection}。好感度越高越親密、越願意袒露心境，但仍需尊重界線。`,
    `語氣偏好：${tone}。`,
    actionHints ? `情境加成：${actionHints}` : '',
    `避免輸出系統訊息或自述為AI。請自然沉浸，不要跳脫人物。`,
  ].filter(Boolean).join('\n');

  const messages = [
    { role:'system', content: system },
    ...sess.messages.slice(-10).map(m=>({role:m.role, content:m.content})),
  ];

  // show placeholder
  const thinking = { role:'assistant', content:'', meta:{time:new Date().toLocaleString()} };
  sess.messages.push(thinking);
  const placeholderEl = addStreamingPlaceholder();

  const res = await callModel(messages, 1400, $('#streaming').checked, placeholderEl);
  if(res.ok){
    thinking.content = res.text;
    placeholderEl.replaceWith(renderFinalBubble(res.text));
  }else{
    thinking.content = `[錯誤] ${res.error||'生成失敗'}`;
    placeholderEl.replaceWith(renderFinalBubble(thinking.content));
  }
  persistSessions();
  // auto affection tweak
  tweakAffection(userText, res.text||'');
}

function collectActionHints(userText){
  const matches = [...userText.matchAll(/［按鍵：(.+?)］/g)].map(m=>m[1]);
  if(!matches.length) return '';
  const map = Object.fromEntries(state.actions.map(a=>[a.label,a.prompt]));
  const prompts = matches.map(l=> map[l] || `${l}（依常識發揮）`);
  return prompts.join('；');
}

function addStreamingPlaceholder(){
  const wrap = document.createElement('div');
  wrap.className = 'msg ai';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = '…生成中';
  wrap.appendChild(bubble);
  const metaEl = document.createElement('div');
  metaEl.className = 'meta'; metaEl.textContent = new Date().toLocaleString();
  wrap.appendChild(metaEl);
  $('#chat').appendChild(wrap);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return wrap;
}

function renderFinalBubble(text){
  const wrap = document.createElement('div');
  wrap.className = 'msg ai';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  const metaEl = document.createElement('div');
  metaEl.className = 'meta'; metaEl.textContent = new Date().toLocaleString();
  wrap.appendChild(metaEl);
  return wrap;
}

// ====== Affection Heuristic ======
function tweakAffection(user, ai){
  let delta = 0;
  const pos = /(謝謝|喜歡你|抱抱|可愛|溫柔|辛苦了|愛你)/g;
  const neg = /(生氣|討厭|走開|笨蛋|哭|難過|冷淡)/g;
  if(pos.test(user)) delta += 2;
  if(neg.test(user)) delta -= 2;
  if(ai.length > 600) delta += 1;
  const sess = currentSession();
  if(!sess) return;
  sess.affection = Math.max(0, Math.min(100, (sess.affection??50) + delta));
  $('#affectionRange').value = sess.affection;
  $('#affectionValue').textContent = sess.affection;
  persistSessions();
}

// ====== Provider Calls ======
async function callModel(messages, maxTokens=800, streaming=true, streamEl=null){
  const { provider, apiKey, apiBase, model } = state.settings;
  if(!apiKey){ return { ok:false, error:'尚未設定 API Key' } }

  // Build request for OpenAI / OpenRouter compatible APIs
  const url = (apiBase?.trim())
    || (provider==='openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');

  const headers = {
    'Content-Type':'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if(provider==='openrouter'){ headers['HTTP-Referer'] = location.origin; headers['X-Title'] = '角色AI聊天' }

  const body = {
    model,
    messages,
    temperature: 0.9,
    top_p: 0.95,
    presence_penalty: 0.3,
    frequency_penalty: 0.2,
    stream: !!streaming,
    max_tokens: maxTokens,
  };

  try{
    const resp = await fetch(url, { method:'POST', headers, body: JSON.stringify(body) });
    if(!resp.ok){
      const text = await resp.text();
      return { ok:false, error:`HTTP ${resp.status}：${text.slice(0,200)}` };
    }
    if(streaming){
      let acc = '';
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const bubble = streamEl?.querySelector('.bubble');
      while(true){
        const {value, done} = await reader.read();
        if(done) break;
        const chunk = decoder.decode(value, {stream:true});
        for(const line of chunk.split('\n')){
          const m = line.match(/^data:\s*(.+)$/);
          if(!m) continue;
          if(m[1] === '[DONE]') break;
          try{
            const json = JSON.parse(m[1]);
            const delta = json.choices?.[0]?.delta?.content || '';
            acc += delta;
            if(bubble){
              bubble.textContent = acc;
              $('#chat').scrollTop = $('#chat').scrollHeight;
            }
          }catch{ /* ignore */ }
        }
      }
      return { ok:true, text: acc.trim() };
    }else{
      const json = await resp.json();
      const text = json.choices?.[0]?.message?.content || '';
      return { ok:true, text: text.trim() };
    }
  }catch(err){
    return { ok:false, error: String(err) };
  }
}

// ====== Boot ======
window.addEventListener('DOMContentLoaded', init);
