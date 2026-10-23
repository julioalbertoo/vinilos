// Ficha del artista: su foto y biografía de Discogs, tus discos suyos y su discografía,
// marcando los álbumes que ya tienes. También la lista de todos tus artistas.
// Lo que llega de Discogs se guarda en el móvil 30 días para no volver a pedirlo.
import { CONFIG } from "./config.js";
import { getArtist, getArtistAlbums, findArtistId } from "./discogs.js";
import { cachedRelease } from "./details.js";
import { el, card, tile, note, pill, plural, segmented, coverStrip } from "./charts.js";

const CACHE_KEY = CONFIG.STORAGE_KEYS.artistCache;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const ALBUMS_SHOWN = 12;

// ---------- Nombres ----------

// "Lou Reed (2)" → "Lou Reed"; "Ramones*" → "Ramones". El mismo que usa «Datos» para contar artistas.
export const cleanName = (name) => String(name || "").replace(/\s*\(\d+\)/g, "").replace(/\*/g, "").trim();

// Para buscar en Spotify: "Beatles, The" → "The Beatles".
const plainName = (name) => cleanName(name).replace(/^(.+),\s*(The|Los|Las|El|La)$/i, "$2 $1");

const key = (name) =>
  cleanName(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// "Various" no es un artista: no tiene ficha.
export const hasArtistPage = (name) => Boolean(cleanName(name)) && !/^various$/i.test(cleanName(name));

// Títulos comparables: sin tildes, sin lo que va entre paréntesis y sin signos.
const titleKey = (title) =>
  String(title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[([].*?[)\]]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const yearOf = (item) => Number.parseInt(item.originalYear || item.year, 10) || null;

// Discos de tu colección de este artista: los suyos y los que comparte con otros ("Lou Reed & John Cale").
function ownedBy(items, names) {
  const wanted = new Set(names.map(key).filter(Boolean));
  return items
    .filter((item) => {
      const full = key(item.artist);
      if (wanted.has(full)) return true;
      return full.split(/\s*(?:&|,|\/|\+|\band\b|\bfeat\.?|\bwith\b)\s*/).some((part) => wanted.has(part.trim()));
    })
    .sort((a, b) => (yearOf(a) || Infinity) - (yearOf(b) || Infinity));
}

// ---------- Memoria en el móvil ----------

function readCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return { ids: data.ids || {}, artists: data.artists || {} };
  } catch {
    return { ids: {}, artists: {} };
  }
}

const cache = readCache();

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Sin espacio: se vuelve a pedir a Discogs la próxima vez.
  }
}

const fresh = (entry) => entry && Date.now() - new Date(entry.at).getTime() < MAX_AGE;

// Foto guardada de un artista (si ya se abrió su ficha alguna vez).
function savedPhoto(name) {
  const id = cache.ids[key(name)];
  const entry = id && cache.artists[id];
  return entry && entry.artist ? entry.artist.image : "";
}

// Id de Discogs del artista: guardado, de la ficha de uno de sus discos o, si no, buscándolo por nombre.
async function resolveId(name, items, token) {
  const k = key(name);
  if (cache.ids[k]) return cache.ids[k];
  let id = null;
  for (const item of items.slice(0, 2)) {
    try {
      const release = await cachedRelease(item.release_id, token);
      const list = release.artists || [];
      // Si es un disco compartido ("Lou Reed & John Cale"), vale el primero.
      const match = list.find((a) => key(a.name) === k) || list[0];
      if (match) {
        id = match.id;
        break;
      }
    } catch {
      // Se prueba con el siguiente, o buscando por nombre.
    }
  }
  if (!id) id = await findArtistId(plainName(name), token);
  if (id) {
    cache.ids[k] = id;
    writeCache();
  }
  return id;
}

async function loadArtist(id, token) {
  const saved = cache.artists[id];
  if (fresh(saved)) return saved;
  try {
    const artist = await getArtist(id, token);
    let albums = [];
    let more = false;
    try {
      ({ albums, more } = await getArtistAlbums(id, token));
    } catch {
      // Sin discografía se enseña igual el resto.
    }
    const entry = { artist, albums, more, at: new Date().toISOString() };
    cache.artists[id] = entry;
    cache.ids[key(artist.name)] = id;
    writeCache();
    return entry;
  } catch (err) {
    if (saved) return saved; // mejor antigua que nada
    throw err;
  }
}

// ---------- Lista de tus artistas ----------

let indexSort = "count";

