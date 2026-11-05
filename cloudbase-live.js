// CloudBase PG presence. Anonymous guests need no account or password.
(function () {
  const config = window.STUDY_EXPRESS_CLOUDBASE_CONFIG;
  if (!config?.env) return;
  const state = window.studyExpressState;
  const status = document.getElementById('liveStatus');
  const count = document.getElementById('liveCount');
  const list = document.getElementById('livePassengers');
  const base = `https://${config.env}.api.tcloudbasegateway.com`;
  const table = `${base}/v1/rdb/rest/study_express_presence`;
  let wanted = false, busy = false, pollTimer, token, ownId, startedAt;
  const say = value => { status.textContent = value; };
  const deviceId = (() => {
    const key = 'studyExpressCloudBaseDevice';
    let value = localStorage.getItem(key);
    if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
    return value;
  })();
  async function request(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`CloudBase ${response.status}: ${(await response.text()).slice(0, 100)}`);
    if (response.status === 204) return null;
    return response.json();
  }
  async function authenticate() {
    if (token) return;
    const result = await request(`${base}/auth/v1/signin/anonymously`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId }, body: '{}'
    });
    if (!result.access_token || !result.sub) throw new Error('Anonymous login returned no session');
    token = result.access_token;
    ownId = String(result.sub);
  }
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  function render(rows) {
    const now = Date.now();
    const people = rows.filter(p => p && typeof p.name === 'string' && Number(p.last_seen_at) > now - 45000).slice(0, 20);
    count.textContent = people.length ? `· ${people.length} online` : '';
    list.replaceChildren();
    say(people.some(p => p.id === ownId) ? (people.length > 1 ?
      'Studying with you right now' : 'You are live. No other passengers are focusing yet.') : 'Joining the live carriage…');
    people.forEach(p => {
      const row = document.createElement('div');
      const name = document.createElement('span');
      const time = document.createElement('span');
      name.textContent = '● ' + p.name.slice(0, 16) + (p.id === ownId ? ' (you)' : '');
      time.textContent = `Focused ${Math.max(0, Math.floor((now - Number(p.started_at || now)) / 60000))} min`;
      row.append(name, time);
      list.append(row);
    });
  }
  async function refresh() {
    if (!wanted || busy) return;
    busy = true;
    try {
      await authenticate();
      if (!wanted) return;
      const own = { id: ownId, name: String(state.profile?.name || 'Traveler').slice(0, 16),
        started_at: startedAt, last_seen_at: Date.now(), seat: state.seat, scene: state.scene };
      await request(table + '?on_conflict=id', { method: 'POST', headers: {
        ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(own) });
      render(await request(table + '?select=id,name,started_at,last_seen_at&limit=100', { headers: headers() }));
    } catch (error) {
      say(`Live passengers unavailable: ${error.message || 'connection failed'}`);
      console.warn('Study Express CloudBase:', error);
      if (String(error.message).includes('401')) token = null;
    } finally { busy = false; }
  }
  async function leave() {
    if (!token || !ownId) return;
    try { await request(table + '?id=eq.' + encodeURIComponent(ownId), { method: 'DELETE', headers: headers() }); }
    catch (error) { console.warn('Study Express CloudBase cleanup:', error); }
  }
  window.studyExpressLive = {
    start() {
      wanted = true;
      startedAt = Date.now() - (state.total - state.remaining) * 1000;
      say('Connecting to live passengers…');
      clearInterval(pollTimer);
      refresh();
      pollTimer = setInterval(refresh, 10000);
    },
    stop() {
      wanted = false;
      clearInterval(pollTimer);
      count.textContent = '';
      list.replaceChildren();
      leave();
    },
    updateName() { if (wanted) refresh(); }
  };
  window.addEventListener('pagehide', () => { if (wanted) leave(); });
})();
