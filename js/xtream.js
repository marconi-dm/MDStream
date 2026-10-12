// MDStream - comunicação com a API Xtream e leitura alternativa M3U.
// Nunca inclua credenciais reais neste arquivo.
(function () {
  "use strict";

  class XtreamClient {
    constructor(server, username, password) {
      const address = new URL(server.trim());
      if (!/^https?:$/.test(address.protocol)) {
        throw new Error("Use um endereço HTTP ou HTTPS válido.");
      }
      if (!username || !password) {
        throw new Error("Informe usuário e senha.");
      }
      this.server = (address.origin + address.pathname).replace(/\/+$/, "");
      this.username = username.trim();
      this.password = password;
    }

    static fromM3ULink(link) {
      let url;
      try {
        url = new URL(link.trim());
      } catch (_) {
        throw new Error("Informe uma URL M3U válida.");
      }
      if (!/^https?:$/.test(url.protocol) || !/\/get\.php\/?$/i.test(url.pathname)) {
        throw new Error("O link deve ser HTTP(S) e terminar em /get.php.");
      }
      const username = url.searchParams.get("username");
      const password = url.searchParams.get("password");
      if (!username || !password) {
        throw new Error("Link sem parâmetros username e password.");
      }
      const serverPath = url.pathname.replace(/\/get\.php\/?$/i, "");
      const client = new XtreamClient(url.origin + serverPath, username, password);
      return client;
    }

    makeUrl(path, params) {
      const url = new URL(this.server + path);
      url.searchParams.set("username", this.username);
      url.searchParams.set("password", this.password);
      if (params) {
        Object.keys(params).forEach(key => url.searchParams.set(key, params[key]));
      }
      return url.toString();
    }

    async fetchWithTimeout(url, format) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("Servidor respondeu HTTP " + response.status + ".");
        }
        if (format === "text") return await response.text();
        try {
          return await response.json();
        } catch (_) {
          throw new Error("O servidor não retornou JSON Xtream válido.");
        }
      } finally {
        clearTimeout(timer);
      }
    }

    request(action) {
      const params = action ? { action: action } : null;
      return this.fetchWithTimeout(this.makeUrl("/player_api.php", params), "json");
    }

    async authenticate() {
      const account = await this.request();
      if (Number(account && account.user_info && account.user_info.auth) !== 1) {
        throw new Error("A API Xtream não autorizou a conta.");
      }
      return account;
    }

    async getLiveCatalog() {
      const responses = await Promise.all([
        this.request("get_live_categories"),
        this.request("get_live_streams")
      ]);
      if (!Array.isArray(responses[0]) || !Array.isArray(responses[1])) {
        throw new Error("A API não retornou categorias/canais em formato esperado.");
      }
      const categories = responses[0].map(cat => ({
        id: String(cat.category_id),
        name: String(cat.category_name || "Sem categoria")
      }));
      const categoryById = {};
      categories.forEach(cat => { categoryById[cat.id] = cat.name; });
      const channels = responses[1].map(item => ({
        id: String(item.stream_id),
        name: String(item.name || "Canal sem nome"),
        categoryId: String(item.category_id == null ? "outros" : item.category_id),
        group: categoryById[String(item.category_id)] || "Outros",
        image: item.stream_icon || "",
        extension: "ts"
      }));
      // Alguns provedores retornam canais com categorias ausentes da lista.
      const known = new Set(categories.map(cat => cat.id));
      channels.forEach(channel => {
        if (!known.has(channel.categoryId)) {
          known.add(channel.categoryId);
          categories.push({ id: channel.categoryId, name: channel.group });
        }
      });
      return { categories, channels, source: "Xtream Codes API" };
    }

    async getPlaylistCatalog() {
      const playlistUrl = this.makeUrl("/get.php", { type: "m3u_plus", output: "mpegts" });
      const text = await this.fetchWithTimeout(playlistUrl, "text");
      if (!text.replace(/^\uFEFF/, "").trimStart().startsWith("#EXTM3U")) {
        throw new Error("O servidor não retornou uma playlist M3U válida.");
      }
      const channels = [];
      const groupSet = new Set();
      let entry = null;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith("#EXTINF:")) {
          const match = line.match(/group-title="([^"]*)"/i);
          const comma = line.indexOf(",");
          entry = {
            name: (comma !== -1 ? line.slice(comma + 1) : "Canal sem nome").trim(),
            group: match && match[1] ? match[1] : "Outros"
          };
        } else if (entry && /^https?:\/\//i.test(line)) {
          groupSet.add(entry.group);
          channels.push({
            id: String(channels.length + 1),
            name: entry.name,
            group: entry.group,
            categoryId: entry.group,
            directUrl: line // Somente em memória; usado no AVPlay futuramente.
          });
          entry = null;
        }
      }
      if (!channels.length) throw new Error("A playlist não contém canais reconhecidos.");
      return {
        categories: Array.from(groupSet, group => ({ id: group, name: group })),
        channels,
        source: "Playlist M3U (compatibilidade)"
      };
    }

    async getMediaCatalog(section) {
      if (section !== "movies" && section !== "series") {
        throw new Error("Tipo de catálogo inválido.");
      }
      const movie = section === "movies";
      const responses = await Promise.all([
        this.request(movie ? "get_vod_categories" : "get_series_categories"),
        this.request(movie ? "get_vod_streams" : "get_series")
      ]);
      if (!Array.isArray(responses[0]) || !Array.isArray(responses[1])) {
        throw new Error("O servidor não disponibilizou este catálogo em formato compatível.");
      }
      const categories = responses[0].map(item => ({
        id: String(item.category_id),
        name: String(item.category_name || "Outros")
      }));
      const nameById = {};
      categories.forEach(cat => { nameById[cat.id] = cat.name; });
      const items = responses[1].map(item => ({
        id: String(movie ? item.stream_id : item.series_id),
        name: String(item.name || "Sem título"),
        categoryId: String(item.category_id == null ? "outros" : item.category_id),
        group: nameById[String(item.category_id)] || "Outros",
        image: String(movie ? (item.stream_icon || item.cover || "") : (item.cover || "")),
        plot: String(item.plot || ""),
        rating: item.rating == null ? "" : String(item.rating),
        extension: String(item.container_extension || "mp4").toLowerCase(),
        kind: section
      })).filter(item => item.id && item.id !== "undefined");
      const known = new Set(categories.map(cat => cat.id));
      items.forEach(item => {
        if (!known.has(item.categoryId)) {
          known.add(item.categoryId);
          categories.push({ id: item.categoryId, name: item.group });
        }
      });
      return { categories, channels: items, source: "Xtream Codes API" };
    }

    getShortEPG(streamId, limit = 8) {
      return this.requestWithParams("get_short_epg", { stream_id: String(streamId), limit: String(limit) });
    }

    getVodInfo(vodId) {
      return this.requestWithParams("get_vod_info", { vod_id: String(vodId) });
    }

    getSeriesInfo(seriesId) {
      return this.requestWithParams("get_series_info", { series_id: String(seriesId) });
    }

    requestWithParams(action, params) {
      return this.fetchWithTimeout(this.makeUrl("/player_api.php", Object.assign({ action }, params)), "json");
    }

    getVodUrl(id, extension) {
      const ext = /^[a-z0-9]{2,5}$/.test(String(extension || "")) ? extension : "mp4";
      return this.server + "/movie/" + encodeURIComponent(this.username) + "/" +
        encodeURIComponent(this.password) + "/" + encodeURIComponent(id) + "." + ext;
    }

    getEpisodeUrl(id, extension) {
      const ext = /^[a-z0-9]{2,5}$/.test(String(extension || "")) ? extension : "mp4";
      return this.server + "/series/" + encodeURIComponent(this.username) + "/" +
        encodeURIComponent(this.password) + "/" + encodeURIComponent(id) + "." + ext;
    }

    // Será utilizado na próxima etapa (AVPlay da Samsung).
    getLiveStreamUrl(streamId, extension) {
      const ext = extension === "m3u8" ? "m3u8" : "ts";
      return this.server + "/live/" + encodeURIComponent(this.username) + "/" +
        encodeURIComponent(this.password) + "/" + encodeURIComponent(streamId) + "." + ext;
    }
  }

  window.XtreamClient = XtreamClient;
})();
