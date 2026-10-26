/* ============================================================
   黑城残响 · 图标系统
   统一线条风格 SVG (stroke 1.6, round caps), 由 data-icon 水合
   ============================================================ */
(function () {
  "use strict";

  const P = {
    seal: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9 9.5l1.2-2.4 2.6 4.4 1.9-3.1 2.3 4.1"/><path d="M6.5 16.5c1.6-1.2 3-1.8 5.5-1.8s3.9.6 5.5 1.8"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
    sunset: '<path d="M4 17h16"/><path d="M6.5 13.5a5.5 5.5 0 0 1 11 0"/><path d="M12 3.5V6"/><path d="M5 6l1.5 1.5"/><path d="M19 6l-1.5 1.5"/><path d="M2.5 20.5h19"/>',
    "map-pin": '<path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10z"/><circle cx="12" cy="10.8" r="2.2"/>',
    "cloud-fog": '<path d="M7 17a4.5 4.5 0 0 1-.5-8.97 5.5 5.5 0 0 1 10.7 1.2A3.8 3.8 0 0 1 17.5 17"/><path d="M5 20.5h14"/><path d="M8 23h8"/>',
    "book-open": '<path d="M12 6.5C10.5 5 8.4 4.2 3.5 4.2v13.6c4.9 0 7 .8 8.5 2.3 1.5-1.5 3.6-2.3 8.5-2.3V4.2c-4.9 0-7 .8-8.5 2.3z"/><path d="M12 6.5v13.6"/>',
    "folder-open": '<path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v1.5"/><path d="M3 9.5l1.7 8a2 2 0 0 0 2 1.6h10.6a2 2 0 0 0 2-1.6l1.7-8z"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 3.5v5h5"/><path d="M12 8v4.2l2.8 1.8"/>',
    list: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M16 3v3a2 2 0 0 0 2 2h3"/><path d="M8 21v-3a2 2 0 0 0-2-2H3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    heart: '<path d="M12 20.5S4 15.2 4 9.6A4.6 4.6 0 0 1 12 6.8a4.6 4.6 0 0 1 8 2.8c0 5.6-8 10.9-8 10.9z"/>',
    wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h7"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
    map: '<path d="M9 4.5L3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8z"/><path d="M9 4.5v12.7"/><path d="M15 6.8v12.7"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.8-3.2 2.9-5 5.5-5s4.7 1.8 5.5 5"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8"/><path d="M17.5 14.7c1.7.7 2.7 2.3 3 4.8"/>',
    shield: '<path d="M12 3l7.5 2.6v5.2c0 4.6-3 8-7.5 9.7-4.5-1.7-7.5-5.1-7.5-9.7V5.6z"/><path d="M9.5 11.5l1.9 1.9 3.6-3.8"/>',
    zap: '<path d="M13 2.5L4.5 13.5H11l-1 8L18.5 10H12z"/>',
    sparkles: '<path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4-4.4-1.6 4.4-1.6z"/><path d="M18.5 14.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/><path d="M5.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2"/>',
    hexagon: '<path d="M12 2.8l8.2 4.7v9.4L12 21.7l-8.2-4.8V7.5z"/><path d="M12 8.5v7"/><path d="M8.8 10.2l6.4 3.6"/><path d="M15.2 10.2l-6.4 3.6"/>',
    flag: '<path d="M5.5 21V4.5"/><path d="M5.5 5.5C7 4 9.5 4 11 5.5s4 1.5 5.5 0v7c-1.5 1.5-4 1.5-5.5 0s-4-1.5-5.5 0"/>',
    backpack: '<path d="M5 8.5A3.5 3.5 0 0 1 8.5 5h7A3.5 3.5 0 0 1 19 8.5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 5V4a3 3 0 0 1 6 0v1"/><path d="M5 13h14"/><path d="M10 9.5h4"/>',
    send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.4-5.9"/><path d="M20.5 3.5V6h-2.5"/>',
    edit: '<path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17z"/><path d="M13.5 7l3 3"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3.5L22 20H2z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.7" fill="currentColor" stroke="none"/>',
    "check-circle": '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6.5 7l1 12a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9l1-12"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    gem: '<path d="M7 4.5h10l4 6-9 9.5-9-9.5z"/><path d="M3.5 10.5h17"/><path d="M12 4.5l-3 6 3 9.5 3-9.5z"/>',
    hammer: '<path d="M14.5 5.5l4 4"/><path d="M5 19l-1.5-1.5L13 8l3 3z"/><path d="M17.5 8l2.5-2.5a1.8 1.8 0 0 0-2.5-2.5L15 5.5z"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="0.8" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="0.8" fill="currentColor" stroke="none"/>',
    brain: '<path d="M9.5 4.5a2.8 2.8 0 0 0-3.4 3.6 2.8 2.8 0 0 0-.6 5.3A2.9 2.9 0 0 0 9 18.7V7.5a2 2 0 0 1 .5-3z"/><path d="M14.5 4.5a2.8 2.8 0 0 1 3.4 3.6 2.8 2.8 0 0 1 .6 5.3 2.9 2.9 0 0 1-2.5 5.3V7.5a2 2 0 0 0-.5-3z"/><path d="M9 18.5h6"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/>',
    skull: '<path d="M12 3.5a7.5 7.5 0 0 0-4.5 13.5c.9.7 1.5 1.6 1.5 2.7V21h6v-1.3c0-1.1.6-2 1.5-2.7A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9.2" cy="10.5" r="1.3"/><circle cx="14.8" cy="10.5" r="1.3"/><path d="M9.5 17.5h5"/>',
    sword: '<path d="M3.5 20.5L14 10"/><path d="M14.5 5.5l4 4"/><path d="M12 4.5l7.5 7.5-2.5 2.5-7.5-7.5z"/><path d="M9 8L4.5 3.5"/>',
    gauntlet: '<path d="M7 15.5V8a2 2 0 0 1 2-2h.5"/><path d="M9.5 6V4.5a1.5 1.5 0 0 1 3 0V6"/><path d="M12.5 6V4.5a1.5 1.5 0 0 1 3 0V7"/><path d="M15.5 7.5V6a1.5 1.5 0 0 1 3 0v7.5"/><path d="M7 15.5H5a1.5 1.5 0 0 0-1.5 1.5V19A1.5 1.5 0 0 0 5 20.5h11a3 3 0 0 0 3-3v-2"/><path d="M7 20.5v-2"/>',
    boots: '<path d="M5 20.5V10a2 2 0 0 1 2-2h2v-2.5a1.5 1.5 0 0 1 3 0V8h4a2 2 0 0 1 2 2v10.5z"/><path d="M5 20.5h14"/><path d="M7 20.5h10"/>',
    necklace: '<path d="M12 4.5a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z"/><path d="M12 8.5c-2.5 2-4 4.6-4 8a4 4 0 0 0 8 0c0-3.4-1.5-6-4-8z"/>',
    ring: '<circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V5"/><path d="M12 19v1.5"/><path d="M3.5 12H5"/><path d="M19 12h1.5"/>',
    amulet: '<path d="M12 3.5l6.5 3.2v5.1c0 4.2-2.6 7.3-6.5 8.9-3.9-1.6-6.5-4.7-6.5-8.9V6.7z"/><circle cx="12" cy="11.5" r="2.4"/><path d="M12 9.1V6.8"/>',
    helmet: '<path d="M4 15.5a8 8 0 0 1 16 0"/><path d="M3.5 15.5h17a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 18v-1a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M10 15.5V13a2 2 0 0 1 4 0v2.5"/>',
    scale: '<path d="M12 4.5V20"/><path d="M5 8.5h14"/><path d="M5 8.5L2.5 13a3 3 0 0 0 5 0z"/><path d="M19 8.5L16.5 13a3 3 0 0 0 5 0z"/><path d="M12 20h-4"/><path d="M12 20h4"/>',
    crown: '<path d="M3.5 17.5L2 6.5l5 4L12 3.5l5 7 5-4-1.5 11z"/><path d="M3.5 20.5h17"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9"/><path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 3.3 6 1.4 6 4.4 0 1.4-1.3 2.3-3 2.3-1.4 0-2.6-.6-3.2-1.6"/>',
    flame: '<path d="M12 3.5c2.5 3 5 5.4 5 9a5 5 0 0 1-10 0c0-1.6.6-3 1.5-4.2.3 1 .9 1.7 1.7 2.2-.1-2.6.3-4.6 1.8-7z"/>',
    droplet: '<path d="M12 3.5c3.5 4.2 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 2.5-6.3 6-10.5z"/>',
    pulse: '<path d="M3 12h4l2.5-6.5L14 18l2.5-6H21"/>',
    save: '<path d="M5 3.5h11L20 7.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3z"/><path d="M8 3.5V8h7V3.5"/><path d="M8 20.5V14h8v6.5"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5c1-4 3.6-6 7-6s6 2 7 6"/>',
    radio: '<circle cx="12" cy="12" r="2.2"/><path d="M8.6 8.6a5 5 0 0 0 0 6.8"/><path d="M15.4 8.6a5 5 0 0 1 0 6.8"/><path d="M5.8 5.8a9 9 0 0 0 0 12.4"/><path d="M18.2 5.8a9 9 0 0 1 0 12.4"/>',
    "arrow-up": '<path d="M12 19V5.5"/><path d="M6 11.5l6-6 6 6"/>',
    "arrow-right": '<path d="M5 12h13.5"/><path d="M12.5 6l6 6-6 6"/>',
    "arrow-down": '<path d="M12 5v13.5"/><path d="M6 12.5l6 6 6-6"/>',
    "arrow-left": '<path d="M19 12H5.5"/><path d="M11.5 6l-6 6 6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
    crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3"/><path d="M12 18.5v3"/><path d="M2.5 12h3"/><path d="M18.5 12h3"/>',
    key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8L20 3"/><path d="M16.5 6.5l3 3"/>',
    scroll: '<path d="M6.5 4.5A2.5 2.5 0 0 1 9 2h9v16.5H9a2.5 2.5 0 0 0-2.5 2.5z"/><path d="M6.5 4.5A2.5 2.5 0 0 0 4 7v12.5h11"/><path d="M8.5 6.5h5"/>',
    "sword-cross": '<path d="M6 18L18 6"/><path d="M8 4l12 12-4 4-12-12z"/><path d="M4 8l12 12"/>',
    bug: '<path d="M12 3.5V7"/><path d="M12 7l-3.5-2"/><path d="M12 7l3.5-2"/><path d="M5 9h3.5"/><path d="M19 9h-3.5"/><path d="M5 15h3.5"/><path d="M19 15h-3.5"/><path d="M8.5 9c0 3.5 1.5 6 3.5 8.5 2-2.5 3.5-5 3.5-8.5"/><circle cx="12" cy="20" r="0.5"/>',
    "chart-bar": '<path d="M4 20.5V4"/><path d="M4 20.5h16"/><path d="M8.5 17v-6"/><path d="M13 17V7.5"/><path d="M17.5 17v-9"/>',
    gift: '<rect x="4" y="8" width="16" height="12" rx="1.5"/><path d="M4 12.5h16"/><path d="M12 8v12"/><path d="M12 8c-2.5 0-4-1-4-2.5S9.5 3 12 4.5C14.5 3 16 4 16 5.5S14.5 8 12 8z"/>'
  };

  const SIZES = { small: 13, med: 15, lg: 18, xl: 22 };

  function icon(name, size) {
    const p = P[name] || P.info;
    const px = typeof size === "number" ? size : (SIZES[size] || 15);
    return '<svg class="icon" viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }

  function hydrate(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(function (el) {
      const n = el.getAttribute("data-icon");
      el.innerHTML = icon(n);
      el.classList.add("has-icon");
    });
  }

  window.ICON = icon;
  window.ICON_HYDRATE = hydrate;
  window.ICON_NAMES = P;
})();
