// MDStream v4.1 - Navegacao de login por controle remoto Samsung.
// Teclado virtual (IME): setas movem foco; OK abre teclado; Done/Voltar retorna.
// Depende da metadata use.keypad.without.useraction=false no config.xml.
(function () {
  "use strict";
  const login = document.getElementById("loginScreen");
  if (!login) return;

  const keyOrder = [
    "loginBackBtn", "modeXtream", "modeM3u", "profileName", "server",
    "username", "password", "playlistUrl", "saveProfile",
    "rememberPassword", "autoConnect", "connectBtn"
  ];
  const isSamsungTV = !!(window.tizen || (window.webapis && window.webapis.avplay));
  const isEditable = element => !!element && (
    element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(element.type))
  );
  let imeEditing = false;
  let lastEditor = null;

  const visible = element => !!element && !element.disabled &&
    !element.hidden && !element.closest("[hidden]") &&
    element.getClientRects().length > 0;
  const loginControls = () => keyOrder
    .map(id => document.getElementById(id))
    .filter(visible);

  function focusOn(element) {
    if (!element) return;
    element.focus();
    try { element.scrollIntoView({block: "nearest", inline: "nearest"}); }
    catch (_) { element.scrollIntoView(); }
  }

  function moveLogin(current, direction) {
    const controls = loginControls();
    if (!controls.length) return;
    const index = controls.indexOf(current);
    if (index === -1) { focusOn(controls[0]); return; }

    // Os dois modos de login ficam lado a lado.
    if (current.id === "modeXtream" && direction === "right") {
      focusOn(document.getElementById("modeM3u")); return;
    }
    if (current.id === "modeM3u" && direction === "left") {
      focusOn(document.getElementById("modeXtream")); return;
    }

    const delta = (direction === "down" || direction === "right") ? 1 : -1;
    focusOn(controls[Math.max(0, Math.min(controls.length - 1, index + delta))]);
  }

  // Ao encerrar a IME, retira o foco do campo editavel.
  // Na TV, recolocar o foco por JavaScript nao reabre o teclado
  // porque a opcao 'use.keypad.without.useraction' esta desativada.
  function finishEditing(done) {
    const current = lastEditor || document.activeElement;
    imeEditing = false;
    lastEditor = null;
    if (!isEditable(current)) return;
    current.blur();
    window.setTimeout(function () {
      if (login && !login.hidden) {
        if (done) moveLogin(current, "down");
        else focusOn(current);
      } else if (visible(current)) {
        focusOn(current);
      }
    }, 0);
  }

  // Em alguns firmwares IME Done/Cancel causa blur sem codigo dedicado.
  document.addEventListener("focusout", function (event) {
    if (isEditable(event.target)) {
      imeEditing = false;
      lastEditor = null;
    }
  }, true);

  document.addEventListener("keydown", function (event) {
    const code = event.keyCode;
    const active = document.activeElement;
    const input = isEditable(active);

    // Codigos oficiais Samsung IME: Done 65376 / Cancel 65385.
    // Nao chamar preventDefault nesses eventos: preserva a edicao de texto.
    if (isSamsungTV && (code === 65376 || code === 65385)) {
      if (input || lastEditor) finishEditing(code === 65376);
      return;
    }

    // Em TVs, OK deve alternar as caixas de selecao do formulario.
    // O Enter nativo nao ativa checkbox em todos os Web Engines.
    if (!login.hidden && active && active.tagName === "INPUT" &&
        active.type === "checkbox" &&
        (event.key === "Enter" || code === 13)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      active.click();
      return;
    }

    if (isSamsungTV && input &&
        (event.key === "Enter" || code === 13)) {
      // O sistema Samsung abre o teclado quando o usuario pressiona OK.
      imeEditing = true;
      lastEditor = active;
      return;
    }

    if (isSamsungTV && imeEditing) {
      const back = code === 10009 || event.key === "Escape";
      if (back) {
        // O fechamento explicito tambem cobre firmwares que enviam Back
        // sem enviar o codigo de Cancel da IME.
        finishEditing(false);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      // Ao digitar, as setas pertencem ao teclado virtual, nao ao formulario.
      return;
    }

    // Enquanto nao houver IME, o formulario deve aceitar setas em campos
    // de texto. O antigo main.js ignorava as setas quando input estava ativo.
    if (login.hidden || document.getElementById("deleteOverlay").hidden === false) return;
    const arrow = {
      ArrowUp: "up", ArrowDown: "down",
      ArrowLeft: "left", ArrowRight: "right"
    }[event.key] || ({37:"left",38:"up",39:"right",40:"down"})[code];
    if (!arrow) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    moveLogin(active, arrow);
  }, true);
})();
