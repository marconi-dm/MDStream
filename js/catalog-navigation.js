/* MDStream v5.2 — navegação sem barra lateral pelo Smart Remote em todo o catálogo.
 * Não toca no login, no Xtream, nos perfis salvos nem no player.
 * Escuta antes do listener antigo para não deixar setas sem destino.
 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const app = $("appScreen");
  const profiles = $("profilesScreen");
  const details = $("detailOverlay");
  const deletion = $("deleteOverlay");
  const fullscreen = $("fullscreenLayer");
  const quick = $("quickOverlay");
  if (!app || !profiles || !details || !deletion || !fullscreen || !quick) return;

  const KEY = {
    37: "left", 38: "up", 39: "right", 40: "down",
    ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down",
    Left: "left", Up: "up", Right: "right", Down: "down"
  };
  let searchEditing = false;
  let seasonEditing = false;

  function visible(el) {
    return !!el && el.isConnected && !el.hidden && !el.disabled &&
      !el.closest("[hidden]") && el.getClientRects().length > 0;
  }
  function controls(container, selector) {
    return Array.from(container.querySelectorAll(selector)).filter(visible);
  }
  function focus(el) {
    if (!visible(el)) return false;
    el.focus();
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    catch (_) { el.scrollIntoView(); }
    return true;
  }
  const first = (container, selector) => controls(container, selector)[0] || null;
  const nav = () => controls(app, "#sectionBackBtn");
  const category = () => controls($("categories"), ".category-btn");
  const historyTabs = () => controls($("historyTabs"), ".history-tab");
  const cards = () => controls($("mediaGrid"), ".media-card");
  const guides = () => controls($("liveGuide"), ".guide-channel,.guide-program,.guide-more");
  const homes = () => controls($("homeDashboard"), "button");
  const hero = () => controls(app, ".hero-buttons button");
  const activeNav = () => nav()[0] || homes()[0];
  const activeCategory = () => first($("categories"), ".category-btn.active") || category()[0];
  function firstContent() {
    return first(app, '.home-tile') || historyTabs()[0] || activeCategory() || guides()[0] || cards()[0] || first(app, "#searchInput") || first(app, "#heroWatch") || activeNav();
  }

  // Mantém um foco visível quando o login é substituído pelo catálogo.
  const observer = new MutationObserver(() => {
    if (app.hidden) { searchEditing = false; return; }
    const active = document.activeElement;
    if (!app.contains(active) || !visible(active)) {
      window.setTimeout(() => {
        if (!app.hidden && details.hidden && quick.hidden && deletion.hidden && fullscreen.hidden &&
            (!app.contains(document.activeElement) || !visible(document.activeElement))) {
          focus(activeNav() || firstContent());
        }
      }, 0);
    }
  });
  observer.observe(app, { attributes: true, attributeFilter: ["hidden"] });

  function columns() {
    const items = cards();
    if (items.length < 2) return 1;
    const firstBox = items[0].getBoundingClientRect();
    const y = firstBox.top + firstBox.height / 2;
    let count = 0;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (Math.abs(r.top + r.height / 2 - y) > 12) break;
      count++;
    }
    return Math.max(1, count);
  }

  function inList(current, list, direction, fallback) {
    const index = list.indexOf(current);
    if (index < 0) return focus(fallback || list[0]);
    const change = (direction === "left" || direction === "up") ? -1 : 1;
    return focus(list[Math.min(list.length - 1, Math.max(0, index + change))]);
  }

  function appMove(active, direction) {
    const menu = nav();
    const cats = category();
    const tabs = historyTabs();
    const tiles = cards();
    const guideItems=guides();
    const homeItems=homes();
    const actions = hero();
    if(homeItems.includes(active)){
      return spatialMove(active,homeItems,direction);
    }
    if(guideItems.includes(active)){
      const row=active.closest(".guide-row");
      if(!row) return focus(guideItems[0]);
      const rows=Array.from($("liveGuide").querySelectorAll(".guide-row"));
      const index=rows.indexOf(row);
      const buttons=controls(row,".guide-channel,.guide-program");
      const col=Math.max(0,buttons.indexOf(active));
      if(direction==="left")return col===0?focus(activeNav()):focus(buttons[col-1]);
      if(direction==="right")return focus(buttons[Math.min(col+1,buttons.length-1)]);
      if(direction==="up"){
        if(index===0)return focus(activeCategory()||actions[0]);
        const prev=controls(rows[index-1],".guide-channel,.guide-program");
        return focus(prev[Math.min(col,prev.length-1)]);
      }
      if(direction==="down"){
        const next=rows[index+1];if(!next)return focus(first($("liveGuide"),".guide-more")||active);
        const nextItems=controls(next,".guide-channel,.guide-program");
        return focus(nextItems[Math.min(col,nextItems.length-1)]);
      }
    }
    const search = $("searchInput");
    const more = $("loadMoreBtn");

    if (menu.includes(active)) {
      if (direction === "down" || direction === "right") {
        return focus((!app.classList.contains("live-layout") && search) || actions[0] || tabs[0] || activeCategory() || guideItems[0] || tiles[0]);
      }
      return true;
    }
    if (actions.includes(active)) {
      if (direction === "up") return focus(activeNav());
      if (direction === "down") return focus(tabs[0] || activeCategory() || search || guideItems[0] || tiles[0]);
      return inList(active, actions, direction);
    }
    if (tabs.includes(active)) {
      const index = tabs.indexOf(active);
      if (direction === "up") return focus(search || activeNav());
      if (direction === "down") return focus(activeCategory() || tiles[0] || search);
      if (direction === "left" && index === 0) return focus(search);
      if (direction === "right" && index === tabs.length - 1) return focus(active);
      return inList(active, tabs, direction);
    }
    if (cats.includes(active)) {
      const index = cats.indexOf(active);
      if (direction === "up") return focus(tabs[0] || search || activeNav());
      if (direction === "down") return focus(guideItems[0] || tiles[0] || search);
      if (direction === "left" && index === 0) return focus(tabs[0] || search);
      if (direction === "right" && index === cats.length - 1) return focus(active);
      return inList(active, cats, direction);
    }
    if (active === search) {
      if (!app.classList.contains("live-layout")) {
        if (direction === "up") return focus(activeNav());
        if (direction === "down") return focus(tabs[0] || activeCategory() || tiles[0] || more);
        if (direction === "left") return focus(activeNav());
        return true;
      }
      if (direction === "left") return focus(cats[cats.length - 1] || activeNav());
      if (direction === "up") return focus(actions[0] || activeNav());
      if (direction === "down") return focus(guideItems[0] || tiles[0] || more);
      return true;
    }
    if (tiles.includes(active)) {
      const index = tiles.indexOf(active);
      const cols = columns();
      if (direction === "left") {
        return index ? focus(tiles[index - 1]) : focus(activeNav());
      }
      if (direction === "right") {
        return focus(tiles[index + 1] || (visible(more) ? more : active));
      }
      if (direction === "up") {
        return index < cols ? focus(activeCategory() || tabs[0] || search || activeNav()) : focus(tiles[index - cols]);
      }
      if (direction === "down") {
        return focus(tiles[index + cols] || (visible(more) ? more : active));
      }
    }
    if (active === more) {
      if (direction === "up") return focus(tiles[tiles.length - 1] || activeCategory() || tabs[0]);
      if (direction === "left") return focus(activeNav());
      if (direction === "right") return focus(search);
      return true;
    }
    // Quando o foco se perde (mudança de tela, carregamento, scroll),
    // a primeira seta recupera o controle do aplicativo.
    return focus(activeNav());
  }

  function spatialMove(active, items, direction) {
    if (!items.length) return false;
    if (!items.includes(active)) return focus(items[0]);
    const rect = active.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    let best = null, bestScore = Infinity;
    items.forEach(item => {
      if (item === active) return;
      const r = item.getBoundingClientRect();
      const dx = r.left + r.width / 2 - x;
      const dy = r.top + r.height / 2 - y;
      const forward = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
      const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      if (forward < 8) return;
      const score = forward + cross * 2.5;
      if (score < bestScore) { best = item; bestScore = score; }
    });
    return focus(best || active);
  }

  function detailMove(active, direction) {
    const items = controls(details, "button,select");
    if (!items.length) return false;
    if (direction === "up" || direction === "down") {
      return inList(active, items, direction);
    }
    const eps = controls($("episodes"), "button");
    if (eps.includes(active)) {
      const i = eps.indexOf(active), n = direction === "left" ? i - 1 : i + 1;
      return focus(eps[n] || active);
    }
    return spatialMove(active, items, direction);
  }

  const search = $("searchInput");
  const season = $("seasonSelect");
  search.addEventListener("blur", () => { searchEditing = false; });
  season.addEventListener("blur", () => { seasonEditing = false; });

  document.addEventListener("keydown", function (event) {
    const code = event.keyCode;
    const active = document.activeElement;
    // Em tela cheia as teclas são gerenciadas pelo player no main.js.
    if (!fullscreen.hidden) return;
    const direction = KEY[event.key] || KEY[code];
    const enter = code === 13 || event.key === "Enter";
    const back = code === 10009 || event.key === "Escape";
    const done = code === 65376 || code === 65385;

    // O script v4.1 continua responsável pelo formulário de login.
    if (!$("loginScreen").hidden && deletion.hidden) return;

    // Samsung IME: não roubar as setas usadas para digitação.
    if (active === search && (done || back) && searchEditing) {
      searchEditing = false;
      if (done) focus(first(app, ".media-card") || search);
      // Deixe a Samsung encerrar o teclado virtual normalmente no Done.
      if (back) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (active === season && (done || back) && seasonEditing) {
      seasonEditing = false;
      if (back) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if ((active === search && searchEditing) || (active === season && seasonEditing)) return;
    // Back no campo de pesquisa sem teclado aberto volta à Home.
    if (active === search && back && !app.hidden) {
      event.preventDefault(); event.stopImmediatePropagation();
      const backButton=$("sectionBackBtn");if(backButton)backButton.click();
      return;
    }

    // Main.js fecha overlays com Voltar. Após fechar, restaure o foco no
    // conteúdo selecionado; em alguns firmwares ele volta para o body.
    if (back && !details.hidden) {
      window.setTimeout(() => {
        if (details.hidden && !app.hidden && (!app.contains(document.activeElement) || !visible(document.activeElement))) {
          focus(first(app, ".media-card.is-picked") || activeNav());
        }
      }, 0);
      return;
    }

    const zone = !deletion.hidden ? "delete" : !fullscreen.hidden ? "full" : !quick.hidden ? "quick" : !details.hidden ? "detail" :
      !profiles.hidden ? "profiles" : !app.hidden ? "app" : "";
    if (!zone) return;
    if (enter) {
      if (active === search) { searchEditing = true; return; }
      if (active === season) { seasonEditing = true; return; }
      if (visible(active) && active.tagName === "BUTTON") {
        event.preventDefault(); event.stopImmediatePropagation();
        active.click();
      }
      return;
    }
    if (!direction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (zone === "app") appMove(active, direction);
    else if (zone === "quick") spatialMove(active, controls(quick, "button"), direction);
    else if (zone === "profiles") spatialMove(active, controls(profiles, "button"), direction);
    else if (zone === "delete") spatialMove(active, controls(deletion, "button"), direction);
    else if (zone === "detail") detailMove(active, direction);
    else if (zone === "full") spatialMove(active, controls(fullscreen, "button"), direction);
  }, true);
})();
