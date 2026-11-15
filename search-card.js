customElements.whenDefined("card-tools").then(() => {
  const ct = customElements.get("card-tools");

  const BUILTIN_ACTIONS = [
    {
      matches: "^((magnet:.*)|(.*.torrent.*))$",
      name: "Add to Transmission",
      icon: "mdi:progress-download",
      service: "transmission.add_torrent",
      service_data: {
        torrent: "{1}",
      },
    },
  ];

  const matchAndReplace = (text, matches) => {
    let result = String(text);
    for (let i = 0; i < matches.length; i++) {
      result = result.split(`{${i}}`).join(matches[i]);
    }
    return result;
  };

  class SearchCard extends ct.LitElement {
    static get properties() {
      return {
        config: { type: Object },
        hass: { type: Object },
        _results: { type: Array },
        _activeActions: { type: Array },
        _searchValue: { type: String },
      };
    }

    constructor() {
      super();
      this._results = [];
      this._activeActions = [];
      this._searchValue = "";
      this._rowCache = new Map();
      this._searchIndex = [];
      this._indexStates = null;
      this._debouncedSearch = this._debounce((searchText) => {
        this._performSearch(searchText);
      }, 100);
    }

    shouldUpdate(changedProps) {
      if (changedProps.has("hass")) {
        this._propagateHass();
      }
      return (
        changedProps.has("config") ||
        changedProps.has("_results") ||
        changedProps.has("_activeActions") ||
        changedProps.has("_searchValue")
      );
    }

    setConfig(config) {
      if (!config) {
        throw new Error("Invalid configuration");
      }
      this.config = config;
      this.max_results = this.config.max_results || 10;
      this.search_text = this.config.search_text || "Type to search...";
      this.actions = BUILTIN_ACTIONS.concat(this.config.actions || []);
      this.included_domains = this.config.included_domains;
      this.excluded_domains = this.config.excluded_domains || [];
    }

    getCardSize() {
      return 4;
    }

    render() {
      const results = this._results.slice(0, this.max_results);
      const rows = results.map((entity_id) => this._createResultRow(entity_id));
      const actions = this._activeActions.map((x) =>
        this._createActionRow(x[0], x[1])
      );

      return ct.LitHtml`
      <ha-card>
        <div id="searchContainer">
          <div id="searchTextFieldContainer">
            <ha-input
              id="searchText"
              .value="${this._searchValue}"
              @input="${this._valueChanged}"
              no-label-float
              type="text"
              autocomplete="off"
              icon
              iconTrailing
              label="${this.search_text}"
            >
              <ha-icon icon="mdi:magnify" id="searchIcon" slot="leadingIcon"></ha-icon>
              <ha-icon-button
                slot="trailingIcon"
                @click="${this._clearInput}"
                alt="Clear"
                title="Clear"
              >
                <ha-icon icon="mdi:close"></ha-icon>
              </ha-icon-button>
            </ha-input>
          </div>

          ${
            results.length > 0
              ? ct.LitHtml`<div id="count">Showing ${results.length} of ${this._results.length} results</div>`
              : ""
          }
        </div>
        ${
          rows.length > 0 || actions.length > 0
            ? ct.LitHtml`<div id="results">${actions}${rows}</div>`
            : ""
        }
      </ha-card>
    `;
    }

    _createResultRow(entity_id) {
      let row = this._rowCache.get(entity_id);
      if (!row) {
        row = ct.createEntityRow({ entity: entity_id });
        row.addEventListener("click", () => ct.moreInfo(entity_id));
        this._rowCache.set(entity_id, row);
      }
      row.hass = this.hass;
      return row;
    }

    _createActionRow(action, matches) {
      const service_data = {};
      for (const [key, value] of Object.entries(action.service_data || {})) {
        service_data[key] = matchAndReplace(value, matches);
      }

      const elem = ct.createThing("service-row", {
        type: "call",
        name: matchAndReplace(action.name, matches),
        icon: action.icon || "mdi:lamp",
        service: action.service,
        service_data,
      });
      elem.hass = this.hass;
      return elem;
    }

    _valueChanged(ev) {
      this._searchValue = ev.target.value;
      this._debouncedSearch(this._searchValue);
    }

    _clearInput() {
      this._debouncedSearch.cancel();
      this._searchValue = "";
      this._results = [];
      this._activeActions = [];
      this._pruneRowCache();
    }

    _debounce(func, wait) {
      let timeout;
      const debounced = (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
      debounced.cancel = () => clearTimeout(timeout);
      return debounced;
    }

    _performSearch(searchText) {
      if (!this.config || !this.hass || searchText === "") {
        this._results = [];
        this._activeActions = [];
        this._pruneRowCache();
        return;
      }

      let searchRegex = null;
      try {
        searchRegex = new RegExp(searchText, "i");
      } catch {
        searchRegex = null;
      }
      const needle = searchText.toLowerCase();

      const newResults = [];
      for (const entry of this._getSearchIndex()) {
        if (!entry.allowed) continue;
        const hit = searchRegex
          ? searchRegex.test(entry.entity_id) ||
            (entry.friendly_name ? searchRegex.test(entry.friendly_name) : false)
          : entry.haystack.includes(needle);
        if (hit) newResults.push(entry.entity_id);
      }
      newResults.sort();

      this._results = newResults;
      this._activeActions = this._getActivatedActions(searchText);
      this._pruneRowCache(newResults);
    }

    _getSearchIndex() {
      const states = this.hass?.states;
      if (!states) return [];
      if (this._indexStates === states) return this._searchIndex;

      const index = [];
      for (const entity_id of Object.keys(states)) {
        const state = states[entity_id];
        const domain = entity_id.split(".")[0];
        const friendly_name = state.attributes?.friendly_name;
        index.push({
          entity_id,
          friendly_name,
          allowed: this.included_domains
            ? this.included_domains.includes(domain)
            : !this.excluded_domains.includes(domain),
          haystack: `${entity_id} ${friendly_name ?? ""}`.toLowerCase(),
        });
      }

      this._indexStates = states;
      this._searchIndex = index;
      return index;
    }

    _propagateHass() {
      if (!this._rowCache || !this.hass) return;
      for (const row of this._rowCache.values()) {
        row.hass = this.hass;
      }
    }

    _pruneRowCache(results) {
      if (!this._rowCache) return;
      if (!results) {
        this._rowCache.clear();
        return;
      }
      const keep = new Set(results);
      for (const key of this._rowCache.keys()) {
        if (!keep.has(key)) this._rowCache.delete(key);
      }
    }

    _getActivatedActions(searchText) {
      const active = [];

      for (const action of this.actions) {
        if (!this._serviceExists(action.service)) continue;
        let matches = null;
        try {
          matches = searchText.match(action.matches);
        } catch {
          continue;
        }
        if (matches != null) {
          active.push([action, matches]);
        }
      }
      return active;
    }

    _serviceExists(serviceCall) {
      const [domain, service] = serviceCall.split(".");
      const servicesForDomain = this.hass?.services?.[domain];
      return Boolean(servicesForDomain && service in servicesForDomain);
    }

    static get styles() {
      return ct.LitCSS`
      #searchContainer {
        width: 90%;
        display: block;
        margin-left: auto;
        margin-right: auto;
      }
      #searchTextFieldContainer {
        display: flex;
        padding-top: 5px;
        padding-bottom: 5px;
      }
      #searchText {
        flex-grow: 1;
      }
      #count {
        text-align: right;
        font-style: italic;
      }
      #results {
        width: 90%;
        display: block;
        padding-bottom: 15px;
        margin-top: 15px;
        margin-left: auto;
        margin-right: auto;
      }
    `;
    }
  }

  customElements.define("search-card", SearchCard);
});

setTimeout(() => {
  if (customElements.get("card-tools")) return;
  customElements.define(
    "search-card",
    class extends HTMLElement {
      setConfig() {
        throw new Error(
          "Can't find card-tools. See https://github.com/thomasloven/lovelace-card-tools"
        );
      }
    }
  );
}, 2000);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "search-card",
  name: "Search Card",
  preview: true,
  description: "Card to search entities",
});
