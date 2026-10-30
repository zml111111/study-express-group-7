// Live carriage presence. Visitors join anonymously; no email or password UI.
(function () {
  const $ = id => document.getElementById(id);
  const state = window.studyExpressState;
  const status = $('liveStatus');
  const count = $('liveCount');
  const list = $('livePassengers');
  const config = window.STUDY_EXPRESS_FIREBASE_CONFIG;
  let wanted = false;
  let auth, db, presence, connected = false, joining = false, watching = false;
  let lastPeople = {};

  function message(text) { status.textContent = text; }
  function elapsed(startedAt) {
    return Math.max(0, Math.floor((Date.now() - Number(startedAt || Date.now())) / 60000));
  }
  function render() {
    list.replaceChildren();
    const others = Object.entries(lastPeople)
      .filter(([uid, person]) => uid !== auth?.currentUser?.uid && person && typeof person.name === 'string');
    count.textContent = others.length ? `· ${others.length} online` : '';
    if (!others.length) { message('No one else is focusing right now.'); return; }
    message('Studying with you right now');
    others.slice(0, 12).forEach(([, person]) => {
      const row = document.createElement('div');
      const name = document.createElement('span');
      const time = document.createElement('span');
      name.textContent = '● ' + person.name.slice(0, 16);
      time.textContent = `Focused ${elapsed(person.startedAt)} min`;
      row.append(name, time);
      list.append(row);
    });
  }
  function watch() {
    if (watching || !db || !auth.currentUser) return;
    watching = true;
    db.ref('studyExpress/presence').on('value', snapshot => {
      lastPeople = snapshot.val() || {};
      render();
    }, () => message('Live passengers could not be loaded. Check the database rules.'));
  }
  function unwatch() {
    if (watching && db) db.ref('studyExpress/presence').off('value');
    watching = false;
    lastPeople = {};
    count.textContent = '';
    list.replaceChildren();
  }
  async function join() {
    if (!wanted || !connected || !auth?.currentUser || joining) return;
    joining = true;
    const ref = db.ref('studyExpress/presence/' + auth.currentUser.uid);
    presence = ref;
    try {
      // Register server-side cleanup before announcing this passenger.
      await ref.onDisconnect().remove();
      if (!wanted) { await ref.onDisconnect().cancel(); return; }
      await ref.set({
        name: String(state.profile?.name || 'Traveler').slice(0, 16),
        startedAt: Date.now() - (state.total - state.remaining) * 1000,
        seat: state.seat,
        scene: state.scene
      });
      if (!wanted) {
        await ref.remove();
        await ref.onDisconnect().cancel();
        if (presence === ref) presence = null;
      }
    } catch (error) {
      message('Could not join the live carriage. Check your connection and database rules.');
      console.warn('Study Express presence:', error);
    } finally { joining = false; }
  }
  async function leave() {
    if (!presence) return;
    const ref = presence;
    presence = null;
    try {
      await ref.remove();
      await ref.onDisconnect().cancel();
    } catch (error) { console.warn('Study Express presence cleanup:', error); }
  }
  window.studyExpressLive = {
    start() {
      wanted = true;
      message(config?.apiKey && config?.databaseURL ? 'Connecting to live passengers…' : 'Live passengers are not connected yet.');
      if (auth?.currentUser) { watch(); join(); }
    },
    stop() {
      wanted = false;
      unwatch();
      leave();
    },
    async updateName(name) {
      if (wanted && presence) {
        try { await presence.child('name').set(String(name).slice(0, 16)); }
        catch (error) { console.warn('Study Express name update:', error); }
      }
    }
  };

  if (!config?.apiKey || !config?.databaseURL || !config?.projectId) {
    message('Live passengers are not connected yet.');
    return;
  }
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  (async () => {
    try {
      const base = 'https://www.gstatic.com/firebasejs/13.1.0/';
      await load(base + 'firebase-app-compat.js');
      await load(base + 'firebase-auth-compat.js');
      await load(base + 'firebase-database-compat.js');
      firebase.initializeApp(config);
      auth = firebase.auth();
      db = firebase.database();
      db.ref('.info/connected').on('value', snapshot => {
        connected = snapshot.val() === true;
        if (connected) join();
        else if (wanted) message('Reconnecting to the live carriage…');
      });
      auth.onAuthStateChanged(user => {
        if (user) {
          if (wanted) { watch(); join(); }
        } else {
          auth.signInAnonymously().catch(error => {
            message('Live passengers are unavailable. Enable Anonymous sign-in in Firebase.');
            console.warn('Study Express anonymous sign-in:', error);
          });
        }
      });
      setInterval(() => { if (wanted && watching) render(); }, 15000);
    } catch (error) {
      message('Could not load the live passenger service.');
      console.warn('Study Express Firebase load:', error);
    }
  })();
})();