// Todos los artistas de tu colección. onArtist({ name }) abre la ficha de uno.
export function renderArtistIndex(container, items, { onArtist }) {
  const groups = new Map();
  for (const item of items) {
    const name = cleanName(item.artist);
    if (name) groups.set(name, [...(groups.get(name) || []), item]);
  }
  const draw = () => {
    const entries = [...groups.entries()];
    const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
    const sortKey = (name) => name.replace(/^(the|los|las|el|la)\s+/i, "");
    entries.sort((a, b) =>
      indexSort === "count"
        ? b[1].length - a[1].length || collator.compare(sortKey(a[0]), sortKey(b[0]))
        : collator.compare(sortKey(a[0]), sortKey(b[0]))
    );
    const list = el("div", "artist-list");
    for (const [name, discs] of entries) {
      const row = el("button", "artist-row");
      row.type = "button";
      const photo = savedPhoto(name);
      const cover = discs.find((d) => d.thumb || d.cover);
      const avatar = el(photo || cover ? "img" : "span", `artist-avatar${photo ? "" : " artist-avatar--cover"}`);
      if (photo || cover) {
        avatar.src = photo || cover.thumb || cover.cover;
        avatar.alt = "";
        avatar.loading = "lazy";
      } else {
        avatar.textContent = "🎤";
      }
      const text = el("span", "artist-row-text");
      const years = discs.map(yearOf).filter(Boolean);
      const span = years.length ? ` · ${Math.min(...years)}${Math.max(...years) !== Math.min(...years) ? `–${Math.max(...years)}` : ""}` : "";
      text.append(el("span", "artist-row-name", name), el("span", "artist-row-meta", `${plural(discs.length, "disco", "discos")}${span}`));
      row.append(avatar, text, el("span", "artist-row-go", "›"));
      row.addEventListener("click", () => onArtist({ name }));
      list.append(row);
    }
    const switcher = segmented([["count", "Más discos"], ["name", "A–Z"]], indexSort, (mode) => {
      indexSort = mode;
      draw();
    });
    const head = el("div", "artist-index-head");
    head.append(el("h2", null, "🎤 Tus artistas"), el("p", "artist-index-sub", `${plural(groups.size, "artista", "artistas")} · toca uno para ver su ficha`));
    container.replaceChildren(head, switcher, list);
  };
  draw();
}

// ---------- Ficha de un artista ----------

let request = 0;

// target: { name, id? }. ctx: { items, token, onOpenItem(item), onOpenAlbum(album, artistName), onArtist({ id, name }) }
export async function renderArtistPage(container, target, ctx) {
  const current = ++request;
  const stale = () => current !== request || !container.isConnected;
  let entry = target.id && fresh(cache.artists[target.id]) ? cache.artists[target.id] : null;
  let status = entry ? "" : "loading";

  const draw = () => {
    const artist = entry && entry.artist;
    const name = artist ? cleanName(artist.name) : cleanName(target.name);
    const owned = ownedBy(ctx.items, [target.name, name]);
    container.replaceChildren(...pageNodes({ artist, name, owned, entry, status, ctx }));
  };
  draw();
  if (entry) return;

  try {
    const id = target.id || (await resolveId(target.name, ownedBy(ctx.items, [target.name]), ctx.token));
    if (stale()) return;
    if (!id) {
      status = "notfound";
    } else {
      entry = await loadArtist(id, ctx.token);
      status = "";
    }
  } catch (err) {
    status = err.message || "error";
  }
  if (!stale()) draw();
}

