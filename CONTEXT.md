# ZCode Plugin Store

Domain glossary for the plugin settings page and its marketplace browsing/installation experience. This file is the single definition of store-related terminology, for use by pages, services, and documentation.

## Language

### Marketplaces and Sources

**Official Marketplace**:
The sole distribution channel operated by ZCode itself; its marketplace id is `zcode-plugins-official`, and its contents = builtin plugins + CDN plugins. It is a "distribution channel", not an "authorship attribution" — it can include plugins by community authors.
_Avoid_: using "official" loosely for any trusted marketplace

**Builtin Plugin**:
A plugin shipped with the application bundle and seeded into the Official Marketplace at startup. A subset of official plugins.
_Avoid_: pre-installed plugin, bundled plugin (fine in conversation; documentation consistently uses "builtin")

**CDN Plugin**:
A plugin in the Official Marketplace distributed through the official CDN as a sha256-verified zip package, downloaded and installed on demand.
_Avoid_: network plugin, online plugin

**Personal Source**:
Any plugin source added by the user themselves: git/GitHub/URL/local-directory marketplaces, inline plugins.
_Avoid_: none

**Catalog Auto-Refresh**:
A throttled background refresh of the Official Marketplace catalog when entering the store page, invisible to the user; covers only the Official Marketplace.
_Avoid_: conflating it with Manual Refresh; calling it "check for updates" (the update badge is merely a by-product of the refresh)

**Manual Refresh**:
A refresh of all marketplaces triggered by the refresh button in the store page's top bar, not subject to the auto-refresh throttle.
_Avoid_: refresh, check for updates (fine in conversation; documentation consistently uses "manual refresh")

### Store Page Structure

**Public Segment**:
One of the segments of the store list page; shows the Official Marketplace catalog and nothing else (Featured + category sections).
_Avoid_: official tab, store tab

**Personal Segment**:
The other segment of the store list page; shows the catalogs of all Personal Sources, grouped by marketplace.
_Avoid_: third-party tab, my tab

**Featured**:
The curated area at the top of the Public Segment; its list is remotely controlled by the `featured` field of the official CDN catalog. Exists only in the Public Segment.
_Avoid_: conflating it with Recommended

**Installed Strip**:
A row of installed plugin icons at the top of the list page; clicking an icon opens the detail page.
_Avoid_: installed list (that belongs to the Manage Installed view)

**Manage Installed View**:
The management interface entered via the gear to the right of the Installed Strip; hosts plugin-level enable/disable toggles, updates, uninstall, and filtering by enabled state.
_Avoid_: Installed tab (old IA term, deprecated)

### Metadata

**Store Listing**:
Presentational metadata carried by a catalog entry: display name, icon, category, developer, website/privacy policy/terms of service links, hero image, example prompts. Describes "how it is presented in the store" and does not affect plugin functionality.
_Avoid_: plugin metadata (ambiguous; may refer to the manifest)

**Plugin Manifest**:
The functional definition in the plugin package's `plugin.json` (commands/agents/skills/hooks/mcpServers/userConfig…). Describes "what the plugin is and what it does".
_Avoid_: marketplace.json (that is the catalog, not the manifest)

**Example Prompt**:
A clickable prompt provided by the Store Listing; clicking it creates a new session and pre-fills the prompt (not sent automatically). It is the only "new session" entry point on the detail page.
_Avoid_: quick command, prompt template, try it now

### Lifecycle States

**Plugin Lifecycle**:
The complete product path from the user discovering a plugin, through viewing, installing, configuring, enabling/disabling, using, checking for updates, upgrading, and persistence recovery, until uninstalling or restoring a builtin plugin. Every stage must verify both the visible UI state and the corresponding persisted or runtime result.
_Avoid_: treating "installed successfully" alone as the complete lifecycle

**Restorable Builtin**:
A Builtin Plugin that the user has uninstalled and that has entered a persisted suppressed state. An app restart must not automatically re-seed it; it continues to appear in the Public Segment and is cleanly restored through the "Install" entry point.
_Avoid_: uninstalled CDN plugin, temporarily disabled builtin plugin

**Orphaned Installed Plugin**:
A plugin whose corresponding Personal Source has been removed while its install directory and user data remain. It can still be used, configured, enabled/disabled, and uninstalled; it cannot be updated until the source is re-added, and re-adding the same source restores the catalog association.
_Avoid_: broken install, missing manifest, uninstalled plugin
