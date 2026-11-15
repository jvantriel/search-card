## v0.2

- Optimized for current Home Assistant versions
- Entity rows are cached and updated in place instead of being recreated on every render
- Visible result rows receive live `hass` updates without re-rendering the whole card
- Search index (entity id + friendly name, domain filter) is built once per `hass.states` change
- Results are sorted before `max_results` is applied
- Invalid regex input falls back to plain-text search instead of clearing all results
- Action `service_data` is no longer mutated while substituting matches
- Action regexes are precompiled once in `setConfig`; invalid ones are skipped with a warning
- Available services are resolved once per search instead of once per action
- Search index is invalidated when the configuration changes (e.g. domain filters)
- Pending debounced search is cancelled when the input is cleared
- Modernized syntax (const/let, arrow functions, optional chaining, for-of)

## v0.1

- Initial version
