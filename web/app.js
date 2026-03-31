(function () {
  let appData = window.__APP_DATA__ || { listings: [], generatedAt: null };
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
    ownerDirectOnly: false,
    shortRentOnly: false,
    cookOnly: false,
    newOnly: false,
    availableNowOnly: false,
    pinnedId: null,
    hoveredId: null,
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
  let appMeta = {
    source: window.__APP_DATA__ ? "embedded" : "empty",
    storage: null,
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
                  ? listings.map((listing) => renderListingCard(listing, activeListing)).join("")
                  : '<div class="empty">No listings match the current filters.</div>'
              }
            </div>
          </section>
          ${renderPreview(activeListing)}
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
  }

  function renderToolbar(options, filteredCount) {
    return `
      <header class="toolbar">
        ${renderSelectField("area", "Area", options.areas, state.area)}
        ${renderSelectField("district", "District", options.districts, state.district, true)}
        ${renderSelectField("type", "Type", options.types, state.type, true)}
        ${renderRangeField("price", "Price", state.priceMin, state.priceMax)}
        ${renderRangeField("size", "Size", state.sizeMin, state.sizeMax)}

        <div class="toggle-row">
          ${renderToggle("ownerDirectOnly", "屋主直租", state.ownerDirectOnly)}
          ${renderToggle("shortRentOnly", "可短租", state.shortRentOnly)}
          ${renderToggle("cookOnly", "可開伙", state.cookOnly)}
          ${renderToggle("newOnly", "新上架", state.newOnly)}
          ${renderToggle("availableNowOnly", "隨時可遷入", state.availableNowOnly)}
        </div>

        <div class="toolbar__actions">
          <span class="summary">${filteredCount} / ${appData.listings.length} visible</span>
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
              <span class="import-panel__info-tooltip">Imports from live 591 into runtime storage. Fetch photos is on by default, disable it to speed up the import.</span>
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
    const options = ["all"].concat(values);
    const currentLabel = currentValue === "all" ? "All" : currentValue;
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
                    .map((value) => {
                      const optionLabel = value === "all" ? "All" : value;
                      return `
                        <button
                          class="dropdown__option ${value === currentValue ? "is-active" : ""}"
                          type="button"
                          data-dropdown-option="${key}"
                          data-value="${escapeAttribute(value)}"
                        >
                          ${escapeHtml(optionLabel)}
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

  function renderListingCard(listing, activeListing) {
    const isPinned = state.pinnedId === listing.id;
    const isActive = activeListing && activeListing.id === listing.id;
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
    const mapsUrl = listing.locationText ? buildMapsUrl(listing) : "";

    return `
      <article class="listing-card ${isActive ? "is-active" : ""} ${isPinned ? "is-pinned" : ""}" data-card-id="${listing.id}">
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
            <div class="listing-card__compact">
              <span>${escapeHtml(typeAndSize || "-")}</span>
              <span class="listing-card__divider">|</span>
              ${
                mapsUrl
                  ? `<a class="listing-card__map-link" href="${escapeAttribute(mapsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(listing.locationText)}</a>`
                  : `<span>${escapeHtml(listing.locationText || "No location")}</span>`
              }
              <span>${escapeHtml(listing.floorText || "-")}</span>
            </div>
          </div>
          <div class="listing-card__right">
            <div class="listing-card__price">${escapeHtml(listing.priceText || "")}</div>
            <div class="listing-card__deposit">${escapeHtml(depositInfo || "no info")}</div>
          </div>
        </div>
      </article>
    `;
  }

  function renderPreview(listing) {
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

    return `
      <section class="preview">
        <div class="preview__header">
          <div>
            <h2 class="preview__title">${escapeHtml(listing.title)}</h2>
          </div>
          <div>
            <p class="preview__price">${escapeHtml(listing.priceText || "")}</p>
            ${listing.sourceUrl ? `<div class="preview__meta"><a href="${escapeAttribute(listing.sourceUrl)}" target="_blank" rel="noreferrer">Open listing</a></div>` : ""}
          </div>
        </div>

        <div class="preview__body">
          <div class="hero">
            ${
              currentImage
                ? `<img src="${escapeAttribute(getImageSource(currentImage))}" alt="${escapeAttribute(listing.title)}" />`
                : `
                  <div class="hero__empty">
                    <strong>No photos available for this listing.</strong>
                    <p>Use the import panel with <code>Fetch photos</code> enabled to pull item-page galleries into the hosted dataset.</p>
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

    const resetButton = document.getElementById("reset-filters");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        state = {
          ...initialState,
          imageIndexes: state.imageIndexes,
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

      appData = payload.appData || appData;
      appMeta = {
        source: "runtime",
        storage: payload.storage || null,
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
        appData = payload.appData;
        appMeta = {
          source: payload.source || "runtime",
          storage: payload.storage || null,
        };
        render();
      }
    } catch {
      // Local file/open-in-browser fallback keeps using embedded app-data.js
    }
  }

  function getFilteredListings() {
    const filtered = appData.listings.filter((listing) => {
      if (state.area !== "all" && getAreaFilterValue(listing) !== state.area) {
        return false;
      }

      if (state.district !== "all" && getDistrictFilterValue(listing) !== state.district) {
        return false;
      }

      if (state.type !== "all" && listing.type !== state.type) {
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

      if (state.newOnly && !(listing.tags || []).includes("新上架")) {
        return false;
      }

      if (state.availableNowOnly && !(listing.tags || []).includes("隨時可遷入")) {
        return false;
      }

      return true;
    });

    if (state.sortPrice === "none" && state.sortSize === "none") {
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
    const areas = uniqueValues(listings.map((listing) => getAreaFilterValue(listing)));
    const districts = getAvailableDistrictsForArea(state.area, listings);

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
        { label: "<3k", max: "3000" },
        { label: "3k-4k", min: "3000", max: "4000" },
        { label: "4k-5k", min: "4000", max: "5000" },
        { label: "5k-6k", min: "5000", max: "6000" },
        { label: "6k-7k", min: "6000", max: "7000" },
        { label: "7k-8k", min: "7000", max: "8000" },
        { label: "8k-9k", min: "8000", max: "9000" },
        { label: "9k-10k", min: "9000", max: "10000" },
        { label: "10k-11k", min: "10000", max: "11000" },
        { label: "11k-12k", min: "11000", max: "12000" },
        { label: "12k+", min: "12000" },
      ];
    }

    return [
      { label: "<=5坪", max: "5" },
      { label: "5-8坪", min: "5", max: "8" },
      { label: "8坪+", min: "8" },
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
    const query = [listing.captureCity, listing.locationText, "台灣"].filter(Boolean).join(" ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function getAvailableDistrictsForArea(areaValue, listings = appData.listings) {
    const scopedListings =
      areaValue && areaValue !== "all"
        ? listings.filter((listing) => getAreaFilterValue(listing) === areaValue)
        : listings;

    return uniqueValues(scopedListings.map((listing) => getDistrictFilterValue(listing)));
  }

  function getAreaFilterValue(listing) {
    const explicitArea = cleanFilterPart(listing.captureArea || listing.regionName || "");
    if (explicitArea) {
      return explicitArea;
    }

    const district = getDistrictFilterValue(listing);
    const matchedSection = findMatchingSection(district);
    if (matchedSection?.regionName) {
      return matchedSection.regionName;
    }

    const cityMatch = findMatchingSection(cleanFilterPart(listing.captureCity || ""));
    if (cityMatch?.regionName) {
      return cityMatch.regionName;
    }

    return cleanFilterPart(listing.captureCity || "");
  }

  function getDistrictFilterValue(listing) {
    return cleanFilterPart(
      listing.sectionName || listing.locationGroup || extractDistrictFromLocation(listing.locationText) || listing.captureCity || "",
    );
  }

  function extractDistrictFromLocation(locationText) {
    const head = String(locationText || "").split("-")[0] || "";
    const matches = [...head.matchAll(/[\u4e00-\u9fffA-Za-z0-9]+(?:市|區|鄉|鎮)/g)].map((match) => match[0].trim());
    return matches.at(-1) || "";
  }

  function findMatchingSection(name) {
    const normalizedName = normalizePlaceName(name);
    if (!normalizedName) {
      return null;
    }

    return (taxonomy.sections || []).find((section) => normalizePlaceName(section.name) === normalizedName) || null;
  }

  function cleanFilterPart(value) {
    return String(value || "").trim();
  }

  function normalizePlaceName(value) {
    return cleanFilterPart(value).replaceAll("臺", "台");
  }

  function getImageSource(image) {
    return image?.remoteUrl || image?.src || "";
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

  document.addEventListener("click", (event) => {
    if (state.openDropdown && !event.target.closest(".dropdown, .range-filter")) {
      state.openDropdown = null;
      render();
    }
  });

  render();
  loadRemoteAppData();
})();