function pageNodes({ artist, name, owned, entry, status, ctx }) {
  const nodes = [];

  // Cabecera: foto redonda, nombre y nombre real.
  const head = el("div", "artist-hero");
  if (artist && artist.image) {
    const img = el("img", "artist-photo");
    img.src = artist.image;
    img.alt = `Foto de ${name}`;
    head.append(img);
  } else {
    const cover = owned.find((d) => d.cover || d.thumb);
    if (cover) {
      const img = el("img", "artist-photo artist-photo--cover");
      img.src = cover.cover || cover.thumb;
      img.alt = "";
      head.append(img);
    } else {
      head.append(el("span", "artist-photo artist-photo--empty", "🎤"));
    }
  }
  head.append(el("h2", "artist-name", name));
  if (artist && artist.realname && key(artist.realname) !== key(name)) {
    head.append(el("p", "artist-realname", `Nombre real: ${artist.realname}`));
  }
  nodes.push(head);

  if (status === "loading") nodes.push(pill("⏳ Buscando al artista en Discogs…", "lilac"));
  else if (status === "notfound") nodes.push(pill("No encuentro a este artista en Discogs.", "peach"));
  else if (status) nodes.push(pill(`❌ No se pudo cargar de Discogs: ${status}`, "peach"));

  // Cifras: tus discos, años y cuántos álbumes tiene.
  const albums = (entry && entry.albums) || [];
  const ownedKeys = new Map();
  for (const item of owned) {
    ownedKeys.set(`id:${item.release_id}`, item);
    ownedKeys.set(`t:${titleKey(item.title)}`, item);
  }
  const ownedAlbum = (album) =>
    (album.id && ownedKeys.get(`id:${album.id}`)) || ownedKeys.get(`t:${titleKey(album.title)}`) || null;
  const haveCount = albums.filter(ownedAlbum).length;
  const years = owned.map(yearOf).filter(Boolean);
  const tiles = el("div", "stats-tiles");
  tiles.append(
    tile(String(owned.length), owned.length === 1 ? "disco tuyo" : "discos tuyos", { icon: "💿", accent: "lilac" }),
    tile(
      years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${String(Math.max(...years)).slice(2)}`) : "—",
      years.length > 1 ? "de sus años" : "año",
      { icon: "📅", accent: "sky" }
    ),
    tile(albums.length ? `${albums.length}${entry.more ? "+" : ""}` : "—", albums.length === 1 ? "álbum en Discogs" : "álbumes en Discogs", { icon: "📀", accent: "peach" })
  );
  nodes.push(tiles);

  // Enlaces: Spotify y Discogs.
  const links = el("div", "artist-links");
  const spotify = el("a", "artist-link artist-link--spotify", "🎧 Spotify");
  spotify.href = `spotify:search:${encodeURIComponent(plainName(name))}`;
  links.append(spotify);
  if (artist && artist.url) {
    const discogs = el("a", "artist-link", "Discogs ↗");
    discogs.href = artist.url;
    discogs.target = "_blank";
    discogs.rel = "noopener";
    links.append(discogs);
  }
  nodes.push(links);

  // Tus discos suyos.
  if (owned.length) {
    nodes.push(
      card(
        { icon: "💿", title: "En tu colección", sub: "Toca una portada para abrir su ficha", accent: "lilac" },
        coverStrip(owned, ctx.onOpenItem)
      )
    );
  }

  // Discografía, del primero al último, con los que ya tienes marcados.
  if (albums.length) {
    const sub = haveCount
      ? `Tienes ${haveCount} de ${plural(albums.length, "álbum", "álbumes")}${entry.more ? " (y más)" : ""}`
      : `${plural(albums.length, "álbum", "álbumes")}${entry.more ? " (y más)" : ""} · aún no tienes ninguno`;
    const list = el("div", "artist-albums");
    albums.forEach((album, index) => {
      const mine = ownedAlbum(album);
      const row = el("button", `artist-album${mine ? " is-owned" : ""}`);
      row.type = "button";
      if (index >= ALBUMS_SHOWN) row.hidden = true;
      const src = (mine && (mine.thumb || mine.cover)) || album.thumb;
      const img = el(src ? "img" : "span", "artist-album-cover");
      if (src) {
        img.src = src;
        img.alt = "";
        img.loading = "lazy";
      } else {
        img.textContent = "💿";
      }
      const text = el("span", "artist-album-text");
      text.append(el("span", "artist-album-title", album.title));
      text.append(el("span", "artist-album-year", mine ? `${album.year || ""}${album.year ? " · " : ""}💿 Lo tienes` : album.year || "Sin año"));
      row.append(img, text, el("span", "artist-row-go", "›"));
      row.disabled = !mine && !album.id;
      row.addEventListener("click", () => (mine ? ctx.onOpenItem(mine) : ctx.onOpenAlbum(album, name)));
      list.append(row);
    });
    const box = card({ icon: "📀", title: "Discografía", sub, accent: "peach" }, list);
    if (albums.length > ALBUMS_SHOWN) {
      const more = el("button", "secondary artist-more", `Ver los ${albums.length} álbumes`);
      more.type = "button";
      more.addEventListener("click", () => {
        for (const row of list.children) row.hidden = false;
        more.remove();
      });
      box.append(more);
    }
    box.append(note("Álbumes en los que es el artista principal, según Discogs. Los que no tienes se abren sin guardarse en tu colección."));
    nodes.push(box);
  }

  // Miembros del grupo, o grupos en los que ha estado.
  const people = artist ? [...artist.members.map((p) => ({ ...p, role: "member" })), ...artist.groups.map((p) => ({ ...p, role: "group" }))] : [];
  if (people.length) {
    const chips = el("div", "artist-people");
    for (const person of people) {
      const chip = el("button", `artist-person${person.active ? "" : " is-past"}`, cleanName(person.name));
      chip.type = "button";
      chip.addEventListener("click", () => ctx.onArtist({ id: person.id, name: person.name }));
      chips.append(chip);
    }
    const onlyMembers = artist.members.length && !artist.groups.length;
    const onlyGroups = artist.groups.length && !artist.members.length;
    nodes.push(
      card(
        {
          icon: onlyGroups ? "🎸" : "👥",
          title: onlyMembers ? "Miembros" : onlyGroups ? "Sus grupos" : "Miembros y grupos",
          sub: "Toca uno para ver su ficha · en gris, los que ya no están",
          accent: "mint",
        },
        chips
      )
    );
  }

  // Biografía (de Discogs, suele estar en inglés).
  if (artist && artist.profile) {
    const bio = el("p", "artist-bio", artist.profile);
    const box = card({ icon: "📖", title: "Biografía", sub: "Según Discogs", accent: "butter" }, bio);
    if (artist.profile.length > 320) {
      bio.classList.add("is-clamped");
      const toggle = el("button", "ghost artist-bio-toggle", "Leer más");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        const open = bio.classList.toggle("is-clamped");
        toggle.textContent = open ? "Leer más" : "Leer menos";
      });
      box.append(toggle);
    }
    nodes.push(box);
  }

  const wrap = el("div", "stats artist-page");
  wrap.append(...nodes);
  return [wrap];
}
