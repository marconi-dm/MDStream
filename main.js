// MDStream v5.2.1 - Home simplificada; Busca prioritária, catálogo compacto, ações rápidas VOD; mantém AVPlay e EPG.
// Nunca registre URL de stream nem credenciais no console.
document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const labels = { home: "Início", live: "TV ao vivo", movies: "Filmes", series: "Séries" };
  const state = {
    mode: "xtream", client: null, section: "live", catalogs: {},
    category: { live: "all", movies: "all", series: "all" },
    visible: [], limit: 60, selected: null, playing: null,
    isFullscreen: false, currentDetail: null, lastFocus: null, loadSeq: 0,
    liveExtension: "ts", wasLiveBeforeFullscreen: false,
    editingId: null, originalMode: null, currentProfileId: null, loginAttempt: 0, deletingId: null,
    previewTimeout: null, controlsTimeout: null, toastTimeout: null,
    historyView:{movies:"all",series:"all"}, currentVod:null, pendingResume:null, lastHistorySave:0,
    recoveringVod:false, scrubTargetMs:null, scrubSeeking:false, scrubLastKeyAt:0, scrubRepeatCount:0, guide:null, guideMeta:new Map(), seriesInfoCache:new Map()
  };
  const player = new MDStreamPlayer($("playerStage"), $("browserVideo"), function (message, error) {
    $("previewStatus").textContent = message;
    $("fullscreenStatus").textContent = message;
    $("previewStatus").style.color = error ? "#ff9fae" : "";
    if (error && state.isFullscreen) showToast(message);
    if (state.isFullscreen && player.paused) showVodControls();
  }, updateVodProgress, handleVodCompleted, function (metrics) {
    if (!$("vodDiagnostics") || state.section === "live") return;
    $("vodDiagnostics").textContent =
      (metrics.stableMode ? "AVPlay • Buffer estável" : "AVPlay • Buffer padrão") +
      "  |  Carregamentos: " + metrics.bufferEvents +
      "  |  Espera: " + metrics.bufferSeconds + "s" +
      (metrics.buffering ? "  |  Carregando..." : "") +
      (metrics.stalls ? "  |  Pausas detectadas: " + metrics.stalls : "");
  });

  let storageAvailable = true;
  let storage;
  try {
    storage = window.localStorage;
    // Teste de escrita para detectar armazenamento indisponível (file://, modo privado etc.).
    storage.setItem("mdstream.storageCheck", "1");
    storage.removeItem("mdstream.storageCheck");
  } catch (_) {
    storageAvailable = false;
    const volatile = {};
    storage = {
      getItem: key => Object.prototype.hasOwnProperty.call(volatile, key) ? volatile[key] : null,
      setItem: (key, val) => { volatile[key] = String(val); },
      removeItem: key => { delete volatile[key]; }
    };
  }
  const savedProfiles = new MDStreamProfiles(storage);
  const watchHistory = new MDStreamHistory(storage);
  function historyRecord(item, force) {
    if (!item || state.section === "live") return;
    const progress = player.getProgress();
    const current = Number(progress.current) || 0;
    const now = Date.now();
    // grava apenas após 5 s; a cada 15 s, ou no pause/stop/seek.
    if (current < 5000 || (!force && now - state.lastHistorySave < 15000)) return;
    if (watchHistory.record(item, current, progress.duration)) {
      state.lastHistorySave = now;
    }
  }
  function flushHistory() { historyRecord(state.currentVod, true); }
  function handleVodCompleted() {
    if (!state.currentVod || state.section === "live") return;
    const progress = player.getProgress();
    const previous = state.currentVod.kind === "movies" ?
      watchHistory.getMovie(state.currentVod.id) : watchHistory.getEpisode(state.currentVod.episodeId);
    const duration = Number(progress.duration) || Number(previous && previous.durationMs) || 0;
    if (duration > 0) {
      watchHistory.record(state.currentVod, duration, duration);
      state.lastHistorySave = Date.now();
    }
    state.pendingResume = null;
    if (state.isFullscreen) showToast("✓ Conteúdo concluído");
  }
  window.addEventListener("pagehide", flushHistory);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushHistory(); });
  function currentHistoryRecord(item) {
    return item.kind === "movies" ? watchHistory.getMovie(item.id) : watchHistory.latestSeries(item.id);
  }
  function applyResume(item) {
    // A busca é aplicada quando o AVPlay já informou uma duração válida.
    const previous = item.kind === "series" ? watchHistory.getEpisode(item.episodeId) : watchHistory.getMovie(item.id);
    state.pendingResume = previous && !previous.completed && previous.positionMs >= 30000
      ? Math.max(0, previous.positionMs - 3000) : null;
    state.lastHistorySave = 0;
  }


  function getProfiles() { return savedProfiles.list(); }
  function chooseProfiles(message, isError) {
    $("appScreen").hidden = true;
    $("loginScreen").hidden = true;
    $("profilesScreen").hidden = false;
    $("deleteOverlay").hidden = true;
    $("profilesStatus").textContent = message || "";
    $("profilesStatus").classList.toggle("error", !!isError);
    renderProfiles();
    const first = $("savedProfiles").querySelector(".profile-connect");
    (first || $("addProfileBtn")).focus();
  }

  function renderProfiles() {
    const grid = $("savedProfiles");
    grid.replaceChildren();
    const records = getProfiles();
    records.forEach(profile => {
      const card = document.createElement("div"); card.className = "profile-card";
      const badge = document.createElement("div"); badge.className = "profile-icon"; badge.textContent = "▶";
      const title = document.createElement("strong"); title.className = "profile-name"; title.textContent = profile.name;
      const origin = document.createElement("small"); origin.className = "profile-server";
      try { origin.textContent = new URL(profile.server).host; }
      catch (_) { origin.textContent = "Servidor configurado"; }
      const meta = document.createElement("span"); meta.className = "profile-meta";
      meta.textContent = profile.autoConnect ? "Entrada automática ativa" :
        profile.password ? "Acesso pronto para conectar" : "Pedir senha ao entrar";
      const actions = document.createElement("div"); actions.className = "profile-actions";
      const connect = document.createElement("button"); connect.type = "button"; connect.className = "profile-connect button-accent";
      connect.textContent = "▶ Entrar";
      connect.onclick = () => {
        if (!profile.password) { openProfileForm(profile, true); return; }
        connectSavedProfile(profile, false);
      };
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "profile-action button-ghost";
      edit.textContent = "Editar"; edit.onclick = () => openProfileForm(profile, false);
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "profile-action button-ghost";
      remove.textContent = "Excluir"; remove.onclick = () => askDelete(profile);
      actions.append(connect, edit, remove);
      card.append(badge, title, origin, meta, actions);
      grid.appendChild(card);
    });
  }

  function openProfileForm(profile, needPassword) {
    state.editingId = profile ? profile.id : null;
    state.originalMode = profile ? profile.mode : null;
    // Os dados de URLs M3U são normalizados para os mesmos campos Xtream;
    // originalMode preserva a tentativa alternativa de playlist.
    setMode("xtream");
    $("server").value = profile ? profile.server : "";
    $("username").value = profile ? profile.username : "";
    $("password").value = profile ? (profile.password || "") : "";
    $("playlistUrl").value = "";
    $("profileName").value = profile ? profile.name : "";
    $("saveProfile").checked = true;
    $("rememberPassword").checked = !!(profile && profile.rememberPassword);
    $("autoConnect").checked = !!(profile && profile.autoConnect);
    updatePreferences();
    $("loginHeading").textContent = needPassword ? "Digite a senha para entrar." :
      profile ? "Edite seu acesso." : "Entre e descubra.";
    $("loginBackBtn").hidden = getProfiles().length === 0;
    $("profilesScreen").hidden = true;
    $("appScreen").hidden = true;
    $("loginScreen").hidden = false;
    info("", false);
    (needPassword ? $("password") : profile ? $("profileName") : $("server")).focus();
  }

  function updatePreferences() {
    const enabled = $("saveProfile").checked;
    $("rememberPassword").disabled = !enabled;
    if (!enabled) $("rememberPassword").checked = false;
    $("autoConnect").disabled = !enabled || !$("rememberPassword").checked;
    if ($("autoConnect").disabled) $("autoConnect").checked = false;
  }
  ["saveProfile", "rememberPassword"].forEach(id => {
    $(id).addEventListener("change", updatePreferences);
  });
  $("addProfileBtn").onclick = () => openProfileForm(null, false);
  $("loginBackBtn").onclick = () => chooseProfiles();

  function askDelete(profile) {
    state.deletingId = profile.id;
    $("deleteDescription").textContent = "O perfil ‘" + profile.name + "’ e sua senha salva (se houver) serão apagados apenas deste dispositivo.";
    $("deleteOverlay").hidden = false;
    $("cancelDelete").focus();
  }
  $("cancelDelete").onclick = () => { $("deleteOverlay").hidden = true; state.deletingId = null; $("addProfileBtn").focus(); };
  $("confirmDelete").onclick = () => {
    if (!state.deletingId) return;
    try { savedProfiles.remove(state.deletingId); }
    catch (_) { $("deleteOverlay").hidden = true; chooseProfiles("Não foi possível excluir o perfil neste dispositivo.", true); return; }
    state.deletingId = null;
    $("deleteOverlay").hidden = true;
    if (getProfiles().length) chooseProfiles("Acesso excluído deste dispositivo.");
    else openProfileForm(null, false);
  };

  async function connectClient(client, originMode, afterSuccess) {
    let catalog;
    if (originMode === "m3u") {
      try {
        await client.authenticate();
        catalog = await client.getLiveCatalog();
      } catch (_) {
        catalog = await client.getPlaylistCatalog();
      }
    } else {
      await client.authenticate();
      catalog = await client.getLiveCatalog();
    }
    state.client = client;
    watchHistory.setAccount(client.server, client.username);
    state.catalogs = { live: catalog };
    state.seriesInfoCache.clear();state.guideMeta.clear();$("homeDashboard").dataset.refreshed="";
    state.category = { live: "all", movies: "all", series: "all" };
    if (afterSuccess) afterSuccess();
    // Retira a senha do formulário após autenticar; o cliente ativo a mantém
    // somente enquanto a sessão estiver aberta (ou no perfil com opt-in).
    $("password").value = "";
    $("playlistUrl").value = "";
    if (!storageAvailable) {
      $("storageWarning").textContent = "Armazenamento local indisponível. Os perfis desta sessão não serão lembrados após fechar.";
      $("storageWarning").hidden = false;
    }
    $("profilesScreen").hidden = true;
    $("loginScreen").hidden = true;
    $("appScreen").hidden = false;
    await showSection("home");
  }

  async function connectSavedProfile(profile, automatic) {
    $("profilesStatus").classList.remove("error");
    $("profilesStatus").textContent = automatic ? "Conectando automaticamente a “" + profile.name + "”..." :
      "Conectando a “" + profile.name + "”...";
    const buttons = $("savedProfiles").querySelectorAll("button");
    buttons.forEach(button => { button.disabled = true; });
    try {
      const client = new XtreamClient(profile.server, profile.username, profile.password);
      await connectClient(client, profile.mode, () => { state.currentProfileId = profile.id; });
    } catch (error) {
      chooseProfiles((automatic ? "A conexão automática falhou. " : "Não foi possível conectar. ") + errorText(error), true);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  const safeImage = function (src) {
    try { const parsed = new URL(String(src)); return /^https?:$/.test(parsed.protocol) ? parsed.toString() : ""; }
    catch (_) { return ""; }
  };
  const niceText = value => value == null ? "" : String(value).trim();
  const info = (message, isError) => { $("loginStatus").textContent = message; $("loginStatus").classList.toggle("error", !!isError); };
  const errorText = error => error && error.name === "AbortError" ? "Tempo de conexão esgotado." :
    error instanceof TypeError ? "Falha de rede, DNS ou CORS. Confira o servidor." :
    (error && error.message || "Ocorreu um erro na conexão.");

  function setMode(mode) {
    state.mode = mode;
    $("xtreamFields").hidden = mode !== "xtream";
    $("m3uFields").hidden = mode !== "m3u";
    $("modeXtream").classList.toggle("selected", mode === "xtream");
    $("modeM3u").classList.toggle("selected", mode === "m3u");
    (mode === "xtream" ? $("server") : $("playlistUrl")).focus();
  }
  $("modeXtream").onclick = () => { state.originalMode = null; setMode("xtream"); };
  $("modeM3u").onclick = () => { state.originalMode = null; setMode("m3u"); };

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    $("connectBtn").disabled = true;
    info("Validando acesso e consultando canais...", false);
    try {
      const client = state.mode === "xtream" ?
        new XtreamClient($("server").value, $("username").value, $("password").value) :
        XtreamClient.fromM3ULink($("playlistUrl").value);
      const connectionMode = state.originalMode || state.mode;
      await connectClient(client, connectionMode, () => {
        state.currentProfileId = null;
        if (!$("saveProfile").checked) return;
        try {
          const saved = savedProfiles.upsert({
            id: state.editingId,
            name: $("profileName").value.trim() || "Meu acesso",
            server: client.server,
            username: client.username,
            password: client.password,
            mode: connectionMode,
            rememberPassword: $("rememberPassword").checked,
            autoConnect: $("autoConnect").checked
          });
          state.currentProfileId = saved.id;
        } catch (_) {
          // Falha de armazenamento não impede acesso ao catálogo.
          $("storageWarning").textContent = "Conectado, mas não foi possível salvar este perfil no dispositivo.";
          $("storageWarning").hidden = false;
        }
      });
    } catch (error) { info(errorText(error), true); }
    finally { $("connectBtn").disabled = false; }
  });

  async function renderHome() {
    // Home minimalista: somente os três botões de navegação.
    // Filmes e séries são carregados apenas ao entrar nas respectivas telas.
    const home = $("homeDashboard");
    home.hidden = false;
    $("homeClock").textContent = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit"
    });
    home.querySelectorAll("[data-open-section]").forEach(button => {
      button.onclick = () => showSection(button.dataset.openSection);
    });
  }

  async function showSection(section) {
    if (!state.client) return;
    const serial = ++state.loadSeq;
    const previousSection = state.section;
    closeQuickActions(false);
    closeDetails();
    if (state.isFullscreen) closeFullscreen();
    clearTimeout(state.previewTimeout);
    player.stop();
    state.section = section;
    if (section === "live") requestAnimationFrame(() => {
      if (state.section === section && !state.isFullscreen) $("sectionBackBtn").focus();
    });
    window.scrollTo(0,0); document.documentElement.scrollTop=0; document.body.scrollTop=0;
    $("appScreen").classList.toggle("vod-layout",section==="movies"||section==="series");
    $("homeDashboard").hidden = section !== "home";
    
    const normalSections = [document.querySelector(".page-top"),document.querySelector(".hero"),document.querySelector(".catalog-heading"),$("vodSearchHeader"),$("historyTabs"),document.querySelector(".filterbar"),$("catalogMessage"),$("liveGuide"),$("mediaGrid"),$("loadMoreBtn")];
    if (section === "home") {
      $("appScreen").classList.remove("live-layout");
      normalSections.forEach(el=>{if(el)el.hidden=true;});
      document.querySelectorAll(".nav-item[data-section]").forEach(btn => btn.classList.toggle("active",btn.dataset.section===section));
      await renderHome();
      window.scrollTo(0,0); document.documentElement.scrollTop=0; document.body.scrollTop=0;
      // A Home é a raiz da navegação do Smart Remote.
      // Prioriza a seção de onde o usuário acabou de voltar.
      const preferred = document.querySelector('.home-tile[data-open-section="' + previousSection + '"]');
      requestAnimationFrame(() => { if (state.section === "home" && !state.isFullscreen) (preferred || document.querySelector(".home-tile")).focus(); });
      return;
    }
    normalSections.forEach(el=>{if(el)el.hidden=false;});
    document.querySelector(".page-top").hidden=false;
    document.querySelector(".hero").hidden=section !== "live";
    document.querySelector(".catalog-heading").hidden=false;
    document.querySelector(".filterbar").hidden=false;
    $("vodSearchHeader").hidden=section === "live";
    // Reutiliza o MESMO campo de pesquisa, sem duplicar listeners ou perder texto.
    // VOD: busca no topo e filtros abaixo. Ao vivo: busca ao lado das categorias.
    const searchBox = $("catalogSearchBox");
    (section === "live" ? document.querySelector(".filterbar") : $("vodSearchHeader")).appendChild(searchBox);
    $("mediaGrid").hidden = section === "live";
    $("liveGuide").hidden = section !== "live";
    $("loadMoreBtn").hidden = true;
    // No Ao vivo a prévia permanece totalmente visível enquanto o usuário
    // navega pela grade, que passa a ser a única região com rolagem vertical.
    $("appScreen").classList.toggle("live-layout", section === "live");
    if (section === "live") {
      window.scrollTo(0, 0);
      $("mediaGrid").scrollTop = 0;
    }
    state.selected = null;
    state.playing = null;
    $("searchInput").value = "";
    state.limit = 60;
    document.querySelectorAll(".nav-item[data-section]").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.section === section));
    $("sectionTitle").textContent = labels[section];
    $("listTitle").textContent = section === "live" ? "Escolha um canal" : section === "movies" ? "Escolha um filme" : "Escolha uma série";
    $("searchInput").placeholder = "Buscar " + (section === "live" ? "canais" : labels[section].toLowerCase()) + "...";
    $("mediaGrid").classList.toggle("channel-mode", section === "live");
    $("historyTabs").hidden = section === "live";
    updateHistoryTabs();
    resetHero(section);
    const container = $("mediaGrid"); container.replaceChildren();
    $("catalogMessage").hidden = false;
    $("catalogMessage").textContent = "Carregando " + labels[section].toLowerCase() + "...";
    try {
      if (!state.catalogs[section]) {
        if (state.catalogs.live.source !== "Xtream Codes API") {
          throw new Error("O modo M3U importou apenas canais. Para filmes e séries, conecte com a API Xtream.");
        }
        const catalog = await state.client.getMediaCatalog(section);
        state.catalogs[section] = catalog;
      }
      if (serial !== state.loadSeq) return;
      const catalog = state.catalogs[section];
      $("catalogInfo").textContent = catalog.channels.length.toLocaleString("pt-BR") + (section === "live" ? " canais encontrados" : " títulos encontrados");
      $("catalogMessage").hidden = true;
      renderCategories(); renderGrid();
      // Com a navegação sem barra lateral, há sempre um foco inicial visível.
      requestAnimationFrame(() => {
        if (state.section === section && !state.isFullscreen && serial === state.loadSeq) {
          (section === "live" ? $("sectionBackBtn") : $("searchInput")).focus();
        }
      });
    } catch (error) {
      if (serial !== state.loadSeq) return;
      $("catalogMessage").textContent = "Não foi possível carregar " + labels[section].toLowerCase() + ": " + errorText(error);
      $("catalogInfo").textContent = "";
      $("categories").replaceChildren();
      $("resultCount").textContent = "";
    }
  }
  // Contextual navigation: every catalog goes back to the clean Home.
  $("sectionBackBtn").addEventListener("click", () => showSection("home"));

  function resetHero(section) {
    $("heroEyebrow").textContent = section === "live" ? "ESCOLHA SEU CANAL" : section === "movies" ? "SESSÃO DE CINEMA" : "SUA PRÓXIMA MARATONA";
    $("heroTitle").textContent = section === "live" ? "A programação começa aqui." : section === "movies" ? "Histórias para descobrir." : "Uma história a cada episódio.";
    $("heroDescription").textContent = section === "live" ? "Selecione um canal com OK para assistir à prévia. Use Tela cheia para ampliar." : section === "movies" ? "Navegue pelas capas, descubra detalhes e comece a assistir." : "Encontre suas séries, escolha a temporada e depois o episódio.";
    $("heroMeta").firstElementChild.textContent = section === "live" ? "AO VIVO" : section === "movies" ? "FILMES" : "SÉRIES";
    $("heroSecondary").textContent = section === "live" ? "Prévia integrada" : "Catálogo sob demanda";
    $("heroWatch").disabled = true;
    $("heroWatchLabel").textContent = "Assistir";
    $("heroDetails").hidden = true;
    $("heroFormat").hidden = true;
    $("previewLabel").textContent = section === "live" ? "Prévia ao vivo" : "Sua sessão começa aqui";
    $("previewHint").textContent = section === "live" ? "Selecione um canal na lista" : "Selecione uma capa para saber mais";
    $("previewPlaceholder").hidden = false;
    $("previewPlaceholder").style.backgroundImage = "";
    $("previewLive").hidden = true;
    $("previewStatus").textContent = "";
  }

  function updateHistoryTabs() {
    const view = state.historyView[state.section] || "all";
    document.querySelectorAll("#historyTabs .history-tab").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.history === view));
    $("categories").hidden = state.section !== "live" && view !== "all";
  }
  document.querySelectorAll("#historyTabs .history-tab").forEach(btn => {
    btn.onclick = () => {
      if (state.section === "live") return;
      state.historyView[state.section] = btn.dataset.history;
      state.limit = 60;
      updateHistoryTabs();
      renderGrid();
      btn.focus();
    };
  });
  function renderCategories() {
    const catalog = state.catalogs[state.section];
    if (!catalog) return;
    const categories = [{ id: "all", name: "Todas" }].concat(catalog.categories);
    const container = $("categories"); container.replaceChildren();
    categories.forEach(cat => {
      const btn = document.createElement("button"); btn.type = "button";
      btn.className = "category-btn" + (state.category[state.section] === cat.id ? " active" : "");
      btn.textContent = cat.name;
      btn.onclick = () => {
        state.category[state.section] = cat.id;
        state.limit = 60;
        renderCategories(); renderGrid();
        const active = container.querySelector(".active"); if (active) active.focus();
      };
      container.appendChild(btn);
    });
  }

  function renderGrid() {
    const catalog = state.catalogs[state.section];
    if (!catalog) return;
    const query = $("searchInput").value.trim().toLocaleLowerCase("pt-BR");
    const view = state.historyView[state.section] || "all";
    const rows = state.section !== "live" && view !== "all"
      ? watchHistory.list(state.section, view) : null;
    const fromHistory = rows ? rows.map(row => {
      const original = catalog.channels.find(item => String(item.id) === row.id);
      return Object.assign({}, original || {
        id:row.id, name:row.title, group:"Visto recentemente", image:row.image,
        kind:row.kind, extension:"mp4"
      }, {historyRecord:row});
    }) : catalog.channels;
    state.visible = fromHistory.filter(item =>
      (rows || state.category[state.section] === "all" || item.categoryId === state.category[state.section]) &&
      item.name.toLocaleLowerCase("pt-BR").includes(query));
    $("resultCount").textContent = state.visible.length.toLocaleString("pt-BR") + (state.section === "live" ? " canais" : " resultados");
    if (state.section === "live") {
      $("mediaGrid").hidden = true;
      $("loadMoreBtn").hidden = true;
      if (!state.guide) {
        state.guide = new MDStreamGuide($("liveGuide"),state.client,{
          safeImage, select: (channel,button)=>startLivePreview(channel,button),
          program: program => {
            $("heroDescription").textContent = program.title + " • " + new Date(program.start).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) + " às " + new Date(program.end).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) + (program.description ? " • " + program.description : "");
          },
          programForChannel: (channel, program) => {
            state.guideMeta.set(String(channel.id),program);
            if(state.selected && String(state.selected.id)===String(channel.id)) $("heroDescription").textContent=program.title + (program.description ? " • "+program.description : "");
          }
        });
      }
      state.guide.setClient(state.client);
      state.guide.render(state.visible);
      return;
    }
    const container = $("mediaGrid"); container.replaceChildren();
    const fragment = document.createDocumentFragment();
    state.visible.slice(0, state.limit).forEach(item => {
      const card = document.createElement("button"); card.className = "media-card"; card.type = "button";
      if (state.selected && state.selected.id === item.id && state.selected.kind === state.section) card.classList.add("is-picked");
      const poster = document.createElement("div"); poster.className = "poster";
      const src = safeImage(item.image);
      if (src) {
        const image = document.createElement("img"); image.src = src; image.alt = ""; image.loading = "lazy";
        image.onerror = () => { image.remove(); fallbackPoster(); };
        poster.appendChild(image);
      } else fallbackPoster();
      function fallbackPoster() {
        if (poster.querySelector(".poster-fallback")) return;
        const mark = document.createElement("span"); mark.className = "poster-fallback";
        mark.textContent = state.section === "live" ? "▣" : state.section === "movies" ? "▶" : "▥";
        poster.appendChild(mark);
      }
      const copy = document.createElement("div"); copy.className = "card-copy";
      const title = document.createElement("strong"); title.textContent = item.name;
      const sub = document.createElement("small"); sub.textContent = item.group;
      copy.append(title, sub); card.append(poster, copy);
      const historyItem = item.historyRecord || (state.section !== "live" ? currentHistoryRecord({kind:state.section,id:item.id}) : null);
      if (historyItem) {
        const label = document.createElement("div"); label.className = "watched-badge";
        label.textContent = historyItem.completed ? "✓ Assistido" :
          "▶ " + formatMediaTime(historyItem.positionMs) +
          (state.section === "series" && historyItem.episodeTitle ? " • " + historyItem.episodeTitle : "");
        card.appendChild(label);
        if (historyItem.durationMs > 0) {
          const bar = document.createElement("div"); bar.className = "watched-progress";
          const fill = document.createElement("span");
          fill.style.width = Math.min(100, Math.max(0, historyItem.positionMs / historyItem.durationMs * 100)) + "%";
          bar.appendChild(fill); card.appendChild(bar);
        }
      }
      card.onclick = () => state.section === "live" ? selectItem(item, card) : openQuickActions(item, card);
      if (state.section === "live") {
        // Navegar pelas setas apenas destaca o card. OK inicia a prévia.
        card.addEventListener("focus", () => {
          clearTimeout(state.previewTimeout);
        });
      }
      fragment.appendChild(card);
    });
    if (!state.visible.length) {
      const message = document.createElement("p"); message.className = "subtle";
      message.textContent = rows ? "Nada aqui ainda. Reproduza um filme ou episódio para criar seu histórico." : "Nenhum resultado nesta categoria.";
      fragment.appendChild(message);
    }
    container.appendChild(fragment);
    $("loadMoreBtn").hidden = state.visible.length <= state.limit;
  }
  $("searchInput").addEventListener("input", () => { state.limit = 60; renderGrid(); });
  $("loadMoreBtn").onclick = () => { state.limit += 60; renderGrid(); };

  function updateSelectedHero(item, card) {
    state.selected = Object.assign({kind: state.section}, item);
    state.lastFocus = card;
    $("heroEyebrow").textContent = state.section === "live" ? "CANAL SELECIONADO" : state.section === "movies" ? "FILME SELECIONADO" : "SÉRIE SELECIONADA";
    $("heroTitle").textContent = item.name;
    $("heroDescription").textContent = niceText(item.plot) || (state.section === "live" ? "Canal selecionado. Use Tela cheia para ampliar a transmissão." : "Confira os detalhes e comece a assistir.");
    $("heroMeta").firstElementChild.textContent = state.section === "live" ? "AO VIVO" : state.section === "movies" ? "FILME" : "SÉRIE";
    $("heroSecondary").textContent = item.group;
    $("heroWatch").disabled = false;
    $("heroWatchLabel").textContent = state.section === "live" ? "Tela cheia" : state.section === "movies" ? "Assistir filme" : "Ver episódios";
    $("heroDetails").hidden = state.section === "live";
    $("heroFormat").hidden = state.section !== "live" || !player.isSamsung;
    $("heroFormat").textContent = state.liveExtension === "ts" ? "↻ Testar HLS" : "↻ Testar MPEG-TS";
    document.querySelectorAll("#mediaGrid .media-card").forEach(c => c.classList.toggle("is-picked", c === card));
  }

  // Prévia explícita: OK no canal carrega dentro da janela de catálogo.
  // AVPlay pode ficar preto ao mover um player já em execução;
  // por isso a ampliação sempre fecha e reabre o stream após a transição.
  function liveUrl(item) {
    return item.directUrl || state.client.getLiveStreamUrl(
      item.id, player.isSamsung ? state.liveExtension : "m3u8"
    );
  }

  async function startLivePreview(item, card) {
    clearTimeout(state.previewTimeout);
    updateSelectedHero(item, card);
    const currentProgram=state.guideMeta.get(String(item.id));
    if(currentProgram) $("heroDescription").textContent=currentProgram.title + (currentProgram.description ? " • "+currentProgram.description : "");
    state.playing = item;
    $("previewPlaceholder").hidden = false;
    $("previewPlaceholder").style.backgroundImage = "";
    $("previewLabel").textContent = item.name;
    $("previewHint").textContent = "Carregando prévia...";
    $("previewLive").hidden = false;
    const result = await player.play(liveUrl(item));
    if (state.isFullscreen || state.section !== "live" ||
        !state.selected || String(state.selected.id) !== String(item.id)) return;
    $("previewPlaceholder").hidden = !!result;
    if (!result) $("previewHint").textContent =
      "Prévia indisponível. Tente outro formato (TS / HLS).";
  }

  async function selectItem(item, card) {
    clearTimeout(state.previewTimeout);
    updateSelectedHero(item, card);
    if (state.section === "live") {
      await startLivePreview(item, card);
      return;
    }
    player.stop();
    $("previewPlaceholder").hidden = false;
    $("previewLive").hidden = true;
    $("previewLabel").textContent = item.name;
    $("previewHint").textContent = "Selecione Detalhes para saber mais";
    const poster = safeImage(item.image);
    $("previewPlaceholder").style.backgroundImage = poster ? "linear-gradient(#071626c9,#091321d9),url(" + JSON.stringify(poster) + ")" : "";
    $("previewPlaceholder").style.backgroundSize = "cover";
    if (state.section === "series") openDetails(item);
  }

  $("heroWatch").onclick = async () => {
    if (!state.selected) return;
    if (state.section === "series") { openDetails(state.selected); return; }
    if (state.section === "movies") { await playMovie(state.selected); return; }
    const item = state.selected;
    // IMPORTANTE: fechar antes de mover o elemento <object> do AVPlay.
    await player.stop();
    if (state.section !== "live" || !state.selected ||
        String(state.selected.id) !== String(item.id)) return;
    state.wasLiveBeforeFullscreen = true;
    openFullscreen(item.name, true);
    // Layout novo deve ter as dimensões finais antes de chamar setDisplayRect.
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (!state.isFullscreen) return;
    const result = await player.play(liveUrl(item));
    if (!result && state.isFullscreen) showToast("Não foi possível abrir este canal. Volte e tente HLS/TS.");
  };
  $("heroDetails").onclick = () => { if (state.selected) openDetails(state.selected); };
  $("heroFormat").onclick = async () => {
    if (state.section !== "live" || !state.selected) return;
    state.liveExtension = state.liveExtension === "ts" ? "m3u8" : "ts";
    $("heroFormat").textContent = state.liveExtension === "ts" ? "↻ Testar HLS" : "↻ Testar MPEG-TS";
    $("previewPlaceholder").hidden = false;
    $("previewHint").textContent = "Tentando formato " + state.liveExtension.toUpperCase() + "...";
    const item = state.selected;
    const result = await player.play(liveUrl(item));
    if (state.section === "live" && state.selected && state.selected.id === item.id) {
      $("previewPlaceholder").hidden = !!result;
    }
  };

  // Painel rápido exclusivo de filmes e séries. Nenhum player roda em prévia VOD.
  function openQuickActions(item, sourceButton) {
    if (!item || state.section === "live" || state.isFullscreen) return;
    state.quickItem = item;
    state.quickFocus = sourceButton || document.activeElement;
    $("quickKind").textContent = state.section === "movies" ? "FILME" : "SÉRIE";
    $("quickTitle").textContent = item.name;
    $("quickMeta").textContent = item.group || "Catálogo";
    $("quickSynopsis").textContent = niceText(item.plot) ||
      (state.section === "movies" ? "Inicie a reprodução ou veja sinopse e informações." : "Veja temporadas, episódios e informações desta série.");
    $("quickCover").replaceChildren();
    const poster = safeImage(item.image);
    if (poster) {
      const img = document.createElement("img"); img.src = poster; img.alt = "";
      img.onerror = () => { img.remove(); $("quickCover").textContent="▶"; };
      $("quickCover").appendChild(img);
    } else $("quickCover").textContent = "▶";
    $("quickWatch").textContent = state.section === "movies" ? "▶ Assistir" : "▶ Ver episódios";
    $("quickOverlay").hidden = false;
    requestAnimationFrame(() => $("quickWatch").focus());
  }
  function closeQuickActions(restoreFocus = true) {
    if ($("quickOverlay").hidden) return;
    $("quickOverlay").hidden = true;
    const previous = state.quickFocus;
    state.quickItem = null;
    state.quickFocus = null;
    if (restoreFocus && previous && previous.isConnected) previous.focus();
  }
  $("quickClose").onclick = () => closeQuickActions();
  $("quickWatch").onclick = async () => {
    const item=state.quickItem;
    if (!item) return;
    const kind=state.section;
    const previous=state.quickFocus;
    closeQuickActions(false);
    state.lastFocus=previous;
    if (kind === "movies") playMovie(item);
    else {
      await openDetails(item);
      if (!$("detailOverlay").hidden) {
        const firstEpisode=$("episodes").querySelector("button");
        (firstEpisode || $("seasonSelect") || $("detailClose")).focus();
      }
    }
  };
  $("quickDetails").onclick = () => {
    const item=state.quickItem;
    if (!item) return;
    const previous=state.quickFocus;
    closeQuickActions(false);
    state.lastFocus=previous;
    openDetails(item);
  };

  async function openDetails(item) {
    if (state.section === "live") return;
    const kind = state.section;
    const key = kind + ":" + item.id;
    state.currentDetail = key;
    $("detailOverlay").hidden = false;
    requestAnimationFrame(() => {
      if (!$("detailOverlay").hidden) $("detailClose").focus();
    });
    $("detailType").textContent = kind === "movies" ? "FILME" : "SÉRIE";
    $("detailName").textContent = item.name;
    $("detailMeta").textContent = item.group + (item.rating ? " • Nota " + item.rating : "");
    $("detailPlot").textContent = niceText(item.plot) || "Carregando informações...";
    $("detailStatus").textContent = "Buscando informações...";
    $("detailWatch").hidden = kind !== "movies";
    $("detailRestart").hidden = kind !== "movies";
    if (kind === "movies") {
      const previous = watchHistory.getMovie(item.id);
      const resume = previous && !previous.completed && previous.positionMs >= 30000;
      $("detailWatch").textContent = resume ? "▶ Continuar em " + formatMediaTime(previous.positionMs) : "▶ Assistir filme";
      $("detailWatch").onclick = () => playMovie(item);
      $("detailRestart").hidden = !resume;
      $("detailRestart").onclick = () => playMovie(item, true);
    }
    $("seasonArea").hidden = true;
    $("seasonArea").querySelectorAll(".next-episode-btn").forEach(n=>n.remove());
    $("detailCover").replaceChildren();
    const img = safeImage(item.image);
    if (img) {
      const image = document.createElement("img"); image.src = img; image.alt = "";
      image.onerror = () => image.remove();
      $("detailCover").appendChild(image);
    } else $("detailCover").textContent = "▶";
    $("detailClose").focus();
    try {
      if (kind === "movies") {
        const response = await state.client.getVodInfo(item.id);
        if (state.currentDetail !== key) return;
        const detail = response.info || {};
        $("detailPlot").textContent = niceText(detail.plot || item.plot) || "Sinopse não disponível.";
        $("detailMeta").textContent = [detail.genre || item.group, detail.duration || "", detail.rating ? "Nota " + detail.rating : ""].filter(Boolean).join(" • ");
        $("detailWatch").onclick = () => playMovie(item);
      } else {
        const response = await state.client.getSeriesInfo(item.id);
        if (state.currentDetail !== key) return;
        const detail = response.info || {};
        $("detailPlot").textContent = niceText(detail.plot || item.plot) || "Sinopse não disponível.";
        const episodes = response.episodes || {};
        const seasons = Object.keys(episodes).sort((a,b)=>Number(a)-Number(b));
        if (!seasons.length) {
          $("detailStatus").textContent = "O provedor não disponibilizou episódios para esta série.";
          return;
        }
        $("seasonArea").hidden = false;
        $("seasonSelect").replaceChildren();
        seasons.forEach(number => {
          const opt = document.createElement("option"); opt.value = number; opt.textContent = "Temporada " + number;
          $("seasonSelect").appendChild(opt);
        });
        const renderEpisodes = () => {
          const entries = episodes[$("seasonSelect").value] || [];
          $("episodes").replaceChildren();
          entries.forEach((episode, idx) => {
            const button = document.createElement("button"); button.className = "episode"; button.type = "button";
            const name = document.createElement("strong"); name.textContent = (episode.episode_num || idx + 1) + ". " + (episode.title || "Episódio " + (idx + 1));
            const sub = document.createElement("small");
            const history = watchHistory.getEpisode(episode.id);
            const resume = history && !history.completed && history.positionMs >= 30000;
            sub.textContent = resume ? "▶ Continuar em " + formatMediaTime(history.positionMs) :
              history && history.completed ? "✓ Episódio assistido — reproduzir do início" : "▶ Reproduzir episódio";
            button.append(name, sub);
            button.onclick = () => playEpisode(item, episode);
            if (resume) {
              const reset = document.createElement("small"); reset.className = "resume-indicator";
              reset.textContent = "Para recomeçar, use Do início após selecionar";
              // Recomeçar via botão dedicado, acessível pelo controle.
              const restart = document.createElement("button");
              restart.type = "button"; restart.className = "episode";
              restart.textContent = "↻ Do início: " + (episode.title || "episódio");
              restart.onclick = () => playEpisode(item, episode, true);
              $("episodes").append(button, restart);
            } else {
              $("episodes").appendChild(button);
            }
          });
        };
        $("seasonSelect").onchange = renderEpisodes;
        const latest = watchHistory.latestSeries(item.id);
        const allEpisodes=seasons.flatMap(s=>episodes[s]||[]);
        const currentEpisodeIndex=latest ? allEpisodes.findIndex(e=>String(e.id)===latest.episodeId) : -1;
        if(currentEpisodeIndex>=0) {
          const next=latest.completed ? allEpisodes[currentEpisodeIndex+1] : allEpisodes[currentEpisodeIndex];
          if(next){
            const nextBtn=document.createElement("button");nextBtn.type="button";nextBtn.className="button-accent next-episode-btn";
            nextBtn.textContent=latest.completed ? "▶ Próximo episódio" : "▶ Continuar episódio";
            nextBtn.onclick=()=>playEpisode(item,next);
            $("seasonArea").insertBefore(nextBtn,$("seasonSelect").previousElementSibling);
            if(latest.completed) {
              const nextSeason=seasons.find(s=>(episodes[s]||[]).some(e=>String(e.id)===String(next.id)));
              if(nextSeason) $("seasonSelect").value=nextSeason;
            }
          }
        }
        renderEpisodes();
      }
      $("detailStatus").textContent = "";
    } catch (error) {
      if (state.currentDetail === key) $("detailStatus").textContent = "Não foi possível buscar mais detalhes: " + errorText(error);
      if (kind === "movies") $("detailWatch").onclick = () => playMovie(item);
    }
  }
  function closeDetails() { $("detailOverlay").hidden = true; state.currentDetail = null; }
  $("detailClose").onclick = () => { closeDetails(); if (state.lastFocus && state.lastFocus.isConnected) state.lastFocus.focus(); };

  function formatMediaTime(ms) {
    const secs = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = String(secs % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + s : String(m).padStart(2, "0") + ":" + s;
  }
  function updateVodProgress(progress) {
    if (!$('vodProgress')) return;
    const duration = Number(progress.duration) || 0;
    const current = Number(progress.current) || 0;
    $("vodCurrent").textContent = formatMediaTime(current);
    $("vodDuration").textContent = duration ? formatMediaTime(duration) : "--:--";
    $("vodProgress").disabled = !duration || state.section === "live";
    // Enquanto o usuário escolhe outro momento na linha do tempo, o
    // relógio real continua atualizando sem mover a seleção do controle.
    if (state.scrubTargetMs == null) {
      $("vodProgress").value = duration > 0 ? Math.round(Math.min(1, current / duration) * 1000) : 0;
    }
    if (state.currentVod && state.isFullscreen && state.section !== "live") {
      if (state.pendingResume != null && duration > 1000) {
        const target = Math.min(state.pendingResume, duration - 5000);
        state.pendingResume = null;
        if (target >= 30000) {
          player.seekTo(target).then(ok => {
            if (ok && state.isFullscreen) showToast("Retomando de " + formatMediaTime(target));
          });
          return;
        }
      }
      historyRecord(state.currentVod, false);
    }
  }
  function showToast(message) {
    clearTimeout(state.toastTimeout);
    $("playbackToast").textContent = message;
    $("playbackToast").hidden = false;
    state.toastTimeout = setTimeout(() => { $("playbackToast").hidden = true; }, 3700);
  }
  function clearScrub() {
    state.scrubTargetMs = null;
    state.scrubLastKeyAt = 0;
    state.scrubRepeatCount = 0;
    $("vodSeekTarget").hidden = true;
    const progress = player.getProgress();
    $("vodProgress").value = progress.duration > 0
      ? Math.round(Math.min(1, progress.current / progress.duration) * 1000) : 0;
  }
  function planControlsHide() {
    clearTimeout(state.controlsTimeout);
    // Não recolher os controles enquanto o usuário escolhe um ponto.
    if (player.paused || state.scrubTargetMs != null || state.scrubSeeking) return;
    state.controlsTimeout = setTimeout(hideVodControls, 5200);
  }
  function hideVodControls() {
    if (player.paused || state.scrubTargetMs != null || state.scrubSeeking) return;
    clearTimeout(state.controlsTimeout);
    $("vodControls").hidden = true;
    if ($("vodControls").contains(document.activeElement)) document.activeElement.blur();
  }
  function showVodControls(focusBtn) {
    if (!state.isFullscreen || state.section === "live") return;
    $("vodControls").hidden = false;
    $("vodToggle").textContent = player.paused ? "▶ Continuar" : "❚❚ Pausar";
    if (focusBtn) $("vodToggle").focus();
    planControlsHide();
  }
  function focusVodBar() {
    showVodControls(false);
    if ($("vodProgress").disabled) {
      showToast("Este vídeo ainda não informou a duração para navegar.");
      $("vodToggle").focus();
      return;
    }
    $("vodProgress").focus();
  }
  function moveScrub(direction, repeat) {
    const progress = player.getProgress();
    if (!(progress.duration > 1000)) {
      showToast("Este conteúdo não permite escolher uma posição.");
      return;
    }
    if (state.scrubSeeking) return;
    const now = Date.now();
    state.scrubRepeatCount = repeat && now - state.scrubLastKeyAt < 400
      ? state.scrubRepeatCount + 1 : 0;
    state.scrubLastKeyAt = now;
    // Acelera apenas a escolha visual do destino; AVPlay recebe UM seek no OK.
    const stepMs = state.scrubRepeatCount > 10 ? 60000 :
      state.scrubRepeatCount > 3 ? 30000 : 10000;
    const base = state.scrubTargetMs == null ? progress.current : state.scrubTargetMs;
    state.scrubTargetMs = Math.max(0, Math.min(progress.duration - 500, base + direction * stepMs));
    $("vodProgress").value = Math.round(state.scrubTargetMs / progress.duration * 1000);
    $("vodSeekTarget").textContent = "Ir para " + formatMediaTime(state.scrubTargetMs) +
      "  •  OK para confirmar";
    $("vodSeekTarget").hidden = false;
    showVodControls(false);
  }
  async function confirmScrub() {
    if (state.scrubSeeking) return;
    if (state.scrubTargetMs == null) {
      showToast("Use ◀ e ▶ para escolher o ponto e confirme com OK.");
      return;
    }
    const target = state.scrubTargetMs;
    state.scrubSeeking = true;
    $("vodSeekTarget").textContent = "Buscando " + formatMediaTime(target) + "...";
    try {
      const ok = await player.seekTo(target);
      if (ok) {
        flushHistory();
        showToast("Reproduzindo a partir de " + formatMediaTime(target));
      } else {
        showToast("Não foi possível avançar agora. Aguarde o carregamento.");
      }
    } finally {
      state.scrubSeeking = false;
      clearScrub();
      showVodControls(false);
    }
  }
  function toggleVod() {
    if (state.section === "live") return;
    if (player.togglePause()) { flushHistory(); showVodControls(); }
  }
  async function vodSeek(seconds) {
    if (state.scrubSeeking) return;
    clearScrub();
    const ok = await player.seekBy(seconds);
    if (!ok) showToast("Não é possível avançar neste vídeo.");
    else flushHistory();
    showVodControls();
  }
  async function recoverVod() {
    if (state.section === "live" || !state.isFullscreen || !state.currentVod || state.recoveringVod) return;
    state.recoveringVod = true;
    $("vodRecover").disabled = true;
    // Guarda a posição ANTES do novo open() para preservar o histórico.
    const position = player.getProgress().current;
    flushHistory();
    state.pendingResume = null;
    showToast("Reconectando o filme a partir da posição atual...");
    try {
      const ok = await player.recoverVod(position);
      if (state.isFullscreen) {
        showToast(ok ? "Vídeo reconectado. Verifique áudio e imagem." :
          "Não foi possível recuperar. Tente reabrir o filme.");
        showVodControls();
      }
    } finally {
      state.recoveringVod = false;
      $("vodRecover").disabled = false;
    }
  }
  $("vodRecover").onclick = recoverVod;
  $("vodToggle").onclick = toggleVod;
  $("vodBack").onclick = () => vodSeek(-10);
  $("vodForward").onclick = () => vodSeek(10);
  $("vodStop").onclick = () => closeFullscreen();
  // No computador, clicar/arrastar a barra também permite escolher o ponto.
  $("vodProgress").addEventListener("input", () => {
    const duration = player.getProgress().duration;
    if (!(duration > 0)) return;
    state.scrubTargetMs = duration * Number($("vodProgress").value) / 1000;
    $("vodSeekTarget").textContent = "Ir para " + formatMediaTime(state.scrubTargetMs) + "  •  OK para confirmar";
    $("vodSeekTarget").hidden = false;
    showVodControls(false);
  });
  $("vodProgress").addEventListener("change", () => { confirmScrub(); });

  // Teclas de mídia da Samsung: alguns controles têm botões Play/Pause,
  // outros dependem de OK e das setas. O registro é opcional.
  try {
    if (window.tizen && tizen.tvinputdevice && tizen.tvinputdevice.registerKey) {
      ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaRewind", "MediaFastForward"]
        .forEach(key => { try { tizen.tvinputdevice.registerKey(key); } catch (_) {} });
    }
  } catch (_) {}

  document.addEventListener("keydown", function(event) {
    if (!state.isFullscreen) return;
    const key = event.keyCode;
    const back = key === 10009 || event.key === "Escape" || event.key === "Backspace";
    const enter = key === 13 || event.key === "Enter";
    const live = state.section === "live";
    if (back || key === 413) {
      event.preventDefault(); event.stopImmediatePropagation(); closeFullscreen(); return;
    }
    if (live) {
      if (key === 427 || event.key === "PageUp") { event.preventDefault(); event.stopImmediatePropagation(); changeLive(1); }
      else if (key === 428 || event.key === "PageDown") { event.preventDefault(); event.stopImmediatePropagation(); changeLive(-1); }
      else if (enter) { event.preventDefault(); event.stopImmediatePropagation(); showToast($("fullscreenTitle").textContent + " • Ao vivo"); }
      return;
    }
    const mediaPlay = key === 10252 || key === 415 || key === 19;
    const forward = key === 417, backward = key === 412;
    if (mediaPlay || forward || backward) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (forward) vodSeek(10);
      else if (backward) vodSeek(-10);
      else if (key === 415 && !player.paused) showVodControls();
      else if (key === 19 && player.paused) showVodControls();
      else toggleVod();
      return;
    }
    if (event.key === "ArrowLeft" || key === 37 || event.key === "ArrowRight" || key === 39) {
      event.preventDefault(); event.stopImmediatePropagation();
      const buttons = [$("vodBack"), $("vodToggle"), $("vodForward"), $("vodRecover"), $("vodStop")];
      const focusedIndex = $("vodControls").hidden ? -1 : buttons.indexOf(document.activeElement);
      const delta = (key === 37 || event.key === "ArrowLeft") ? -1 : 1;
      if (focusedIndex >= 0) {
        buttons[Math.max(0, Math.min(buttons.length - 1, focusedIndex + delta))].focus();
        showVodControls(false);
      } else if (document.activeElement === $("vodProgress")) {
        moveScrub(delta, !!event.repeat);
      } else {
        // Setas não fazem seek imediato. Elas levam o foco à barra.
        focusVodBar();
      }
      return;
    }
    if (event.key === "ArrowDown" || key === 40 || event.key === "ArrowUp" || key === 38) {
      event.preventDefault(); event.stopImmediatePropagation();
      const up = key === 38 || event.key === "ArrowUp";
      if (up) focusVodBar();
      else showVodControls(true);
      return;
    }
    if (enter) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!$("vodControls").hidden && document.activeElement === $("vodProgress")) {
        confirmScrub();
      } else if (!$("vodControls").hidden && $("vodControls").contains(document.activeElement)) {
        document.activeElement.click();
      } else {
        showVodControls(true);
      }
      return;
    }
  }, true);

  function openFullscreen(title, live) {
    clearScrub();
    clearTimeout(state.previewTimeout);
    closeDetails();
    state.isFullscreen = true;
    $("fullscreenLayer").hidden = false;
    $("fullscreenTitle").textContent = title;
    $("vodTitle").textContent = title;
    $("fullscreenDock").appendChild($("playerStage"));
    $("playbackToast").hidden = true;
    $("vodControls").hidden = true;
    if (player.isSamsung) document.body.classList.add("md-playback-mode");
    if (!live) {
      $("vodDiagnostics").textContent = "AVPlay • Preparando reprodução...";
      showVodControls(false);
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    requestAnimationFrame(() => player.position());
  }
  async function closeFullscreen() {
    if (!state.isFullscreen) return;
    clearScrub();
    clearTimeout(state.controlsTimeout);
    clearTimeout(state.toastTimeout);
    clearTimeout(state.previewTimeout);
    state.isFullscreen = false;
    $("vodControls").hidden = true;
    $("playbackToast").hidden = true;
    // Salva a posição antes de fechar o AVPlay.
    flushHistory();
    state.currentVod = null;
    state.pendingResume = null;
    state.recoveringVod = false;
    // Fechar o motor antes de realocar o elemento AVPlay no DOM.
    await player.stop();
    $("previewFrame").insertBefore($("playerStage"), $("previewFrame").firstChild);
    $("fullscreenLayer").hidden = true;
    document.body.classList.remove("md-playback-mode");
    state.playing = null;
    $("previewPlaceholder").hidden = false;
    $("previewLive").hidden = true;
    $("previewHint").textContent = "Pressione OK em um canal para abrir a prévia.";
    if (state.section !== "live" && state.catalogs[state.section]) renderGrid();
    if (state.lastFocus && state.lastFocus.isConnected) state.lastFocus.focus();
  }
  $("fullscreenBack").onclick = closeFullscreen;

  async function playMovie(item, fromBeginning) {
    state.wasLiveBeforeFullscreen = false;
    const historyItem = {kind:"movies", id:String(item.id), title:item.name, image:item.image};
    state.currentVod = historyItem;
    applyResume(historyItem);
    if (fromBeginning) state.pendingResume = null;
    openFullscreen(item.name, false);
    const url = state.client.getVodUrl(item.id, item.extension);
    const ok = await player.play(url, {kind:"vod"});
    if (!ok) { state.currentVod = null; state.pendingResume = null; }
    updateVodProgress(player.getProgress());
  }
  async function playEpisode(series, episode, fromBeginning) {
    state.wasLiveBeforeFullscreen = false;
    const ext = episode.container_extension || "mp4";
    const historyItem = {
      kind:"series", id:String(series.id), episodeId:String(episode.id),
      title:series.name, episodeTitle:episode.title || "Episódio", image:series.image
    };
    state.currentVod = historyItem;
    applyResume(historyItem);
    if (fromBeginning) state.pendingResume = null;
    openFullscreen(series.name + " — " + (episode.title || "Episódio"), false);
    const url = state.client.getEpisodeUrl(episode.id, ext);
    const ok = await player.play(url, {kind:"vod"});
    if (!ok) { state.currentVod = null; state.pendingResume = null; }
    updateVodProgress(player.getProgress());
  }
  function changeLive(step) {
    if (state.section !== "live" || !state.visible.length || !state.playing) return;
    const index = state.visible.findIndex(item => item.id === state.playing.id);
    const item = state.visible[(index + step + state.visible.length) % state.visible.length];
    if (!item) return;
    state.playing = item;
    state.selected = Object.assign({kind:"live"}, item);
    $("fullscreenTitle").textContent = item.name;
    player.play(liveUrl(item));
  }
  $("fullPrev").onclick = () => changeLive(-1);
  $("fullNext").onclick = () => changeLive(1);
  $("logoutBtn").onclick = () => {
    ++state.loadSeq;
    player.stop(); closeQuickActions(false); closeDetails();
    if (state.isFullscreen) closeFullscreen();
    state.client = null; state.catalogs = {}; state.selected = null; state.playing = null;
    state.currentProfileId = null;
    state.currentVod = null; state.pendingResume = null;
    $("password").value = ""; $("playlistUrl").value = "";
    $("storageWarning").hidden = true;
    if (getProfiles().length) chooseProfiles();
    else openProfileForm(null, false);
  };

  // Navegação espacial para Samsung Smart Remote, setas e OK.
  document.addEventListener("keydown", event => {
    const back = event.keyCode === 10009 || event.key === "Escape" || event.key === "Backspace";
    if (back) {
      if (!$("deleteOverlay").hidden) { event.preventDefault(); $("cancelDelete").click(); return; }
      if (!$("quickOverlay").hidden) { event.preventDefault(); closeQuickActions(); return; }
      if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      if (state.isFullscreen) { event.preventDefault(); closeFullscreen(); return; }
      if (!$("detailOverlay").hidden) { event.preventDefault(); closeDetails(); return; }
      if (!$("loginScreen").hidden && getProfiles().length) { event.preventDefault(); chooseProfiles(); return; }
      if (!$('appScreen').hidden && state.section !== 'home') {
        event.preventDefault(); event.stopPropagation();
        showSection('home');
        return;
      }
    }
    if (state.isFullscreen) {
      if (event.keyCode === 427 || event.key === "PageUp") { event.preventDefault(); changeLive(1); }
      if (event.keyCode === 428 || event.key === "PageDown") { event.preventDefault(); changeLive(-1); }
      return;
    }
    if (!$("detailOverlay").hidden || !$("deleteOverlay").hidden || !$("quickOverlay").hidden) return;
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const direction = {ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
    if (!direction) return;
    const source = document.activeElement;
    if (!source || source === document.body) return;
    const start = source.getBoundingClientRect();
    const px = start.left + start.width / 2, py = start.top + start.height / 2;
    const screen = !$("profilesScreen").hidden ? "profilesScreen" :
      !$("loginScreen").hidden ? "loginScreen" :
      !$("appScreen").hidden ? "appScreen" : "";
    if (!screen) return;
    const targets = Array.from(document.querySelectorAll(
      "#" + screen + " button:not([disabled]),#" + screen + " input:not([disabled]),#" + screen + " textarea:not([disabled])"
    )).filter(item => item !== source && item.offsetParent !== null);
    let closest = null, smallest = Infinity;
    targets.forEach(target => {
      const box = target.getBoundingClientRect();
      const dx = box.left + box.width / 2 - px, dy = box.top + box.height / 2 - py;
      const forward = dx * direction[0] + dy * direction[1];
      const cross = Math.abs(dx * direction[1] - dy * direction[0]);
      if (forward < 8) return;
      const score = forward + cross * 2.4;
      if (score < smallest) { closest = target; smallest = score; }
    });
    if (closest) { event.preventDefault(); closest.focus(); closest.scrollIntoView({block:"nearest",inline:"nearest"}); }
  });
  if (!storageAvailable) {
    $("storageWarning").textContent = "Armazenamento local indisponível. Abra pelo servidor local ou teste no Tizen.";
  }
  const firstProfiles = getProfiles();
  if (firstProfiles.length) {
    chooseProfiles();
    const auto = firstProfiles.find(profile => profile.autoConnect && !!profile.password);
    if (auto) connectSavedProfile(auto, true);
  } else {
    openProfileForm(null, false);
    if (!storageAvailable) info("Aviso: neste modo, os acessos não persistem após fechar o aplicativo.", true);
  }
});
