// MDStream - perfis locais, independentes por dispositivo/instalação.
// IMPORTANTE: localStorage NÃO criptografa os valores; salvar senha é opt-in.
(function () {
  "use strict";
  const KEY = "mdstream.savedProfiles.v1";

  class MDStreamProfiles {
    constructor(storage) { this.storage = storage; }

    list() {
      try {
        const data = JSON.parse(this.storage.getItem(KEY) || "[]");
        if (!Array.isArray(data)) return [];
        return data.filter(p => p && typeof p.id === "string" &&
          typeof p.server === "string" && typeof p.username === "string")
          .map(p => ({
            id: p.id, name: String(p.name || "Meu acesso"),
            server: p.server, username: p.username,
            password: p.rememberPassword ? String(p.password || "") : "",
            mode: p.mode === "m3u" ? "m3u" : "xtream",
            rememberPassword: !!p.rememberPassword,
            autoConnect: !!p.autoConnect && !!p.rememberPassword && !!p.password
          }));
      } catch (_) { return []; }
    }

    upsert(data) {
      const records = this.list();
      const id = data.id || "access-" + Date.now().toString(36) + "-" +
        Math.random().toString(36).slice(2, 8);
      const remember = !!data.rememberPassword;
      const saved = {
        id, name: String(data.name || "Meu acesso").trim().slice(0, 60) || "Meu acesso",
        server: String(data.server || "").trim(),
        username: String(data.username || "").trim(),
        password: remember ? String(data.password || "") : "",
        mode: data.mode === "m3u" ? "m3u" : "xtream",
        rememberPassword: remember,
        autoConnect: remember && !!data.password && !!data.autoConnect
      };
      const index = records.findIndex(p => p.id === id);
      if (index < 0) records.push(saved);
      else records[index] = saved;
      if (saved.autoConnect) records.forEach(p => { if (p.id !== id) p.autoConnect = false; });
      this.write(records);
      return saved;
    }

    remove(id) { this.write(this.list().filter(p => p.id !== id)); }
    write(profiles) { this.storage.setItem(KEY, JSON.stringify(profiles)); }
  }

  window.MDStreamProfiles = MDStreamProfiles;
})();
