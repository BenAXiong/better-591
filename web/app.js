(function () {
  const APP_DATA_STORAGE_KEY = "591-viewer:app-data:v1";
  const PIN_STORAGE_KEY = "591-viewer:pinned:v1";
  const FAVORITE_STORAGE_KEY = "591-viewer:favorites:v1";
  const ARCHIVE_STORAGE_KEY = "591-viewer:archive:v1";
  const DETAIL_PREFETCH_LIMIT = 8;
  const LEAFLET_CSS_HREF = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  const LEAFLET_CSS_INTEGRITY = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
  const LEAFLET_JS_SRC = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  const LEAFLET_JS_INTEGRITY = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
  const embeddedAppData = normalizeAppData(window.__APP_DATA__);
  const storedAppData = loadStoredAppData();
  let appData = mergeAppDataSets(embeddedAppData, storedAppData);
  const taxonomy = normalizeTaxonomy(window.__TAXONOMY__);
  const root = document.getElementById("app");

  const initialState = {
    area: "all",
    district: "all",
    type: "all",
    priceMin: "",
    priceMax: "",
    sizeMin: "",
    sizeMax: "",
    sortPrice: "none",
    sortSize: "none",
    archiveFilter: "active",
    ownerDirectOnly: false,
    shortRentOnly: false,
    cookOnly: false,
    genderPolicyFilter: "all",
    newOnly: false,
    availableNowOnly: false,
    favoriteOnly: false,
    pinnedId: null,
    hoveredId: null,
    previewMode: "photos",
    openDropdown: null,
    imageIndexes: {},
    importPanelOpen: false,
    importUrl: "",
    importRegion: "",
    importKind: "",
    importSection: "",
    importAllPages: true,
    importPhotos: true,
    importPending: false,
    importMessage: "",
    importTone: "muted",
  };

  let state = { ...initialState };
  let listingListScrollTop = 0;
  let pinnedListingIds = loadPinnedListingIds();
  let favoriteListingIds = loadFavoriteListingIds();
  let archivedListingReasons = loadArchivedListingReasons();
  let leafletLoaderPromise = null;
  let previewMapToken = 0;
  const listingDetailPending = new Set();
  const listingDetailFailed = new Set();
  let appMeta = {
    source: storedAppData ? "browser-local" : window.__APP_DATA__ ? "embedded" : "empty",
    storage: storedAppData
      ? {
          mode: "browser-local",
          target: "window.localStorage",
        }
      : null,
  };

  function render() {
    const currentList = document.getElementById("listing-list");
    if (currentList) {
      listingListScrollTop = currentList.scrollTop;
    }

    const listings = getFilteredListings();
    if (state.pinnedId && !listings.some((listing) => listing.id === state.pinnedId)) {
      state.pinnedId = null;
    }

    const activeListing = getActiveListing(listings);
    const options = buildOptions(appData.listings);

    root.innerHTML = `
      <div class="shell">
        ${renderToolbar(options, listings.length)}
        <div class="content">
          <section class="sidebar">
            <div class="listing-list" id="listing-list">
              ${
                listings.length
                  ? renderListingList(listings, activeListing)
                  : '<div class="empty">No listings match the current filters.</div>'
              }
            </div>
          </section>
          ${renderPreview(activeListing, listings)}
        </div>
      </div>
    `;

    const nextList = document.getElementById("listing-list");
    if (nextList) {
      nextList.scrollTop = listingListScrollTop;
    }

    bindToolbarEvents(listings.length);
    bindCardEvents(listings);
    bindThumbnailEvents(activeListing);
    prefetchListingDetails(listings, activeListing);
    syncPreviewMap(listings, activeListing);
  }

  function renderToolbar(options, filteredCount) {
    return `
      <header class="toolbar">
        ${renderSelectField("area", "Area", options.areas, state.area)}
        ${renderSelectField("district", "District", options.districts, state.district, true)}
        ${renderSelectField("type", "Type", options.types, state.type, true)}
        ${renderRangeField("price", "Price", state.priceMin, state.priceMax)}
        ${renderRangeField("size", "Size", state.sizeMin, state.sizeMax)}
        ${renderArchiveFilterField(state.archiveFilter)}

        <div class="toggle-row">
          ${renderFavoriteToggle(state.favoriteOnly)}
          ${renderToggle("ownerDirectOnly", "屋主直租", state.ownerDirectOnly)}
          ${renderToggle("shortRentOnly", "可短租", state.shortRentOnly)}
          ${renderToggle("cookOnly", "可開伙", state.cookOnly)}
          ${renderGenderPolicyToggle(state.genderPolicyFilter)}
          ${renderToggle("newOnly", "新上架", state.newOnly)}
          ${renderToggle("availableNowOnly", "隨時可遷入", state.availableNowOnly)}
        </div>

        <div class="toolbar__actions">
          <span class="summary">${filteredCount} / ${appData.listings.length}</span>
          <button class="button" id="toggle-import-panel" type="button">${state.importPanelOpen ? "Close Import" : "Import"}</button>
          <button class="button" id="reset-filters" type="button">Reset</button>
        </div>

        ${state.importPanelOpen ? renderImportPanel() : ""}
      </header>
    `;
  }

  function renderImportPanel() {
    const importOptions = buildImportOptions();

    return `
      <div class="import-panel">
        <div class="import-panel__top">
          <div class="import-panel__builder">
            ${renderImportSelect("importRegion", "選擇縣市 Select a city/county", importOptions.regions, state.importRegion)}
            ${renderImportSelect("importSection", "選擇鄉區 Select a township/district", importOptions.sections, state.importSection)}
            ${renderImportSelect("importKind", "選擇類型 Select a type", importOptions.kinds, state.importKind)}
          </div>

          <div class="import-panel__controls">
              ${renderToggle("importAllPages", "All pages", state.importAllPages)}
              ${renderToggle("importPhotos", "Fetch photos", state.importPhotos)}
            <button class="button" id="run-import" type="button" ${state.importPending ? "disabled" : ""}>
              ${state.importPending ? "Importing..." : "Run Import"}
            </button>
            <span class="import-panel__info">
              <button class="import-panel__info-trigger" type="button" aria-label="Import info">i</button>
              <span class="import-panel__info-tooltip">Imports from live 591 stay in this browser only. Fetch photos is on by default, disable it to speed up the import.</span>
            </span>
          </div>
        </div>

        <label class="import-panel__field">
          <input
            id="import-url"
            type="url"
            inputmode="url"
            placeholder="https://rent.591.com.tw/list?region=22&kind=2&section=341"
            value="${escapeAttribute(state.importUrl)}"
          />
        </label>

        ${
          state.importMessage
            ? `<div class="import-panel__message import-panel__message--${state.importTone}">${escapeHtml(state.importMessage)}</div>`
            : ""
        }
      </div>
    `;
  }

  function renderImportSelect(key, placeholder, options, currentValue) {
    return `
      <label class="import-panel__field">
        <select data-import-select="${key}" aria-label="${escapeAttribute(placeholder)}">
          <option value="">${escapeHtml(placeholder)}</option>
          ${options
            .map(
              (option) => `
                <option value="${escapeAttribute(option.value)}" ${option.value === currentValue ? "selected" : ""}>
                  ${escapeHtml(option.label)}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function renderSelectField(key, label, values, currentValue, wide) {
    const options = [{ value: "all", label: "All" }].concat(
      values.map((value) =>
        typeof value === "string"
          ? {
              value,
              label: value,
            }
          : value,
      ),
    );
    const currentOption = options.find((option) => option.value === currentValue);
    const currentLabel = currentOption ? currentOption.label : "All";
    const isOpen = state.openDropdown === key;
    const triggerLabel = currentValue === "all" ? label : currentLabel;

    return `
      <div class="field field--dropdown ${wide ? "field--wide" : ""}">
        <div class="dropdown">
          <button
            class="dropdown__trigger ${isOpen ? "is-open" : ""}"
            type="button"
            data-dropdown-trigger="${key}"
            aria-expanded="${isOpen ? "true" : "false"}"
            aria-label="${escapeAttribute(`${label}: ${currentLabel}`)}"
          >
            <span class="dropdown__trigger-text">${escapeHtml(triggerLabel)}</span>
            <span class="dropdown__caret">▾</span>
          </button>
          ${
            isOpen
              ? `
                <div class="dropdown__menu">
                  ${options
                    .map((option) => {
                      return `
                        <button
                          class="dropdown__option ${option.value === currentValue ? "is-active" : ""}"
                          type="button"
                          data-dropdown-option="${key}"
                          data-value="${escapeAttribute(option.value)}"
                        >
                          ${escapeHtml(option.label)}
                        </button>
                      `;
                    })
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderRangeField(group, label, minValue, maxValue) {
    const isOpen = state.openDropdown === group;
    const presets = getRangePresets(group);
    const summary = formatRangeSummary(group, label, minValue, maxValue);
    const sortKey = group === "price" ? "sortPrice" : "sortSize";
    const sortState = state[sortKey];

    return `
      <div class="field field--range-filter">
        <div class="range-filter">
          <button
            class="range-filter__trigger ${isOpen ? "is-open" : ""}"
            type="button"
            data-range-trigger="${group}"
            aria-expanded="${isOpen ? "true" : "false"}"
            aria-label="${escapeAttribute(`${label}: ${summary}`)}"
          >
            <span class="dropdown__trigger-text">${escapeHtml(summary)}</span>
            <span class="dropdown__caret">▾</span>
          </button>
          ${
            isOpen
              ? `
                <div class="range-filter__menu">
                  <div class="range-filter__presets">
                    ${presets
                      .map(
                        (preset) => `
                          <button
                            class="range-filter__preset"
                            type="button"
                            data-range-preset="${group}"
                            data-min="${escapeAttribute(preset.min || "")}"
                            data-max="${escapeAttribute(preset.max || "")}"
                          >
                            ${escapeHtml(preset.label)}
                          </button>
                        `,
                      )
                      .join("")}
                  </div>
                  <div class="range-group">
                    <input data-range-input="${group}Min" type="number" inputmode="numeric" placeholder="Min" value="${escapeAttribute(minValue)}" />
                    <span class="range-filter__dash">-</span>
                    <input data-range-input="${group}Max" type="number" inputmode="numeric" placeholder="Max" value="${escapeAttribute(maxValue)}" />
                  </div>
                  <div class="range-filter__actions">
                    <button class="range-filter__action" type="button" data-range-apply="${group}">Apply</button>
                    <button class="range-filter__action range-filter__action--ghost" type="button" data-range-clear="${group}">Clear</button>
                  </div>
                </div>
              `
              : ""
          }
        </div>
        <button
          class="sort-button ${sortState !== "none" ? "is-active" : ""} sort-button--${sortState}"
          type="button"
          data-sort-toggle="${sortKey}"
          aria-label="${escapeAttribute(`${label} sort: ${sortState}`)}"
          title="${escapeAttribute(`${label} sort: ${sortState}`)}"
        >
          <span class="sort-button__icon">▲▼</span>
        </button>
      </div>
    `;
  }

  function renderArchiveFilterField(currentValue) {
    const options = getArchiveFilterOptions();
    const currentOption = options.find((option) => option.value === currentValue) || options[0];
    const isOpen = state.openDropdown === "archiveFilter";
    const triggerLabel = currentValue === "active" ? "Archived" : currentOption.label;

    return `
      <div class="field field--dropdown field--archive">
        <div class="dropdown">
          <button
            class="dropdown__trigger dropdown__trigger--archive ${isOpen ? "is-open" : ""} ${currentValue !== "active" ? "is-filtered" : ""}"
            type="button"
            data-dropdown-trigger="archiveFilter"
            aria-expanded="${isOpen ? "true" : "false"}"
            aria-label="${escapeAttribute(`Archived: ${currentOption.label}`)}"
          >
            <span class="dropdown__trigger-text">${escapeHtml(triggerLabel)}</span>
            <span class="dropdown__caret">▾</span>
          </button>
          ${
            isOpen
              ? `
                <div class="dropdown__menu dropdown__menu--archive">
                  ${options
                    .map((option) => {
                      return `
                        <button
                          class="dropdown__option ${option.value === currentValue ? "is-active" : ""}"
                          type="button"
                          data-dropdown-option="archiveFilter"
                          data-value="${escapeAttribute(option.value)}"
                        >
                          ${escapeHtml(option.label)}
                        </button>
                      `;
                    })
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderToggle(key, label, checked) {
    return `
      <button
        class="toggle-button ${checked ? "is-active" : ""}"
        type="button"
        data-toggle="${key}"
        aria-pressed="${checked ? "true" : "false"}"
      >
        ${label}
      </button>
    `;
  }

  function renderFavoriteToggle(checked) {
    return `
      <button
        class="toggle-button toggle-button--favorite ${checked ? "is-active" : ""}"
        type="button"
        data-toggle="favoriteOnly"
        aria-pressed="${checked ? "true" : "false"}"
        aria-label="${checked ? "Show only favorites" : "Filter favorites"}"
        title="${checked ? "Show only favorites" : "Filter favorites"}"
      >
        <span class="toggle-button__icon" aria-hidden="true">★</span>
      </button>
    `;
  }

  function renderGenderPolicyToggle(filter) {
    return `
      <button
        class="toggle-button ${filter !== "all" ? "is-active" : ""}"
        type="button"
        data-cycle-toggle="genderPolicyFilter"
        data-cycle-value="${escapeAttribute(filter)}"
        aria-pressed="${filter !== "all" ? "true" : "false"}"
      >
        ${getGenderPolicyFilterLabel(filter)}
      </button>
    `;
  }

  function renderListingList(listings, activeListing) {
    const dividerIndex = listings.findIndex((listing) => !isListingPinned(listing.id));

    return listings
      .map((listing, index) => {
        const divider =
          dividerIndex > 0 && index === dividerIndex
            ? '<div class="listing-list__divider" aria-hidden="true"></div>'
            : "";

        return `${divider}${renderListingCard(listing, activeListing)}`;
      })
      .join("");
  }

  function renderListingCard(listing, activeListing) {
    const isPinned = isListingPinned(listing.id);
    const isFavorite = isListingFavorite(listing.id);
    const isActive = activeListing && activeListing.id === listing.id;
    const archiveReason = getListingArchiveReason(listing.id);
    const hideMenuKey = `hide:${listing.id}`;
    const hideMenuOpen = state.openDropdown === hideMenuKey;
    const depositInfo = getDepositInfo(listing);
    const tooltipPills = [...new Set([]
      .concat((listing.cardLabels || []).filter((tag) => !["精選", "置頂"].includes(tag)))
      .concat(listing.tags || []))]
      .filter((tag) => tag && tag !== depositInfo);
    const typeAndSize = [listing.type, listing.sizePing ? `${listing.sizePing}坪` : ""].filter(Boolean).join(" ");
    const infoRowPills = [
      listing.captureDate || "undated",
      listing.locationGroup || listing.captureCity || "unknown",
      listing.contactRole || "no type",
      listing.contactName || "no name",
    ];
    const displayAddress = getListingDisplayAddress(listing);
    const mapsUrl = buildMapsUrl(listing);

    return `
      <article class="listing-card ${isActive ? "is-active" : ""} ${isPinned ? "is-pinned" : ""} ${isFavorite ? "is-favorite" : ""} ${archiveReason ? `is-archived is-archived--${archiveReason}` : ""}" data-card-id="${listing.id}">
        <div class="listing-card__layout">
          <div class="listing-card__left">
            <div class="listing-card__name-row">
              <h3 class="listing-card__name">
                ${
                  listing.sourceUrl
                    ? `<a class="listing-card__title-link" href="${escapeAttribute(listing.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(listing.title)}</a>`
                    : escapeHtml(listing.title)
                }
              </h3>
              <div class="listing-card__tools">
                <button
                  class="listing-card__pin-button ${isPinned ? "is-active" : ""}"
                  type="button"
                  data-pin-toggle="${listing.id}"
                  aria-pressed="${isPinned ? "true" : "false"}"
                  title="${isPinned ? "Pinned to top" : "Pin to top"}"
                  aria-label="${isPinned ? "Unpin listing" : "Pin listing"}"
                >
                  <span aria-hidden="true">📌</span>
                </button>
                <button
                  class="listing-card__fav-button ${isFavorite ? "is-active" : ""}"
                  type="button"
                  data-favorite-toggle="${listing.id}"
                  aria-pressed="${isFavorite ? "true" : "false"}"
                  title="${isFavorite ? "Favorite" : "Add to favorites"}"
                  aria-label="${isFavorite ? "Remove favorite" : "Favorite listing"}"
                >
                  <span aria-hidden="true">★</span>
                </button>
                <div class="listing-card__hide">
                  <button
                    class="listing-card__hide-button ${archiveReason ? "is-active" : ""}"
                    type="button"
                    data-hide-trigger="${listing.id}"
                    aria-expanded="${hideMenuOpen ? "true" : "false"}"
                    aria-label="${escapeAttribute(archiveReason ? `Hidden as ${archiveReason}` : "Hide listing")}"
                    title="${escapeAttribute(archiveReason ? `Hidden as ${archiveReason}` : "Hide listing")}"
                  >
                    <span aria-hidden="true">👁</span>
                  </button>
                  ${
                    hideMenuOpen
                      ? `
                        <div class="listing-card__hide-menu">
                          ${renderHideReasonOption(listing.id, archiveReason, "archive", "Archive")}
                          ${renderHideReasonOption(listing.id, archiveReason, "blacklist", "Blacklist")}
                          ${renderHideReasonOption(listing.id, archiveReason, "other", "Other")}
                        </div>
                      `
                      : ""
                  }
                </div>
                <div class="listing-card__info">
                  <button class="listing-card__info-trigger" type="button" aria-label="Listing info">i</button>
                  <div class="listing-card__tooltip">
                    <div class="listing-card__tooltip-row">
                      ${infoRowPills.map((pill) => `<span class="pill pill--muted">${escapeHtml(pill)}</span>`).join("")}
                    </div>
                    <div class="listing-card__tooltip-row">
                      ${tooltipPills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join("")}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="listing-card__compact">
              <span>${escapeHtml(typeAndSize || "-")}</span>
              <span class="listing-card__divider">|</span>
              ${
                mapsUrl
                  ? `<a class="listing-card__map-link" href="${escapeAttribute(mapsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(displayAddress)}</a>`
                  : `<span>${escapeHtml(displayAddress || "No location")}</span>`
              }
              <span>${escapeHtml(listing.floorText || "-")}</span>
            </div>
          </div>
          <div class="listing-card__right">
            <div class="listing-card__price">${escapeHtml(listing.priceText || "")}</div>
            <div class="listing-card__deposit">${escapeHtml(depositInfo || "no deposit info")}</div>
          </div>
        </div>
      </article>
    `;
  }

  function renderHideReasonOption(listingId, currentReason, reason, label) {
    return `
      <button
        class="listing-card__hide-option ${currentReason === reason ? "is-active" : ""}"
        type="button"
        data-hide-option="${escapeAttribute(listingId)}"
        data-reason="${escapeAttribute(reason)}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }

  function renderPreview(listing, listings) {
    if (!listing) {
      return `
        <section class="preview">
          <div class="empty">
            <h2>No listing selected</h2>
            <p>Hover a listing in the sidebar, import a live 591 URL, or broaden the current filters.</p>
          </div>
        </section>
      `;
    }

    const currentIndex = state.imageIndexes[listing.id] || 0;
    const currentImage = listing.images[currentIndex] || listing.images[0] || null;
    const previewMeta = buildPreviewMetaLine(listing);
    const mappableListings = getMappableListings(listings);
    const mappedSummary = `${mappableListings.length} / ${listings.length} mapped`;

    return `
      <section class="preview">
        <div class="preview__header">
          <div>
            <div class="preview__title-row">
              <h2 class="preview__title">${escapeHtml(listing.title)}</h2>
              ${listing.updateText ? `<span class="preview__updated">${escapeHtml(listing.updateText)}</span>` : ""}
            </div>
            ${previewMeta ? `<p class="preview__meta">${escapeHtml(previewMeta)}</p>` : ""}
          </div>
          <div class="preview__side">
            <p class="preview__price">${escapeHtml(listing.priceText || "")}</p>
            <p class="preview__deposit">${escapeHtml(getDepositInfo(listing) || "no deposit info")}</p>
            <div class="preview__mode-switch" role="tablist" aria-label="Preview mode">
              <button class="preview__mode-button ${state.previewMode === "photos" ? "is-active" : ""}" type="button" data-preview-mode="photos">Photos</button>
              <button class="preview__mode-button ${state.previewMode === "map" ? "is-active" : ""}" type="button" data-preview-mode="map">Map</button>
            </div>
            ${state.previewMode === "map" ? `<p class="preview__map-summary">${escapeHtml(mappedSummary)}</p>` : ""}
          </div>
        </div>

        ${
          state.previewMode === "map"
            ? `
              <div class="preview__body preview__body--map">
                ${
                  mappableListings.length
                    ? `
                      <div class="preview__map-wrap">
                        <div class="preview__map-status" id="preview-map-status">Loading map...</div>
                        <div class="preview__map" id="preview-map"></div>
                      </div>
                    `
                    : `
                      <div class="hero hero--map-empty">
                        <div class="hero__empty">
                          <strong>No mapped listings in the current results.</strong>
                          <p>Map mode uses exact coordinates from live 591 detail pages, so only enriched live-import listings will appear here.</p>
                        </div>
                      </div>
                    `
                }
              </div>
            `
            : `
              <div class="preview__body">
                <div class="hero">
                  ${
                    currentImage
                      ? `<img src="${escapeAttribute(getImageSource(currentImage))}" alt="${escapeAttribute(listing.title)}" />`
                      : `
                        <div class="hero__empty">
                          <strong>No photos available for this listing.</strong>
                          <p>Use the import panel with <code>Fetch photos</code> enabled to pull item-page galleries from live 591 detail pages.</p>
                        </div>
                      `
                  }
                </div>

                <div class="thumbs">
                  ${
                    listing.images.length
                      ? listing.images
                          .map(
                            (image, index) => `
                              <button class="thumbs__item ${index === currentIndex ? "is-active" : ""}" type="button" data-thumb-index="${index}" data-thumb-listing="${listing.id}">
                                <img src="${escapeAttribute(getImageSource(image))}" alt="${escapeAttribute(`${listing.title} ${index + 1}`)}" />
                              </button>
                            `,
                          )
                          .join("")
                      : ""
                  }
                </div>
              </div>
            `
        }
      </section>
    `;
  }

  function bindToolbarEvents(filteredCount) {
    root.querySelectorAll("[data-dropdown-trigger]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.dropdownTrigger;
        state.openDropdown = state.openDropdown === key ? null : key;
        render();
      });
    });

    root.querySelectorAll("[data-dropdown-option]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.dropdownOption;
        const value = event.currentTarget.dataset.value;
        state[key] = value;
        if (key === "area") {
          const districts = getAvailableDistrictsForArea(value);
          if (state.district !== "all" && !districts.includes(state.district)) {
            state.district = "all";
          }
        }
        state.openDropdown = null;
        render();
      });
    });

    root.querySelectorAll("[data-range-trigger]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.rangeTrigger;
        state.openDropdown = state.openDropdown === key ? null : key;
        render();
      });
    });

    root.querySelectorAll("[data-range-preset]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.rangePreset;
        state[`${key}Min`] = event.currentTarget.dataset.min || "";
        state[`${key}Max`] = event.currentTarget.dataset.max || "";
        state.openDropdown = null;
        render();
      });
    });

    root.querySelectorAll("[data-range-apply]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.rangeApply;
        const minInput = root.querySelector(`[data-range-input="${key}Min"]`);
        const maxInput = root.querySelector(`[data-range-input="${key}Max"]`);
        state[`${key}Min`] = minInput ? minInput.value.trim() : "";
        state[`${key}Max`] = maxInput ? maxInput.value.trim() : "";
        state.openDropdown = null;
        render();
      });
    });

    root.querySelectorAll("[data-range-clear]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.rangeClear;
        state[`${key}Min`] = "";
        state[`${key}Max`] = "";
        state.openDropdown = null;
        render();
      });
    });

    root.querySelectorAll("[data-sort-toggle]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.sortToggle;
        state[key] = getNextSortState(state[key]);
        render();
      });
    });

    root.querySelectorAll("[data-toggle]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const key = event.currentTarget.dataset.toggle;
        state[key] = !state[key];
        if (key === "importAllPages") {
          updateImportUrlFromSelections();
        }
        render();
      });
    });

    root.querySelectorAll("[data-cycle-toggle]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const key = event.currentTarget.dataset.cycleToggle;
        state[key] = getNextGenderPolicyFilter(state[key]);
        render();
      });
    });

    root.querySelectorAll("[data-preview-mode]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const mode = event.currentTarget.dataset.previewMode;
        if (!["photos", "map"].includes(mode) || state.previewMode === mode) {
          return;
        }

        state.previewMode = mode;
        render();
      });
    });

    const resetButton = document.getElementById("reset-filters");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        state = {
          ...initialState,
          imageIndexes: state.imageIndexes,
          previewMode: state.previewMode,
          importUrl: state.importUrl,
          importRegion: state.importRegion,
          importKind: state.importKind,
          importSection: state.importSection,
          importAllPages: state.importAllPages,
          importPhotos: state.importPhotos,
          importPanelOpen: state.importPanelOpen,
        };
        render();
      });
    }

    const toggleImportPanel = document.getElementById("toggle-import-panel");
    if (toggleImportPanel) {
      toggleImportPanel.addEventListener("click", () => {
        state.importPanelOpen = !state.importPanelOpen;
        state.importMessage = "";
        render();
      });
    }

    const importUrlInput = document.getElementById("import-url");
    if (importUrlInput) {
      importUrlInput.addEventListener("input", (event) => {
        state.importUrl = event.currentTarget.value;
        syncImportSelectionsFromUrl(state.importUrl);
        syncImportSelectControls();
      });
    }

    root.querySelectorAll("[data-import-select]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.importSelect;
        const value = event.currentTarget.value;
        applyImportSelection(key, value);
        render();
      });
    });

    const runImportButton = document.getElementById("run-import");
    if (runImportButton) {
      runImportButton.addEventListener("click", async () => {
        await runImport();
      });
    }
  }

  function bindCardEvents(listings) {
    const listContainer = document.getElementById("listing-list");

    root.querySelectorAll(".listing-card__map-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });

    root.querySelectorAll(".listing-card__title-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });

    root.querySelectorAll(".listing-card__info-trigger").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });

    root.querySelectorAll("[data-favorite-toggle]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavoriteListing(event.currentTarget.dataset.favoriteToggle);
        render();
      });
    });

    root.querySelectorAll("[data-hide-trigger]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const listingId = event.currentTarget.dataset.hideTrigger;
        const key = `hide:${listingId}`;
        state.openDropdown = state.openDropdown === key ? null : key;
        render();
      });
    });

    root.querySelectorAll("[data-hide-option]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const listingId = event.currentTarget.dataset.hideOption;
        const reason = event.currentTarget.dataset.reason;
        toggleListingArchiveReason(listingId, reason);
        state.openDropdown = null;
        render();
      });
    });

    root.querySelectorAll(".listing-card__hide-menu").forEach((menu) => {
      menu.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });

    root.querySelectorAll("[data-pin-toggle]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePinnedListing(event.currentTarget.dataset.pinToggle);
        render();
      });
    });

    root.querySelectorAll("[data-card-id]").forEach((card) => {
      const listingId = card.dataset.cardId;

      card.addEventListener("mouseenter", () => {
        if (state.hoveredId === listingId) {
          return;
        }

        if (listContainer) {
          listingListScrollTop = listContainer.scrollTop;
        }
        state.hoveredId = listingId;
        render();
      });

      card.addEventListener("click", () => {
        if (listContainer) {
          listingListScrollTop = listContainer.scrollTop;
        }
        state.pinnedId = state.pinnedId === listingId ? null : listingId;
        render();
      });
    });

    if (listContainer) {
      listContainer.addEventListener("scroll", () => {
        listingListScrollTop = listContainer.scrollTop;
      });

      listContainer.addEventListener("mouseleave", () => {
        if (listContainer) {
          listingListScrollTop = listContainer.scrollTop;
        }
        state.hoveredId = null;
        if (!state.pinnedId && listings[0]) {
          render();
        }
      });
    }
  }

  function bindThumbnailEvents(listing) {
    if (!listing) {
      return;
    }

    root.querySelectorAll("[data-thumb-index]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const listingId = event.currentTarget.dataset.thumbListing;
        const index = Number(event.currentTarget.dataset.thumbIndex || 0);
        state.imageIndexes = {
          ...state.imageIndexes,
          [listingId]: index,
        };
        render();
      });
    });
  }

  async function runImport() {
    if (!state.importUrl.trim()) {
      state.importMessage = "Enter a 591 list URL first.";
      state.importTone = "error";
      render();
      return;
    }

    state.importPending = true;
    state.importMessage = "Importing live 591 data...";
    state.importTone = "muted";
    render();

    try {
      const response = await fetch("/api/import-591", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          searchUrl: state.importUrl.trim(),
          importAllPages: state.importAllPages,
          includePhotos: state.importPhotos,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Import failed with HTTP ${response.status}`);
      }

      appData = mergeAppDataSets(appData, payload.importedAppData);
      saveStoredAppData(appData);
      appMeta = {
        source: "browser-local",
        storage: {
          mode: "browser-local",
          target: "window.localStorage",
        },
      };
      state.importPending = false;
      state.importMessage = `Imported ${payload.importedCount || 0} listing(s).`;
      state.importTone = "success";
      state.pinnedId = null;
      state.hoveredId = null;
      listingListScrollTop = 0;
      render();
    } catch (error) {
      state.importPending = false;
      state.importMessage = error.message || "Import failed.";
      state.importTone = "error";
      render();
    }
  }

  async function loadRemoteAppData() {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (payload?.appData) {
        appData = mergeAppDataSets(payload.appData, loadStoredAppData());
        appMeta = {
          source: hasStoredAppData() ? "browser-local" : payload.source || "local-build",
          storage: hasStoredAppData()
            ? {
                mode: "browser-local",
                target: "window.localStorage",
              }
            : payload.storage || null,
        };
        render();
      }
    } catch {
      // Local file/open-in-browser fallback keeps using embedded app-data.js
    }
  }

  function getFilteredListings() {
    const filtered = appData.listings.filter((listing) => {
      const resolvedLocation = resolveListingLocation(listing);

      if (state.area !== "all" && resolvedLocation?.regionId !== state.area) {
        return false;
      }

      if (state.district !== "all" && resolvedLocation?.sectionId !== state.district) {
        return false;
      }

      if (state.type !== "all" && listing.type !== state.type) {
        return false;
      }

      const archiveReason = getListingArchiveReason(listing.id);

      if (state.archiveFilter === "active" && archiveReason) {
        return false;
      }

      if (state.archiveFilter === "all-hidden" && !archiveReason) {
        return false;
      }

      if (["archive", "blacklist", "other"].includes(state.archiveFilter) && archiveReason !== state.archiveFilter) {
        return false;
      }

      if (state.priceMin && Number(listing.priceMonthly || 0) < Number(state.priceMin)) {
        return false;
      }

      if (state.priceMax && Number(listing.priceMonthly || 0) > Number(state.priceMax)) {
        return false;
      }

      if (state.sizeMin && Number(listing.sizePing || 0) < Number(state.sizeMin)) {
        return false;
      }

      if (state.sizeMax && Number(listing.sizePing || 0) > Number(state.sizeMax)) {
        return false;
      }

      if (state.ownerDirectOnly && !listing.isOwnerDirect) {
        return false;
      }

      if (state.shortRentOnly && !listing.isShortRent) {
        return false;
      }

      if (state.cookOnly && !listing.canCook) {
        return false;
      }

      if (state.genderPolicyFilter !== "all" && getListingGenderPolicy(listing) !== state.genderPolicyFilter) {
        return false;
      }

      if (state.newOnly && !(listing.tags || []).includes("新上架")) {
        return false;
      }

      if (state.availableNowOnly && !(listing.tags || []).includes("隨時可遷入")) {
        return false;
      }

      if (state.favoriteOnly && !isListingFavorite(listing.id)) {
        return false;
      }

      return true;
    });

    const hasPinned = filtered.some((listing) => isListingPinned(listing.id));

    if (!hasPinned && state.sortPrice === "none" && state.sortSize === "none") {
      return filtered;
    }

    return [...filtered].sort(compareListings);
  }

  function getActiveListing(listings) {
    if (state.pinnedId) {
      return listings.find((listing) => listing.id === state.pinnedId) || listings[0] || null;
    }

    if (state.hoveredId) {
      return listings.find((listing) => listing.id === state.hoveredId) || listings[0] || null;
    }

    return listings[0] || null;
  }

  function buildOptions(listings) {
    const districtIds = getAvailableDistrictsForArea(state.area);
    const areas = (taxonomy.regions || []).map((region) => ({
      value: String(region.id),
      label: region.name,
    }));
    const districts = districtIds
      .map((sectionId) => {
        const section = findSectionById(sectionId);
        if (!section) {
          return null;
        }

        return {
          value: String(section.id),
          label: state.area !== "all" ? section.name : `${section.regionName} · ${section.name}`,
        };
      })
      .filter(Boolean);

    return {
      areas,
      districts,
      types: uniqueValues(listings.map((listing) => listing.type)),
    };
  }

  function buildImportOptions() {
    const regions = (taxonomy.regions || []).map((region) => ({
      value: String(region.id),
      label: region.name,
    }));

    const kinds = [
      { value: "all", label: "全部類型 All types" },
      ...(taxonomy.kinds || []).map((kind) => ({
        value: String(kind.id),
        label: kind.name,
      })),
    ];

    const sections = (taxonomy.sections || [])
      .filter((section) => !state.importRegion || String(section.regionId) === state.importRegion)
      .map((section) => ({
        value: String(section.id),
        label: state.importRegion ? section.name : `${section.regionName} · ${section.name}`,
      }));

    return { regions, kinds, sections };
  }

  function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-Hant"));
  }

  function getDepositInfo(listing) {
    return (listing.tags || []).find((tag) => tag.startsWith("押")) || "";
  }

  function getNextSortState(current) {
    if (current === "none") {
      return "asc";
    }

    if (current === "asc") {
      return "desc";
    }

    return "none";
  }

  function compareListings(left, right) {
    const leftPinned = isListingPinned(left.id);
    const rightPinned = isListingPinned(right.id);

    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }

    const priceSort = compareBySortState(left.priceMonthly, right.priceMonthly, state.sortPrice);
    if (priceSort !== 0) {
      return priceSort;
    }

    const sizeSort = compareBySortState(left.sizePing, right.sizePing, state.sortSize);
    if (sizeSort !== 0) {
      return sizeSort;
    }

    return 0;
  }

  function compareBySortState(leftValue, rightValue, sortState) {
    if (sortState === "none") {
      return 0;
    }

    const leftMissing = !Number.isFinite(leftValue);
    const rightMissing = !Number.isFinite(rightValue);

    if (leftMissing && rightMissing) {
      return 0;
    }

    if (leftMissing) {
      return 1;
    }

    if (rightMissing) {
      return -1;
    }

    const left = leftValue;
    const right = rightValue;
    return sortState === "asc" ? left - right : right - left;
  }

  function getRangePresets(group) {
    if (group === "price") {
      return [
        { label: "<5k", max: "5000" },
        { label: "<6k", max: "6000" },
        { label: "<7k", max: "7000" },
        { label: "<8k", max: "8000" },
        { label: "<9k", max: "9000" },
        { label: "<10k", max: "10000" },
        { label: "<12k", max: "12000" },
        { label: "<14k", max: "14000" },
        { label: "<16k", max: "16000" },
        { label: "<18k", max: "18000" },
        { label: "<20k", max: "20000" },
        { label: "20k+", min: "20000" },
      ];
    }

    return [
      { label: "<5坪", max: "5" },
      { label: ">8坪", min: "8" },
      { label: ">10坪", min: "10" },
      { label: ">12坪", min: "12" },
      { label: ">15坪", min: "15" },
      { label: ">20坪", min: "20" },
      { label: ">30坪", min: "30" },
      { label: ">40坪", min: "40" },
      { label: ">50坪", min: "50" },
      { label: ">100坪", min: "100" },
    ];
  }

  function formatRangeSummary(group, label, minValue, maxValue) {
    if (!minValue && !maxValue) {
      return label;
    }

    const formatter = group === "price" ? formatPriceShort : formatSizeShort;
    if (minValue && maxValue) {
      return `${formatter(minValue)}-${formatter(maxValue)}`;
    }

    if (minValue) {
      return `>=${formatter(minValue)}`;
    }

    return `<=${formatter(maxValue)}`;
  }

  function formatPriceShort(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return String(value);
    }

    if (numeric >= 1000) {
      return `${numeric / 1000}k`;
    }

    return String(numeric);
  }

  function formatSizeShort(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return `${value}坪`;
    }

    return `${numeric}坪`;
  }

  function buildMapsUrl(listing) {
    const query = getListingMapQuery(listing);
    return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : "";
  }

  function getListingDisplayAddress(listing) {
    return String(listing?.exactAddress || listing?.locationText || "").trim();
  }

  function getListingMapQuery(listing) {
    const exactAddress = String(listing?.exactAddress || "").trim();
    if (exactAddress) {
      return exactAddress;
    }

    const approximateAddress = String(listing?.locationText || "").trim();
    if (approximateAddress) {
      return [listing.captureCity, approximateAddress].filter(Boolean).join(" ");
    }

    const latitude = Number(listing?.latitude);
    const longitude = Number(listing?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `${latitude},${longitude}`;
    }

    return "";
  }

  function getAvailableDistrictsForArea(areaValue, listings = appData.listings) {
    return (taxonomy.sections || [])
      .filter((section) => areaValue === "all" || String(section.regionId) === String(areaValue))
      .map((section) => String(section.id));
  }

  function extractDistrictFromLocation(locationText) {
    const head = String(locationText || "").split("-")[0] || "";
    const matches = [...head.matchAll(/[\u4e00-\u9fffA-Za-z0-9]+(?:市|區|鄉|鎮)/g)].map((match) => match[0].trim());
    return matches.at(-1) || "";
  }

  function findMatchingSection(name, regionNameHint = "") {
    const normalizedName = normalizePlaceName(name);
    if (!normalizedName) {
      return null;
    }

    const matches = (taxonomy.sections || []).filter((section) => normalizePlaceName(section.name) === normalizedName);
    if (matches.length <= 1) {
      return matches[0] || null;
    }

    const normalizedRegionHint = normalizePlaceName(regionNameHint);
    if (normalizedRegionHint) {
      const hinted = matches.find((section) => normalizePlaceName(section.regionName) === normalizedRegionHint);
      if (hinted) {
        return hinted;
      }
    }

    return matches[0] || null;
  }

  function cleanFilterPart(value) {
    return String(value || "").trim();
  }

  function normalizePlaceName(value) {
    return cleanFilterPart(value).replaceAll("臺", "台");
  }

  function resolveListingLocation(listing) {
    const explicitSectionId = String(listing.sectionId || "").trim();
    if (explicitSectionId) {
      const section = findSectionById(explicitSectionId);
      if (section) {
        return {
          regionId: String(section.regionId),
          regionName: section.regionName,
          sectionId: String(section.id),
          sectionName: section.name,
        };
      }
    }

    const regionHint = cleanFilterPart(listing.captureArea || listing.regionName || "");
    const districtName =
      cleanFilterPart(listing.sectionName || listing.locationGroup || extractDistrictFromLocation(listing.locationText) || "") ||
      cleanFilterPart(listing.captureCity || "");
    const section = findMatchingSection(districtName, regionHint);

    if (section) {
      return {
        regionId: String(section.regionId),
        regionName: section.regionName,
        sectionId: String(section.id),
        sectionName: section.name,
      };
    }

    const region = findMatchingRegion(regionHint || listing.captureCity || "");
    if (region) {
      return {
        regionId: String(region.id),
        regionName: region.name,
        sectionId: "",
        sectionName: districtName,
      };
    }

    return null;
  }

  function findMatchingRegion(name) {
    const normalizedName = normalizePlaceName(name);
    if (!normalizedName) {
      return null;
    }

    return (taxonomy.regions || []).find((region) => normalizePlaceName(region.name) === normalizedName) || null;
  }

  function findRegionById(regionId) {
    return (taxonomy.regions || []).find((region) => String(region.id) === String(regionId)) || null;
  }

  function findSectionById(sectionId) {
    return (taxonomy.sections || []).find((section) => String(section.id) === String(sectionId)) || null;
  }

  function getImageSource(image) {
    return image?.remoteUrl || image?.src || "";
  }

  function normalizeAppData(raw) {
    const listings = Array.isArray(raw?.listings) ? raw.listings : [];
    return {
      generatedAt: raw?.generatedAt || null,
      listingCount: listings.length,
      rawFileCount: Number(raw?.rawFileCount || 0) || 0,
      importMeta: raw?.importMeta || null,
      listings,
    };
  }

  function loadStoredAppData() {
    try {
      const raw = window.localStorage.getItem(APP_DATA_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      return normalizeAppData(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function hasStoredAppData() {
    return Boolean(loadStoredAppData());
  }

  function saveStoredAppData(nextAppData) {
    try {
      window.localStorage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify(normalizeAppData(nextAppData)));
    } catch {
      // Ignore storage quota failures and keep the in-memory state for the current tab.
    }
  }

  function mergeAppDataSets(baseAppData, overrideAppData) {
    const base = normalizeAppData(baseAppData);
    const override = normalizeAppData(overrideAppData);

    if (override.listings.length === 0) {
      return base;
    }

    const latestByPropertyKey = new Map();

    base.listings.forEach((listing) => {
      latestByPropertyKey.set(getDuplicateSignature(listing) || listing.propertyKey || listing.id, listing);
    });

    override.listings.forEach((listing) => {
      const key = getDuplicateSignature(listing) || listing.propertyKey || listing.id;
      const existing = latestByPropertyKey.get(key);
      if (!existing) {
        latestByPropertyKey.set(key, listing);
        return;
      }

      latestByPropertyKey.set(key, mergeListingSnapshots(listing, existing));
    });

    const mergedListings = [...latestByPropertyKey.values()];
    return {
      generatedAt: override.generatedAt || base.generatedAt || null,
      listingCount: mergedListings.length,
      rawFileCount: Math.max(base.rawFileCount || 0, override.rawFileCount || 0),
      importMeta: override.importMeta || base.importMeta || null,
      listings: mergedListings,
    };
  }

  function mergeListingSnapshots(primary, fallback) {
    const primaryImages = Array.isArray(primary?.images) ? primary.images : [];
    const fallbackImages = Array.isArray(fallback?.images) ? fallback.images : [];
    const images = primaryImages.length > 0 ? primaryImages : fallbackImages;

    return {
      ...fallback,
      ...primary,
      sourceUrl: primary?.sourceUrl || fallback?.sourceUrl || null,
      listingId: primary?.listingId || fallback?.listingId || null,
      exactAddress: primary?.exactAddress || fallback?.exactAddress || "",
      latitude: primary?.latitude ?? fallback?.latitude ?? null,
      longitude: primary?.longitude ?? fallback?.longitude ?? null,
      facilities: Array.isArray(primary?.facilities) && primary.facilities.length > 0
        ? primary.facilities
        : Array.isArray(fallback?.facilities)
          ? fallback.facilities
          : [],
      serviceNotes: Array.isArray(primary?.serviceNotes) && primary.serviceNotes.length > 0
        ? primary.serviceNotes
        : Array.isArray(fallback?.serviceNotes)
          ? fallback.serviceNotes
          : [],
      genderPolicy: primary?.genderPolicy
        ?? fallback?.genderPolicy
        ?? mapLegacyGenderPolicy(primary?.allGendersAllowed)
        ?? mapLegacyGenderPolicy(fallback?.allGendersAllowed)
        ?? detectGenderPolicy(primary?.serviceNotes, primary?.ownerRemark)
        ?? detectGenderPolicy(fallback?.serviceNotes, fallback?.ownerRemark)
        ?? "unknown",
      ownerRemark: primary?.ownerRemark || fallback?.ownerRemark || "",
      contactPhone: primary?.contactPhone || fallback?.contactPhone || "",
      detailFetchedAt: primary?.detailFetchedAt || fallback?.detailFetchedAt || null,
      images,
      hasPhotos: images.length > 0,
      photoCount: images.length,
      lastPhotoFetchAt: primary?.lastPhotoFetchAt || fallback?.lastPhotoFetchAt || null,
    };
  }

  function getDuplicateSignature(listing) {
    const address = normalizeDuplicatePart(listing?.exactAddress || listing?.locationText);
    const price = normalizeDuplicatePart(listing?.priceMonthly);
    const type = normalizeDuplicatePart(listing?.type);
    const size = normalizeDuplicatePart(listing?.sizePing);
    const floor = normalizeDuplicatePart(listing?.floorText);
    const contact = normalizeDuplicatePart(listing?.contactPhone || [listing?.contactRole, listing?.contactName].filter(Boolean).join(" "));

    if (!address || !price || !type || !size || !floor || !contact) {
      return "";
    }

    return [address, type, size, floor, price, contact].join(" | ");
  }

  function normalizeDuplicatePart(value) {
    return String(value || "").trim().replace(/\s+/g, "").replaceAll("臺", "台");
  }

  function loadPinnedListingIds() {
    try {
      const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
    } catch {
      return [];
    }
  }

  function savePinnedListingIds() {
    try {
      window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedListingIds));
    } catch {
      // Ignore storage failures and keep the session state only.
    }
  }

  function isListingPinned(listingId) {
    return pinnedListingIds.includes(String(listingId));
  }

  function loadFavoriteListingIds() {
    try {
      const raw = window.localStorage.getItem(FAVORITE_STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
    } catch {
      return [];
    }
  }

  function saveFavoriteListingIds() {
    try {
      window.localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(favoriteListingIds));
    } catch {
      // Ignore storage failures and keep the session state only.
    }
  }

  function isListingFavorite(listingId) {
    return favoriteListingIds.includes(String(listingId));
  }

  function toggleFavoriteListing(listingId) {
    const normalizedId = String(listingId || "").trim();
    if (!normalizedId) {
      return;
    }

    favoriteListingIds = isListingFavorite(normalizedId)
      ? favoriteListingIds.filter((value) => value !== normalizedId)
      : [...favoriteListingIds, normalizedId];

    saveFavoriteListingIds();
  }

  function loadArchivedListingReasons() {
    try {
      const raw = window.localStorage.getItem(ARCHIVE_STORAGE_KEY);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveArchivedListingReasons() {
    try {
      window.localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archivedListingReasons));
    } catch {
      // Ignore storage failures and keep the session state only.
    }
  }

  function getListingArchiveReason(listingId) {
    const reason = archivedListingReasons[String(listingId || "").trim()];
    return ["archive", "blacklist", "other"].includes(reason) ? reason : "";
  }

  function toggleListingArchiveReason(listingId, reason) {
    const normalizedId = String(listingId || "").trim();
    if (!normalizedId || !["archive", "blacklist", "other"].includes(reason)) {
      return;
    }

    const nextReasons = { ...archivedListingReasons };
    if (nextReasons[normalizedId] === reason) {
      delete nextReasons[normalizedId];
    } else {
      nextReasons[normalizedId] = reason;
    }

    archivedListingReasons = nextReasons;
    saveArchivedListingReasons();
  }

  function togglePinnedListing(listingId) {
    const normalizedId = String(listingId || "").trim();
    if (!normalizedId) {
      return;
    }

    pinnedListingIds = isListingPinned(normalizedId)
      ? pinnedListingIds.filter((value) => value !== normalizedId)
      : [...pinnedListingIds, normalizedId];

    savePinnedListingIds();
  }

  function buildPreviewMetaLine(listing) {
    const spec = [listing.type, listing.sizePing ? `${listing.sizePing}坪` : "", listing.floorText]
      .filter(Boolean)
      .join(" ");
    const distance = getValidListingDistanceText(listing);
    const owner = formatPreviewOwner(listing);

    return [spec, distance, owner].filter(Boolean).join(" · ");
  }

  function formatPreviewOwner(listing) {
    const name = String(listing.contactName || "").trim();
    const role = formatContactRoleShort(listing.contactRole);
    const phone = String(listing.contactPhone || listing.phone || "").trim();

    if (!name && !phone) {
      return "";
    }

    const head = [name, role ? `(${role})` : ""].filter(Boolean).join(" ");
    return [head, phone].filter(Boolean).join(" ");
  }

  function formatContactRoleShort(role) {
    if (role === "屋主") {
      return "主";
    }

    if (role === "代理人" || role === "仲介" || role === "經紀人") {
      return "代";
    }

    return "";
  }

  function getValidListingDistanceText(listing) {
    const direct = sanitizeDistanceText(listing?.distanceText);
    if (direct) {
      return direct;
    }

    const nearbyLabel = String(listing?.nearbyLabel || "").trim().replace(/^距/, "");
    const distanceMeters = Number(listing?.distanceMeters);
    if (nearbyLabel && Number.isFinite(distanceMeters) && distanceMeters > 0) {
      return `距${nearbyLabel} ${distanceMeters}公尺`;
    }

    return "";
  }

  function sanitizeDistanceText(value) {
    const compact = String(value || "").replace(/\s+/g, " ").trim();
    if (!compact) {
      return "";
    }

    const match = compact.match(/^距\s*(.+?)\s*([0-9][0-9,]*(?:\.\d+)?)\s*(公尺|公里)$/);
    if (!match) {
      return "";
    }

    return `距${match[1].trim()} ${match[2]}${match[3]}`;
  }

  function prefetchListingDetails(listings, activeListing) {
    const nextCandidate = [activeListing, ...listings]
      .filter(Boolean)
      .filter((listing, index, array) => array.findIndex((candidate) => candidate.id === listing.id) === index)
      .filter((listing) => needsListingDetail(listing))
      .slice(0, DETAIL_PREFETCH_LIMIT)[0];

    if (nextCandidate) {
      void ensureListingDetail(nextCandidate);
    }
  }

  function needsListingDetail(listing) {
    if (!listing || !listing.sourceUrl) {
      return false;
    }

    if (listing.detailFetchedAt || listingDetailFailed.has(listing.id)) {
      return false;
    }

    return !(
      String(listing.exactAddress || "").trim() &&
      (Array.isArray(listing.facilities) ? listing.facilities.length > 0 : false) &&
      String(listing.ownerRemark || "").trim() &&
      String(listing.contactPhone || "").trim()
    );
  }

  async function ensureListingDetail(listing) {
    if (!listing || !listing.id || !listing.sourceUrl || !needsListingDetail(listing)) {
      return;
    }

    if (listingDetailPending.has(listing.id)) {
      return;
    }

    listingDetailPending.add(listing.id);

    try {
      const response = await fetch("/api/listing-detail", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          appListingId: listing.id,
          sourceUrl: listing.sourceUrl,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      mergeListingDetailIntoAppData(listing.id, payload);
      saveStoredAppData(appData);
      render();
    } catch {
      listingDetailFailed.add(listing.id);
      // Ignore transient detail fetch failures and keep the current listing snapshot.
    } finally {
      listingDetailPending.delete(listing.id);
    }
  }

  function mergeListingDetailIntoAppData(appListingId, detail) {
    appData = {
      ...appData,
      listings: appData.listings.map((listing) => {
        if (String(listing.id) !== String(appListingId)) {
          return listing;
        }

        return {
          ...listing,
          exactAddress: detail.exactAddress || listing.exactAddress || "",
          latitude: detail.latitude ?? listing.latitude ?? null,
          longitude: detail.longitude ?? listing.longitude ?? null,
          facilities: Array.isArray(detail.facilities) ? detail.facilities : listing.facilities || [],
          serviceNotes: Array.isArray(detail.serviceNotes) ? detail.serviceNotes : listing.serviceNotes || [],
          genderPolicy: detail.genderPolicy
            ?? detectGenderPolicy(detail.serviceNotes, detail.ownerRemark)
            ?? listing.genderPolicy
            ?? mapLegacyGenderPolicy(listing.allGendersAllowed)
            ?? detectGenderPolicy(listing.serviceNotes, listing.ownerRemark)
            ?? "unknown",
          ownerRemark: detail.ownerRemark || listing.ownerRemark || "",
          contactPhone: detail.contactPhone || listing.contactPhone || "",
          detailFetchedAt: detail.detailFetchedAt || listing.detailFetchedAt || new Date().toISOString(),
        };
      }),
    };
  }

  function normalizeTaxonomy(raw) {
    if (!raw || typeof raw !== "object") {
      return { regions: [], kinds: [], sections: [] };
    }

    return {
      regions: Array.isArray(raw.regions) ? [...raw.regions] : [],
      kinds: Array.isArray(raw.kinds) ? [...raw.kinds] : [],
      sections: Array.isArray(raw.sections) ? [...raw.sections] : [],
    };
  }

  function getListingGenderPolicy(listing) {
    return listing?.genderPolicy
      ?? mapLegacyGenderPolicy(listing?.allGendersAllowed)
      ?? detectGenderPolicy(listing?.serviceNotes, listing?.ownerRemark)
      ?? "unknown";
  }

  function detectGenderPolicy(serviceNotes, ownerRemark) {
    const normalizedNotes = Array.isArray(serviceNotes) ? serviceNotes : [];
    const rulesText = normalizedNotes
      .filter((note) => /房屋守則|租住說明/.test(String(note?.label || "")))
      .map((note) => [note?.label, note?.value].filter(Boolean).join(" "))
      .join(" ");
    const fallbackText = String(ownerRemark || "").trim();

    return parseGenderPolicy(rulesText || fallbackText || normalizedNotes.map((note) => [note?.label, note?.value].filter(Boolean).join(" ")).join(" "));
  }

  function parseGenderPolicy(text) {
    const haystack = String(text || "").replace(/\s+/g, " ").trim();
    if (!haystack) {
      return null;
    }

    if (/男女皆可|不限性別|性別不限/.test(haystack)) {
      return "any";
    }

    if (/限(?:女|女生|女性)|(?:僅|只)限(?:女|女生|女性)/.test(haystack)) {
      return "female-only";
    }

    if (/限(?:男|男生|男性)|(?:僅|只)限(?:男|男生|男性)/.test(haystack)) {
      return "male-only";
    }

    return "unknown";
  }

  function mapLegacyGenderPolicy(allGendersAllowed) {
    return allGendersAllowed === true ? "any" : null;
  }

  function getNextGenderPolicyFilter(current) {
    const order = ["all", "any", "female-only", "male-only"];
    const index = order.indexOf(current);
    return order[(index + 1 + order.length) % order.length];
  }

  function getGenderPolicyFilterLabel(filter) {
    if (filter === "any") {
      return "男女皆可";
    }

    if (filter === "female-only") {
      return "限女生";
    }

    if (filter === "male-only") {
      return "限男生";
    }

    return "性別";
  }

  function getArchiveFilterOptions() {
    return [
      { value: "active", label: "Active" },
      { value: "all-hidden", label: "All" },
      { value: "archive", label: "Archive" },
      { value: "blacklist", label: "Blacklist" },
      { value: "other", label: "Other" },
    ];
  }

  function applyImportSelection(key, value) {
    state[key] = value;

    if (key === "importSection" && value) {
      const section = (taxonomy.sections || []).find((entry) => String(entry.id) === value);
      if (section) {
        state.importRegion = String(section.regionId);
      }
    }

    if (key === "importRegion" && state.importSection) {
      const currentSection = (taxonomy.sections || []).find((entry) => String(entry.id) === state.importSection);
      if (!currentSection || String(currentSection.regionId) !== state.importRegion) {
        state.importSection = "";
      }
    }

    updateImportUrlFromSelections();
  }

  function updateImportUrlFromSelections() {
    const current = parseImportUrl(state.importUrl);
    const page = current?.page || "";
    const params = new URLSearchParams();

    if (state.importRegion) {
      params.set("region", state.importRegion);
    }

    if (state.importKind) {
      if (state.importKind !== "all") {
        params.set("kind", state.importKind);
      }
    }

    if (state.importSection) {
      params.set("section", state.importSection);
    }

    if (!state.importAllPages && page && page !== "1") {
      params.set("page", page);
    }
    state.importUrl = `https://rent.591.com.tw/list?${params.toString()}`;
  }

  function syncImportSelectionsFromUrl(url) {
    const parsed = parseImportUrl(url);
    if (!parsed) {
      return;
    }

    state.importRegion = parsed.region;
    state.importKind = parsed.kind;
    state.importSection = parsed.section;

    if (state.importSection) {
      const section = (taxonomy.sections || []).find((entry) => String(entry.id) === state.importSection);
      if (section) {
        state.importRegion = String(section.regionId);
      }
    }
  }

  function syncImportSelectControls() {
    root.querySelectorAll("[data-import-select]").forEach((element) => {
      const key = element.dataset.importSelect;
      if (key && Object.prototype.hasOwnProperty.call(state, key)) {
        element.value = state[key];
      }
    });
  }

  function parseImportUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== "https://rent.591.com.tw" || parsed.pathname !== "/list") {
        return null;
      }

      return {
        region: parsed.searchParams.get("region") || "",
        kind: parsed.searchParams.get("kind") || "",
        section: parsed.searchParams.get("section") || "",
        page: parsed.searchParams.get("page") || "1",
      };
    } catch {
      return null;
    }
  }

  function formatGeneratedAt(value) {
    if (!value) {
      return "No timestamp";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "No timestamp";
    }

    return date.toLocaleString("zh-TW", {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("'", "&#39;");
  }

  function getMappableListings(listings) {
    return (Array.isArray(listings) ? listings : []).filter((listing) => isFiniteCoordinate(listing?.latitude) && isFiniteCoordinate(listing?.longitude));
  }

  function isFiniteCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric);
  }

  function syncPreviewMap(listings, activeListing) {
    previewMapToken += 1;
    const token = previewMapToken;

    if (state.previewMode !== "map") {
      return;
    }

    const container = document.getElementById("preview-map");
    const status = document.getElementById("preview-map-status");
    const mappableListings = getMappableListings(listings);

    if (!container) {
      return;
    }

    if (!mappableListings.length) {
      if (status) {
        status.textContent = "No coordinates available for the current results.";
      }
      return;
    }

    void ensureLeafletLoaded()
      .then(() => {
        if (token !== previewMapToken || !document.body.contains(container)) {
          return;
        }

        renderLeafletMap(container, status, mappableListings, activeListing);
      })
      .catch(() => {
        if (token !== previewMapToken || !status) {
          return;
        }

        status.textContent = "Map failed to load.";
      });
  }

  function renderLeafletMap(container, status, listings, activeListing) {
    container.innerHTML = "";

    const map = window.L.map(container, {
      zoomControl: true,
      attributionControl: true,
    });

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const bounds = [];
    let activeMarker = null;

    listings.forEach((listing) => {
      const lat = Number(listing.latitude);
      const lng = Number(listing.longitude);
      const isActive = activeListing && listing.id === activeListing.id;
      const marker = window.L.circleMarker([lat, lng], getMapMarkerStyle(listing, isActive))
        .addTo(map)
        .bindPopup(buildMapPopupHtml(listing));

      marker.on("click", () => {
        state.pinnedId = listing.id;
        state.hoveredId = null;
        render();
      });

      if (isActive) {
        activeMarker = marker;
      }

      bounds.push([lat, lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else {
      map.fitBounds(bounds, {
        padding: [28, 28],
      });
    }

    if (activeMarker) {
      activeMarker.openPopup();
    }

    requestAnimationFrame(() => {
      map.invalidateSize();
      if (status) {
        status.textContent = "";
      }
    });
  }

  function getMapMarkerStyle(listing, isActive) {
    const archiveReason = getListingArchiveReason(listing.id);

    if (isActive) {
      return {
        radius: 9,
        color: "#8c5528",
        fillColor: "#c98546",
        weight: 3,
        fillOpacity: 0.95,
      };
    }

    if (isListingFavorite(listing.id)) {
      return {
        radius: 8,
        color: "#b17a1f",
        fillColor: "#f0c15e",
        weight: 2,
        fillOpacity: 0.9,
      };
    }

    if (archiveReason === "blacklist") {
      return {
        radius: 8,
        color: "#9b4033",
        fillColor: "#cf766b",
        weight: 2,
        fillOpacity: 0.88,
      };
    }

    if (isListingPinned(listing.id)) {
      return {
        radius: 8,
        color: "#9d5c2f",
        fillColor: "#e1a463",
        weight: 2,
        fillOpacity: 0.9,
      };
    }

    return {
      radius: 7,
      color: "#7d7368",
      fillColor: "#b2aaa0",
      weight: 2,
      fillOpacity: 0.82,
    };
  }

  function buildMapPopupHtml(listing) {
    const address = getListingDisplayAddress(listing);
    const details = [listing.type, listing.sizePing ? `${listing.sizePing}坪` : "", listing.floorText].filter(Boolean).join(" ");

    return `
      <div class="map-popup">
        <strong>${escapeHtml(listing.title)}</strong>
        ${listing.priceText ? `<div>${escapeHtml(listing.priceText)}</div>` : ""}
        ${details ? `<div>${escapeHtml(details)}</div>` : ""}
        ${address ? `<div>${escapeHtml(address)}</div>` : ""}
      </div>
    `;
  }

  function ensureLeafletLoaded() {
    if (window.L) {
      return Promise.resolve(window.L);
    }

    if (!leafletLoaderPromise) {
      leafletLoaderPromise = new Promise((resolve, reject) => {
        ensureLeafletStylesheet();

        const existingScript = document.querySelector("script[data-leaflet-loader='true']");
        if (existingScript) {
          existingScript.addEventListener("load", () => resolve(window.L), { once: true });
          existingScript.addEventListener("error", () => reject(new Error("Leaflet failed to load.")), { once: true });
          return;
        }

        const script = document.createElement("script");
        script.src = LEAFLET_JS_SRC;
        script.integrity = LEAFLET_JS_INTEGRITY;
        script.crossOrigin = "";
        script.defer = true;
        script.dataset.leafletLoader = "true";
        script.onload = () => resolve(window.L);
        script.onerror = () => reject(new Error("Leaflet failed to load."));
        document.head.appendChild(script);
      });
    }

    return leafletLoaderPromise;
  }

  function ensureLeafletStylesheet() {
    if (document.querySelector("link[data-leaflet-style='true']")) {
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS_HREF;
    link.integrity = LEAFLET_CSS_INTEGRITY;
    link.crossOrigin = "";
    link.dataset.leafletStyle = "true";
    document.head.appendChild(link);
  }

  document.addEventListener("click", (event) => {
    if (state.openDropdown && !event.target.closest(".dropdown, .range-filter, .listing-card__hide")) {
      state.openDropdown = null;
      render();
    }
  });

  render();
  loadRemoteAppData();
})();
