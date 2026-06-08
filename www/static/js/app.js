(() => {
  const DEFAULT_API = 'https://api-online.miubon.xyz';
  const LS = {
    api: 'miubonwatch.api',
    token: 'miubonwatch.token',
    user: 'miubonwatch.user',
    server: 'miubonwatch.server',
  };

  let API = localStorage.getItem(LS.api) || DEFAULT_API;
  let token = localStorage.getItem(LS.token) || '';
  let currentKind = 'series';
  let library = { series: [], standalone: [] };
  let currentItem = null;
  let episodes = [];
  let currentIndex = 0;
  let progressMap = {};
  let saveTimer = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const normApi = (base) => String(base || DEFAULT_API).trim().replace(/\/+$/, '');
  const apiUrl = (path) => `${normApi(API)}${String(path).startsWith('/') ? path : `/${path}`}`;
  const metadata = (ep) => ep?.metadata || ep?.meta || {};
  const seriesContext = (ep) => ep?.series_context || metadata(ep).series_context || {};
  const parseEpisodeFromText = (text) => {
    const s = String(text || '');
    const m = s.match(/(?:T\u1eadp|Tap|Ep|Episode|\u7b2c)\s*(\d{1,5})/i);
    return m ? Number(m[1]) : null;
  };
  const episodeNo = (ep, fallback) => {
    const ctx = seriesContext(ep);
    const raw = ep?._ep_no || ep?.episode_no || ep?.episode || ep?.ep || ep?.episode_number || ctx.episode_no || metadata(ep).episode_no || parseEpisodeFromText(ep?.title || metadata(ep).title || metadata(ep).episode_tag || ep?.douyin_meta?.douyin_title || '');
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback + 1;
  };
  const folderKey = (item) => item?.series_folder || seriesContext(item).series_folder || item?.folder || item?.project_id || item?.project_name || item?.name || 'unknown';
  const driveFileId = (ep) => ep.gdrive_file_id || ep.drive_file_id || metadata(ep).gdrive_file_id || metadata(ep).drive_file_id || '';
  const finalExists = (ep) => ep.final_video || metadata(ep).final_video || ep.is_complete || ep.progress >= 100;

  async function request(path, opts = {}) {
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(apiUrl(path), Object.assign({}, opts, { headers }));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`HTTP ${res.status}: backend trả non-JSON: ${text.slice(0, 180)}`); }
    if (!res.ok || data.ok === false) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
  }

  function setStatus(msg) { $('statusLine').textContent = msg; }
  function logDrive(msg) { $('driveLog').textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + $('driveLog').textContent; }

  async function checkBackend() {
    try {
      const data = await request('/api/health');
      return data;
    } catch (e) {
      setStatus(`Không kết nối được backend: ${e.message}`);
      throw e;
    }
  }

  async function loadProgress() {
    if (!token) { progressMap = {}; return; }
    try {
      const data = await request('/api/user/progress');
      progressMap = data.progress || data.items || data || {};
    } catch (e) {
      $('accountStatus').textContent = `Không tải được tiến độ: ${e.message}`;
    }
  }

  async function loadLibrary() {
    setStatus('Đang tải thư viện render...');
    await checkBackend();
    await loadProgress();

    const data = await request('/api/series');
    const series = Array.isArray(data.series) ? data.series : [];
    const standalonesFromSeries = Array.isArray(data.standalones) ? data.standalones : [];

    const renderedSeries = series.map((s) => {
      const eps = (s.episodes || []).filter(finalExists).sort((a, b) => episodeNo(a, 0) - episodeNo(b, 0));
      return Object.assign({}, s, { episodes: eps, rendered_count: eps.length });
    }).filter((s) => s.episodes.length);

    let standalone = standalonesFromSeries.filter(finalExists);
    try {
      const projects = await request('/api/projects');
      const all = Array.isArray(projects.projects) ? projects.projects : [];
      const more = all.filter((p) => {
        const ctx = p.series_context || metadata(p).series_context || {};
        return finalExists(p) && !ctx.series_folder && !p.series_name && !p.series_folder;
      });
      const byId = new Map();
      [...standalone, ...more].forEach((p) => byId.set(p.project_id || p.name || p.project_name, p));
      standalone = [...byId.values()];
    } catch (_) {}

    library = { series: renderedSeries, standalone };
    renderLibrary();
  }

  function renderLibrary() {
    const items = library[currentKind] || [];
    $('libraryGrid').innerHTML = items.map((item, idx) => {
      const title = item.series_name || item.name || item.title || item.project_name || 'Phim lẻ';
      const eps = currentKind === 'series' ? (item.episodes || []) : [item];
      const first = eps[0] || item;
      const thumb = apiUrl(`/api/project/${encodeURIComponent(first.project_id || first.project_name || first.name)}/stream/thumbnail.jpg`);
      const key = folderKey(item);
      const p = progressMap[key] || {};
      const watchedEp = p.ep_no || (p.ep_index != null && eps[p.ep_index] ? episodeNo(eps[p.ep_index], Number(p.ep_index)) : null);
      const watched = watchedEp ? `\u0110\u00e3 xem: t\u1eadp ${watchedEp}` : 'Ch\u01b0a xem';
      return `<button class="card" data-index="${idx}">
        <img src="${thumb}" alt="" onerror="this.src='static/placeholder.svg'" />
        <div class="card-badge">${eps.length} Tập</div>
        <div class="card-info">
          <h3>${esc(title)}</h3>
          <p>${currentKind === 'series' ? `${eps.length}/${item.max_episode || item.max || eps.length} Rendered` : 'Hoàn tất'}</p>
          <small>${esc(watched)}</small>
        </div>
      </button>`;
    }).join('') || '<div class="empty">Chưa có video nào.</div>';

    $('libraryGrid').querySelectorAll('.card').forEach((btn) => {
      btn.addEventListener('click', () => openItem(Number(btn.dataset.index)));
    });
    setStatus(`${items.length} mục ${currentKind === 'series' ? 'phim bộ' : 'phim lẻ'} đã sẵn sàng.`);
  }

  function openItem(index) {
    const item = library[currentKind][index];
    if (!item) return;
    currentItem = item;
    episodes = currentKind === 'series' ? [...(item.episodes || [])] : [item];
    episodes.sort((a, b) => episodeNo(a, 0) - episodeNo(b, 0));
    const p = progressMap[folderKey(item)] || {};
    currentIndex = Math.min(Math.max(Number(p.ep_index || 0), 0), episodes.length - 1);
    $('watchPanel').classList.remove('hidden');
    $('watchKind').textContent = currentKind === 'series' ? 'SERIES' : 'PHIM LẺ';
    $('watchTitle').textContent = item.series_name || item.name || item.title || item.project_name || 'Video';
    $('watchMeta').textContent = `${episodes.length} video render | Server: ${localStorage.getItem(LS.server) || 'cloudflare'}`;
    renderEpisodes();
    playCurrent(Number(p.time || 0));
    $('watchPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function episodeTitle(ep, idx) {
    const title = ep.title || metadata(ep).title || currentItem?.series_name || 'Video';
    const no = episodeNo(ep, idx);
    return currentKind === 'series' ? `Tập ${no} | ${title.replace(/^Tập\s*\d+\s*\|\s*/i, '')}` : title;
  }

  function renderEpisodes() {
    const q = $('episodeSearch').value.trim().toLowerCase();
    $('episodeGrid').innerHTML = episodes.map((ep, idx) => ({ ep, idx, title: episodeTitle(ep, idx) }))
      .filter((x) => !q || x.title.toLowerCase().includes(q) || String(episodeNo(x.ep, x.idx)).includes(q))
      .map((x) => `<button class="episode ${x.idx === currentIndex ? 'active' : ''}" data-index="${x.idx}">${esc(episodeNo(x.ep, x.idx))}</button>`)
      .join('');
    $('episodeGrid').querySelectorAll('.episode').forEach((btn) => {
      btn.addEventListener('click', () => { currentIndex = Number(btn.dataset.index); playCurrent(0); renderEpisodes(); });
    });
    $('prevBtn').disabled = currentIndex <= 0;
    $('nextBtn').disabled = currentIndex >= episodes.length - 1;
  }

  function selectedServer() {
    return document.querySelector('input[name="serverMode"]:checked')?.value || 'cloudflare';
  }

  function videoSource(ep) {
    const project = encodeURIComponent(ep.project_id || ep.project_name || ep.name);
    if (selectedServer() === 'gdrive') {
      const fileId = driveFileId(ep);
      if (fileId) return apiUrl(`/api/gdrive/file/${encodeURIComponent(fileId)}/stream`);
      $('serverHint').textContent = 'Video chưa có file Google Drive, đang dùng Cloudflare.';
    } else {
      $('serverHint').textContent = '';
    }
    return apiUrl(`/api/project/${project}/stream/final_video.mp4`);
  }

  function playCurrent(seekTime = 0) {
    const ep = episodes[currentIndex];
    if (!ep) return;
    const player = $('videoPlayer');
    $('watchMeta').textContent = `${episodeTitle(ep, currentIndex)} | v\u1ecb tr\u00ed ${currentIndex + 1}/${episodes.length}`;
    $('serverHint').textContent = '';
    player.src = videoSource(ep);
    player.load();
    player.onloadedmetadata = () => {
      if (seekTime > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(seekTime, Math.max(player.duration - 2, 0));
    };
    renderEpisodes();
  }

  async function saveProgress(force = false) {
    if (!token || !currentItem || !episodes[currentIndex]) return;
    const player = $('videoPlayer');
    if (!force && (!player.currentTime || player.currentTime < 2)) return;
    const key = folderKey(currentItem);
    progressMap[key] = { ep_index: currentIndex, ep_no: episodeNo(episodes[currentIndex], currentIndex), time: Math.floor(player.currentTime || 0), updated_at: new Date().toISOString() };
    try {
      await request('/api/user/progress', {
        method: 'POST',
        body: JSON.stringify({ folder: key, ep_index: currentIndex, ep_no: episodeNo(episodes[currentIndex], currentIndex), time: Math.floor(player.currentTime || 0) }),
      });
    } catch (e) {
      $('accountStatus').textContent = `Lưu tiến độ lỗi: ${e.message}`;
    }
  }

  async function auth(action) {
    const username = $('usernameInput').value.trim();
    const password = $('passwordInput').value;
    if (!username || !password) { $('accountStatus').textContent = 'Nhập tài khoản và mật khẩu.'; return; }
    try {
      const data = await request(`/api/auth/${action}`, { method: 'POST', body: JSON.stringify({ username, password }) });
      token = data.token || data.access_token || '';
      if (!token) throw new Error('Backend không trả token');
      localStorage.setItem(LS.token, token);
      localStorage.setItem(LS.user, username);
      updateAuthUi();
      await loadProgress();
      renderLibrary();
      $('accountStatus').textContent = `Đã đăng nhập: ${username}`;
    } catch (e) {
      $('accountStatus').textContent = `Lỗi đăng nhập: ${e.message}`;
    }
  }

  function updateAuthUi() {
    const user = localStorage.getItem(LS.user);
    $('accountStatus').textContent = token ? `Đã ghi nhớ đăng nhập: ${user || 'user'}` : 'Chưa đăng nhập.';
    $('logoutBtn').classList.toggle('hidden', !token);
  }

  async function driveStatus() {
    try {
      const data = await request('/api/gdrive/status');
      logDrive(JSON.stringify(data, null, 2));
    } catch (e) { logDrive(`Drive status lỗi: ${e.message}`); }
  }

  async function importDriveJson() {
    let text = $('driveJsonText').value.trim();
    const file = $('driveJsonFile').files?.[0];
    if (!text && file) text = await file.text();
    if (!text) { logDrive('Chưa có OAuth Client JSON.'); return; }
    try {
      JSON.parse(text);
      const data = await request('/api/gdrive/import-secrets', { method: 'POST', body: JSON.stringify({ json: text }) });
      logDrive(`Import Drive JSON OK: ${JSON.stringify(data)}`);
    } catch (e) { logDrive(`Import lỗi: ${e.message}`); }
  }

  async function uploadAllDrive() {
    try {
      const data = await request('/api/gdrive/mass_upload_videos', { method: 'POST', body: JSON.stringify({ rendered_only: true }) });
      logDrive(`Đã tạo job upload Drive: ${data.job_id || JSON.stringify(data)}`);
      if (data.job_id) pollDriveJob(data.job_id);
    } catch (e) { logDrive(`Upload Drive lỗi: ${e.message}`); }
  }

  async function pollDriveJob(jobId) {
    for (let i = 0; i < 720; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const data = await request(`/api/gdrive/job/${encodeURIComponent(jobId)}`);
        logDrive(`Job ${jobId}: ${data.status || data.state || ''} ${data.done || 0}/${data.total || '?'}`);
        if (['done', 'failed', 'complete', 'completed'].includes(String(data.status || data.state).toLowerCase())) break;
      } catch (e) { logDrive(`Poll job lỗi: ${e.message}`); break; }
    }
  }

  function bindEvents() {
    document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active-panel'));
      btn.classList.add('active');
      $(`${btn.dataset.tab}Tab`).classList.add('active-panel');
    }));
    document.querySelectorAll('.segment').forEach((btn) => btn.addEventListener('click', () => {
      currentKind = btn.dataset.kind;
      document.querySelectorAll('.segment').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderLibrary();
    }));
    $('refreshBtn').addEventListener('click', () => loadLibrary().catch((e) => setStatus(e.message)));
    $('backendBtn').addEventListener('click', () => { $('backendInput').value = API; $('backendDialog').showModal(); });
    $('saveBackendBtn').addEventListener('click', () => { API = normApi($('backendInput').value); localStorage.setItem(LS.api, API); setTimeout(() => loadLibrary().catch((e) => setStatus(e.message)), 50); });
    const closeModal = () => { saveProgress(true); $('videoPlayer').pause(); $('watchPanel').classList.add('hidden'); };
    $('closeWatchBtn').addEventListener('click', closeModal);
    const backdrop = document.getElementById('closeWatchBackdrop');
    if (backdrop) backdrop.addEventListener('click', closeModal);
    $('prevBtn').addEventListener('click', () => { if (currentIndex > 0) { saveProgress(true); currentIndex--; playCurrent(0); } });
    $('nextBtn').addEventListener('click', () => { if (currentIndex < episodes.length - 1) { saveProgress(true); currentIndex++; playCurrent(0); } });
    $('episodeSearch').addEventListener('input', renderEpisodes);
    document.querySelectorAll('input[name="serverMode"]').forEach((r) => r.addEventListener('change', () => { localStorage.setItem(LS.server, selectedServer()); playCurrent($('videoPlayer').currentTime || 0); }));
    const savedServer = localStorage.getItem(LS.server); if (savedServer) { const r = document.querySelector(`input[name="serverMode"][value="${savedServer}"]`); if (r) r.checked = true; }
    $('videoPlayer').addEventListener('timeupdate', () => { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveProgress(false); }, 5000); });
    $('videoPlayer').addEventListener('pause', () => saveProgress(true));
    $('videoPlayer').addEventListener('ended', () => { saveProgress(true); if (currentIndex < episodes.length - 1) { currentIndex++; playCurrent(0); } });
    $('loginBtn').addEventListener('click', () => auth('login'));
    $('registerBtn').addEventListener('click', () => auth('register'));
    $('logoutBtn').addEventListener('click', () => { token = ''; localStorage.removeItem(LS.token); localStorage.removeItem(LS.user); progressMap = {}; updateAuthUi(); renderLibrary(); });
    $('driveStatusBtn').addEventListener('click', driveStatus);
    $('driveLoginBtn').addEventListener('click', () => window.open(apiUrl('/api/gdrive/login'), '_blank'));
    $('driveImportBtn').addEventListener('click', importDriveJson);
    $('driveUploadAllBtn').addEventListener('click', uploadAllDrive);
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('backendInput').value = API;
    updateAuthUi();
    bindEvents();
    loadLibrary().catch((e) => setStatus(e.message));
  });
})();