(() => {
  // Enter the Supabase project URL and publishable (or anon) key after setup.
  const config = window.NUNATOUCH_DATABASE || {};
  const nameKey = 'nunatouch-name', queueKey = 'nunatouch-pending-v1';
  const dialog = document.querySelector('#name-dialog'), form = document.querySelector('#name-form');
  const nameInput = document.querySelector('#player-name'), scoreLabel = document.querySelector('#session-score');
  const list = document.querySelector('#leaderboard-list'), message = document.querySelector('#leaderboard-message');
  let name = sessionStorage.getItem(nameKey), score = 0, pending = 0, sending = false;
  const configured = Boolean(config.url && config.key);
  function queue() { try { return JSON.parse(localStorage.getItem(queueKey) || '[]'); } catch { return []; } }
  function saveQueue(items) { localStorage.setItem(queueKey, JSON.stringify(items)); }
  function stash() {
    if (!name || pending < 1) return;
    const amount = Math.floor(pending); pending -= amount;
    const items = queue(); items.push({id: crypto.randomUUID(), name, amount}); saveQueue(items);
  }
  async function rpc(method, data) {
    const res = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/rpc/${method}`, {method:'POST', headers:{apikey:config.key, Authorization:`Bearer ${config.key}`, 'Content-Type':'application/json'}, body:JSON.stringify(data)});
    if (!res.ok) throw new Error(`database ${res.status}`);
    return res.json();
  }
  async function flush() {
    stash(); if (!configured || sending) return;
    sending = true;
    try {
      // Remove only the acknowledged ID: newly queued batches remain intact.
      while (queue().length) {
        const item = queue()[0];
        await rpc('add_touch_score', {p_id:item.id, p_name:item.name, p_score:item.amount});
        saveQueue(queue().filter(x => x.id !== item.id));
      }
      await refresh();
    } catch { message.textContent = '점수 저장을 기다리고 있어요. 연결되면 다시 시도합니다.'; }
    finally { sending = false; }
  }
  async function refresh() {
    if (!configured || document.hidden) return;
    try {
      const rows = await rpc('touch_leaderboard', {}); list.replaceChildren();
      rows.forEach((row, i) => { const li=document.createElement('li'); li.textContent=`${i+1}. ${row.display_name} — ${Number(row.total_score).toLocaleString()}점`; list.append(li); });
      message.textContent = rows.length ? '30초마다 순위를 갱신해요.' : '아직 기록이 없어요. 첫 점수를 남겨 보세요.';
    } catch { message.textContent = '순위를 불러오지 못했어요.'; }
  }
  form.addEventListener('submit', e => { e.preventDefault(); const value=nameInput.value.normalize('NFC').trim(); if (!value) return; name=value; sessionStorage.setItem(nameKey,name); dialog.close(); });
  if (!name) dialog.showModal();
  if (!configured) message.textContent='공통 순위표 연결이 아직 설정되지 않았어요.';
  window.NunaScore = { add(distance) { if (!name || !Number.isFinite(distance) || distance <= 0) return; score += distance; pending += distance; scoreLabel.textContent = `${Math.floor(score).toLocaleString()}점`; } };
  setInterval(flush, 10000); setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stash(); flush(); } else { flush(); refresh(); } });
  window.addEventListener('pagehide', stash);
  refresh(); flush();
})();
