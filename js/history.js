// MDStream - histórico de vídeo sob demanda (apenas no aparelho).
// Não armazena servidor, URL de stream, senha ou token.
(function () {
  "use strict";
  class MDStreamHistory {
    constructor(storage) {
      this.storage = storage;
      this.scope = "anonymous";
      this.maxPerKind = 25;
      this.maxAgeMs = 90 * 24 * 60 * 60 * 1000;
    }
    // Hash não criptográfico usado APENAS para separar contas sem gravar usuário/servidor.
    setAccount(server, username) {
      const input = String(server || "") + "|" + String(username || "");
      let value = 2166136261;
      for (let i = 0; i < input.length; i++) {
        value ^= input.charCodeAt(i);
        value = Math.imul(value, 16777619) >>> 0;
      }
      this.scope = value.toString(16);
    }
    get key() { return "mdstream.vod.history.v1." + this.scope; }
    clean(rows) {
      const now = Date.now();
      const filtered = (Array.isArray(rows) ? rows : []).filter(x =>
        x && (x.kind === "movies" || x.kind === "series") &&
        typeof x.id === "string" && x.id.length <= 120 &&
        Number.isFinite(x.updatedAt) && x.updatedAt <= now + 60000 &&
        now - x.updatedAt < this.maxAgeMs
      );
      filtered.sort((a,b) => b.updatedAt - a.updatedAt);
      const counts = {movies:0,series:0};
      return filtered.filter(x => ++counts[x.kind] <= this.maxPerKind);
    }
    all() {
      try {
        const raw = JSON.parse(this.storage.getItem(this.key) || "[]");
        const rows = this.clean(raw);
        // Libera entradas vencidas, inclusive se nenhum vídeo novo for reproduzido.
        if (Array.isArray(raw) && rows.length !== raw.length) {
          try { this.storage.setItem(this.key, JSON.stringify(rows)); } catch (_) {}
        }
        return rows;
      } catch (_) { return []; }
    }
    save() {
      const rows = this.clean(this.pending || []);
      this.pending = null;
      try { this.storage.setItem(this.key, JSON.stringify(rows)); return true; }
      catch (_) { return false; }
    }
    record(data, positionMs, durationMs) {
      if (!data || !["movies", "series"].includes(data.kind)) return false;
      const ms = Math.round(Number(positionMs));
      const duration = Math.round(Number(durationMs));
      if (!Number.isFinite(ms) || ms < 5000) return false;
      const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
      const current = d ? Math.min(d, ms) : ms;
      const fraction = d ? current / d : 0;
      // Final perto: marca como assistido, não oferece retomar.
      const finished = d >= 120000 && (fraction >= .95 || (fraction >= .80 && d - current <= 90000));
      const key = String(data.kind === "series" ? data.episodeId : data.id);
      if (!key || key === "undefined") return false;
      const item = {
        kind:data.kind, id:String(data.id).slice(0,120), episodeId:data.kind === "series" ? key.slice(0,120) : "",
        title:String(data.title || "Sem título").slice(0,150),
        episodeTitle:String(data.episodeTitle || "").slice(0,150),
        positionMs:current, durationMs:d, completed:finished,
        updatedAt:Date.now()
      };
      const rows = this.all().filter(x => !(x.kind === item.kind &&
        (item.kind === "movies" ? x.id === item.id : x.episodeId === item.episodeId)));
      rows.unshift(item);
      this.pending = rows;
      return this.save();
    }
    getMovie(id) { return this.all().find(x => x.kind === "movies" && x.id === String(id)) || null; }
    getEpisode(episodeId) { return this.all().find(x => x.kind === "series" && x.episodeId === String(episodeId)) || null; }
    latestSeries(seriesId) { return this.all().find(x => x.kind === "series" && x.id === String(seriesId)) || null; }
    list(kind, mode) {
      const rows = this.all().filter(x => x.kind === kind && (mode !== "continue" || (x.kind === "series" ? (x.completed || x.positionMs >= 30000) : (!x.completed && x.positionMs >= 30000))));
      if (kind !== "series") return rows;
      const seen = new Set();
      return rows.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
    }
    remove(kind, id) {
      this.pending = this.all().filter(x => !(x.kind === kind &&
        (kind === "series" ? x.episodeId === String(id) : x.id === String(id))));
      this.save();
    }
  }
  window.MDStreamHistory = MDStreamHistory;
})();
