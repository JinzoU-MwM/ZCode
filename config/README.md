# Built-in Default Config

`config/default.json` is the default configuration shipped with the client and must be kept. Desktop reads it from the packaged file,
and Web imports it at build time; the built-in values are used when the remote request fails or valid fields are missing.

## Help Config Sources

The new community and feedback entry points request `GET /api/v1/client/configs` on the current endpoint
and read `data.configs.feedbackUrl`:

- `community_urls["zh-CN" | "en-US"]`: falls back to the built-in entry point only for the current language, never across languages.
- `feedback_url`: a valid remote address takes precedence; otherwise the built-in address is used.
- `feedback_use_external_form`: the remote boolean takes precedence; `false` is also a valid override.

The request carries `app_version`; Desktop additionally sends `platform-arch`, and Web omits the platform parameter.
Successful responses are cached in memory for only 1 hour, requests use `cache: no-store`, and failures are not cached.

```text
current endpoint client/configs -> valid help fields -> platform entry points
                  | missing / failed
                  v
          built-in default.json -> platform entry points
```

default.json is the built-in default configuration distributed with the client; it was historically distributed via CDN, which is retained only for compatibility with older clients.
The current version has no request or URL-construction path and relies only on the built-in file in this directory; the other fields remain unchanged for existing consumers.

See [User Community Entry Point Configuration](../docs/ui/settings-community-link-config.md) for the detailed rules.
