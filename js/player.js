// AVPlay na TV; <video> HTML5 em navegadores. Nunca registra URLs contendo senha.
(function () {
  "use strict";
  class MDStreamPlayer {
    constructor(stage, video, onStatus, onProgress, onComplete, onDiagnostics) {
      this.stage = stage;
      this.video = video;
      this.onStatus = onStatus || function () {};
      this.onProgress = onProgress || function () {};
      this.onComplete = onComplete || function () {};
      this.onDiagnostics = onDiagnostics || function () {};
      this.kind = "live";
      this.buffering = false;
      this.bufferSince = 0;
      this.bufferCount = 0;
      this.bufferTotalMs = 0;
      this.stallCount = 0;
      this.seekFailures = 0;
      this.lastPosition = 0;
      this.lastAdvanceAt = 0;
      this.watchdog = null;
      this.lastStallWarning = 0;
      this.bufferTuningApplied = false;
      this.seeking = false;
      this.paused = false;
      this.avplay = window.webapis && window.webapis.avplay || null;
      this.isSamsung = !!this.avplay;
      this.avObject = this.stage.querySelector('object[type="application/avplayer"]');
      // Ao navegar pelas categorias, a página pode rolar; mantenha o objeto
      // nativo alinhado ao cartão de prévia, sem bloquear o controle remoto.
      this.positionFrame = 0;
      const followPreview = () => {
        if (!this.isSamsung || !this.currentUrl || this.stage.closest('.fullscreen-layer')) return;
        if (this.positionFrame) return;
        this.positionFrame = requestAnimationFrame(() => {
          this.positionFrame = 0;
          if (this.currentUrl) this.position();
        });
      };
      window.addEventListener('scroll', followPreview, true);
      window.addEventListener('resize', followPreview);
      this.token = 0;
      this.queue = Promise.resolve();
      this.pendingPrepareCancel = null;
      this.currentUrl = null;
      this.video.addEventListener("error", () => {
        if (this.currentUrl) this.onStatus("Este formato não é suportado no navegador. Teste na TV.", true);
      });
      this.video.addEventListener("playing", () => {
        this.paused = false;
        this.markBufferEnd();
        this.onStatus("Reproduzindo", false);
      });
      this.video.addEventListener("waiting", () => this.markBufferStart());
      this.video.addEventListener("stalled", () => this.markBufferStart());
      this.video.addEventListener("timeupdate", () => this.reportProgress());
      this.video.addEventListener("loadedmetadata", () => this.reportProgress());
      this.video.addEventListener("ended", () => {
        if (!this.currentUrl) return;
        this.reportProgress();
        this.onComplete();
        this.onStatus("Vídeo finalizado", false);
      });
    }

    // Métricas locais: nunca gravamos nem mostramos URL, usuário ou senha.
    diagnostics() {
      return {
        kind: this.kind,
        buffering: this.buffering,
        bufferEvents: this.bufferCount,
        bufferSeconds: Math.round((this.bufferTotalMs + (this.buffering ? Date.now() - this.bufferSince : 0)) / 1000),
        stalls: this.stallCount,
        seekFailures: this.seekFailures,
        stableMode: this.bufferTuningApplied
      };
    }

    emitDiagnostics() { this.onDiagnostics(this.diagnostics()); }

    markBufferStart() {
      if (this.kind !== "vod" || this.buffering) return;
      this.buffering = true;
      this.bufferSince = Date.now();
      ++this.bufferCount;
      this.emitDiagnostics();
    }

    markBufferEnd() {
      if (!this.buffering) return;
      this.bufferTotalMs += Date.now() - this.bufferSince;
      this.buffering = false;
      this.bufferSince = 0;
      this.lastAdvanceAt = Date.now();
      this.emitDiagnostics();
    }

    noteTime(position) {
      if (this.kind !== "vod" || !Number.isFinite(position)) return;
      if (position > this.lastPosition + 250 || position < this.lastPosition - 1000) {
        this.lastPosition = position;
        this.lastAdvanceAt = Date.now();
      }
    }

    startWatchdog() {
      this.stopWatchdog();
      if (this.kind !== "vod") return;
      this.lastAdvanceAt = Date.now();
      this.lastPosition = -1;
      this.watchdog = setInterval(() => {
        if (!this.currentUrl || this.buffering || this.paused || this.seeking) return;
        try {
          if (this.isSamsung && this.avplay.getState() !== "PLAYING") return;
          if (!this.isSamsung && this.video.paused) return;
          const ms = this.getProgress().current;
          this.noteTime(ms);
          if (this.lastAdvanceAt && Date.now() - this.lastAdvanceAt > 20000 &&
              Date.now() - this.lastStallWarning > 30000) {
            ++this.stallCount;
            this.lastStallWarning = Date.now();
            this.onStatus("Vídeo sem avanço por 20 segundos. Use Recuperar vídeo se persistir.", true);
            this.emitDiagnostics();
          }
        } catch (_) { /* diagnóstico nunca interrompe a reprodução */ }
      }, 5000);
    }

    stopWatchdog() {
      if (this.watchdog) clearInterval(this.watchdog);
      this.watchdog = null;
    }

    // Serializar open/close evita disputas entre dois canais trocados rapidamente.
    // kind='vod' só em filmes/séries; nunca ajustamos buffer de canais ao vivo.
    play(url, options = {}) {
      const token = ++this.token;
      // A preparação anterior pode estar aguardando rede/servidor.
      // Cancelamos a espera ANTES de enfileirar outro open(), para que apenas
      // a seleção mais recente avance; callbacks antigos são ignorados via token.
      if (this.pendingPrepareCancel) this.pendingPrepareCancel();
      this.onStatus("Carregando transmissão...", false);
      const job = async () => {
        // Uma reprodução antiga não pode fechar a sessão mais recente.
        if (token !== this.token) return false;
        this.stopEngine();
        if (token !== this.token) return false;
        this.currentUrl = url;
        this.kind = options.kind === "vod" ? "vod" : "live";
        this.paused = false;
        this.seeking = false;
        this.buffering = false;
        this.bufferCount = 0;
        this.bufferTotalMs = 0;
        this.stallCount = 0;
        this.seekFailures = 0;
        this.lastStallWarning = 0;
        this.bufferTuningApplied = false;
        this.lastResumeSucceeded = true;
        this.emitDiagnostics();
        try {
          if (this.isSamsung) {
            this.avplay.open(url);
            // Buffer moderado somente para VOD. Uma API não suportada não
            // deve impedir o play: AVPlay mantém seus valores padrão.
            if (this.kind === "vod" && typeof this.avplay.setBufferingParam === "function") {
              try {
                this.avplay.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 12);
                this.avplay.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 15);
                this.bufferTuningApplied = true;
              } catch (_) { this.bufferTuningApplied = false; }
            }
            this.position();
            this.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
            this.avplay.setListener({
              onbufferingstart: () => {
                if (token !== this.token) return;
                this.markBufferStart();
                this.onStatus("Carregando buffer do vídeo...", false);
              },
              onbufferingcomplete: () => {
                if (token !== this.token) return;
                this.markBufferEnd();
                this.onStatus("Reproduzindo", false);
              },
              oncurrentplaytime: (ms) => {
                if (token !== this.token) return;
                this.noteTime(Number(ms));
                this.reportProgress();
              },
              onstreamcompleted: () => {
                if (token !== this.token) return;
                this.reportProgress();
                this.onComplete();
                this.onStatus("Transmissão encerrada", false);
              },
              onerror: (code) => {
                if (token !== this.token) return;
                this.onStatus("Falha no AVPlay" + (code ? " (" + String(code).slice(0, 50) + ")" : "") + ". Verifique o arquivo/servidor.", true);
              }
            });
            // prepareAsync pode ficar pendente se o app mudar de tela enquanto prepara.
            // Cancelamos a espera imediatamente no stop, sem continuar o play antigo.
            const prepared = await new Promise((resolve) => {
              let settled = false;
              let timeout;
              const finish = (ok) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (this.pendingPrepareCancel === cancel) this.pendingPrepareCancel = null;
                resolve(ok);
              };
              const cancel = () => finish(false);
              this.pendingPrepareCancel = cancel;
              timeout = setTimeout(() => finish(false), 20000);
              try { this.avplay.prepareAsync(() => finish(true), () => finish(false)); }
              catch (_) { finish(false); }
            });
            if (token !== this.token) return false;
            if (!prepared) throw new Error("Falha ao preparar reprodução");
            this.position();
            // A API documenta seekTo em READY; recuperamos antes de dar play.
            if (this.kind === "vod" && Number(options.resumeAt) >= 5000) {
              try {
                await new Promise((resolve, reject) =>
                  this.avplay.seekTo(Number(options.resumeAt), resolve, reject));
              } catch (_) {
                this.lastResumeSucceeded = false;
              }
              if (token !== this.token) return false;
            }
            this.avplay.play();
            this.startWatchdog();
            this.reportProgress();
            this.onStatus("Reproduzindo", false);
            return true;
          }
          if (/\.ts(?:$|[?#])/i.test(url)) {
            this.onStatus("MPEG-TS exige AVPlay na Samsung. No navegador, tente HLS.", true);
            return false;
          }
          this.video.hidden = false;
          this.video.src = url;
          await this.video.play();
          if (token !== this.token) return false;
          if (this.kind === "vod" && Number(options.resumeAt) > 0) {
            try { this.video.currentTime = Number(options.resumeAt) / 1000; } catch (_) {}
          }
          this.startWatchdog();
          return true;
        } catch (_) {
          if (token === this.token) this.onStatus("Não foi possível reproduzir este conteúdo neste dispositivo.", true);
          if (token === this.token) this.stopEngine();
          return false;
        }
      };
      this.queue = this.queue.then(job, job);
      return this.queue;
    }

    getProgress() {
      try {
        if (this.isSamsung) {
          const state = this.avplay.getState();
          if (state === "NONE" || state === "IDLE") return {current: 0, duration: 0};
          return {current: Number(this.avplay.getCurrentTime()) || 0, duration: Number(this.avplay.getDuration()) || 0};
        }
        return {current: (Number(this.video.currentTime) || 0) * 1000,
          duration: Number.isFinite(this.video.duration) ? this.video.duration * 1000 : 0};
      } catch (_) { return {current: 0, duration: 0}; }
    }

    reportProgress() {
      const current = this.getProgress();
      if (this.kind === "vod") this.noteTime(current.current);
      this.onProgress(current);
    }

    togglePause() {
      try {
        if (!this.currentUrl || this.seeking || this.buffering) return false;
        if (this.isSamsung) {
          const state = this.avplay.getState();
          if (state === "PLAYING") { this.avplay.pause(); this.paused = true; }
          else if (state === "PAUSED") { this.avplay.play(); this.paused = false; }
          else return false;
        } else {
          if (this.video.paused) { this.video.play().catch(() => this.onStatus("Não foi possível retomar o vídeo.", true)); this.paused = false; }
          else { this.video.pause(); this.paused = true; }
        }
        this.onStatus(this.paused ? "Pausado" : "Reproduzindo", false);
        return true;
      } catch (_) { this.onStatus("Controle de pausa indisponível neste vídeo.", true); return false; }
    }

    async seekTo(milliseconds) {
      if (!this.currentUrl || this.seeking || this.buffering) return false;
      const progress = this.getProgress();
      if (!Number.isFinite(progress.duration) || progress.duration <= 1000) {
        this.onStatus("Este vídeo não permite avançar ou retroceder.", true);
        return false;
      }
      const target = Math.max(0, Math.min(progress.duration - 500, Math.round(milliseconds)));
      this.seeking = true;
      try {
        if (this.isSamsung) {
          await new Promise((resolve, reject) => this.avplay.seekTo(target, resolve, reject));
        } else {
          this.video.currentTime = target / 1000;
        }
        this.reportProgress();
        return true;
      } catch (_) {
        ++this.seekFailures;
        this.emitDiagnostics();
        this.onStatus("Não foi possível navegar neste vídeo.", true);
        return false;
      } finally {
        this.seeking = false;
        this.lastAdvanceAt = Date.now();
      }
    }

    // Recuperação MANUAL: fecha sessão anterior e reabre no mesmo ponto.
    // Não tenta 'corrigir' timestamp por conta própria nem cria loop automático.
    async recoverVod(positionMs) {
      if (!this.currentUrl || this.kind !== "vod") return false;
      const url = this.currentUrl;
      const resumeAt = Math.max(0, Number(positionMs) - 3000 || 0);
      const ok = await this.play(url, {kind:"vod", resumeAt});
      return !!ok && this.lastResumeSucceeded;
    }

    seekBy(seconds) {
      return this.seekTo(this.getProgress().current + seconds * 1000);
    }

    // O AVPlay tem um plano de vídeo nativo diferente do <video> HTML5.
    // Na Q65C, dentro do cartão de prévia (overflow/stacking context), pode
    // reproduzir áudio mas ter imagem coberta pela UI. Movemos APENAS o objeto
    // AVPlay para a raiz enquanto a prévia está ativa, com CSS e retângulo
    // nativo sincronizados. A área HTML5 e as telas VOD não são afetadas.
    position() {
      if (!this.isSamsung) return;
      try {
        const rect = this.stage.getBoundingClientRect();
        const isFullscreen = !!this.stage.closest('.fullscreen-layer');
        const object = this.avObject;
        if (object) {
          if (isFullscreen) {
            // O painel de VOD precisa permanecer acima da imagem.
            if (object.parentNode !== this.stage) {
              this.stage.insertBefore(object, this.stage.firstChild);
            }
            Object.assign(object.style, {
              position: 'absolute', left: '0px', top: '0px',
              width: '100%', height: '100%', zIndex: '1',
              pointerEvents: 'none', display: 'block', visibility: 'visible'
            });
          } else {
            // Fora de .hero/.preview-frame evita recorte e camadas opacas.
            // Usar rect em CSS pixels; AVPlay abaixo usa base 1920x1080.
            if (object.parentNode !== document.body) document.body.appendChild(object);
            Object.assign(object.style, {
              position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
              width: rect.width + 'px', height: rect.height + 'px',
              zIndex: '45', pointerEvents: 'none', display: 'block',
              visibility: (rect.bottom > 0 && rect.right > 0 &&
                rect.top < window.innerHeight && rect.left < window.innerWidth) ? 'visible' : 'hidden',
              background: 'transparent'
            });
          }
        }
        const sx = 1920 / document.documentElement.clientWidth;
        const sy = 1080 / document.documentElement.clientHeight;
        const x = Math.max(0, Math.min(1919, Math.round(rect.left * sx)));
        const y = Math.max(0, Math.min(1079, Math.round(rect.top * sy)));
        const width = Math.max(1, Math.min(1920 - x, Math.round(rect.width * sx)));
        const height = Math.max(1, Math.min(1080 - y, Math.round(rect.height * sy)));
        this.avplay.setDisplayRect(x, y, width, height);
      } catch (_) { /* AVPlay fechado ou tela em transição */ }
    }

    stopEngine() {
      this.stopWatchdog();
      this.markBufferEnd();
      this.currentUrl = null;
      this.paused = false;
      this.seeking = false;
      this.onProgress({current: 0, duration: 0});
      try {
        this.video.pause();
        this.video.removeAttribute("src");
        this.video.load();
        this.video.hidden = true;
      } catch (_) {}
      if (this.isSamsung) {
        try {
          const currentState = this.avplay.getState();
          // Liberar imediatamente o decoder e a conexão de rede, sem manter
          // uma sessão de Ao Vivo escondida na Home.
          if (currentState === "PLAYING" || currentState === "PAUSED" || currentState === "READY") {
            try { this.avplay.stop(); } catch (_) {}
          }
          if (this.avplay.getState() !== "NONE") this.avplay.close();
        } catch (_) {
          try { this.avplay.close(); } catch (_) {}
        }
        if (this.avObject) this.avObject.style.display = 'none';
      }
    }

    stop() {
      ++this.token;
      // Não esperar uma fila de prepareAsync: fechamento deve ser imediato,
      // inclusive ao sair para o Smart Hub ou ao voltar para a Home.
      if (this.pendingPrepareCancel) this.pendingPrepareCancel();
      this.stopEngine();
      return Promise.resolve(true);
    }
  }
  window.MDStreamPlayer = MDStreamPlayer;
})();
