# ModelScope for GitHub Copilot Chat

Use ModelScope China and ModelScope Global models in the native VS Code
Language Models picker and GitHub Copilot Chat. This extension is a
ModelScope-only adaptation of the original OpenCode Copilot Chat project.

It also shows ModelScope Magicube balance, the latest request's token usage,
and request-quota headers in the VS Code status bar. Magicube balance is read
from ModelScope's read-only balance endpoint; checking it does not sign in,
check in, or send an inference request.

## Features

- ModelScope China and Global model providers, including Agents-window
  provider variants.
- Live model discovery with cached and bundled fallbacks.
- Per-model reasoning controls where the model supports them.
- Native tool calling, streaming, image input for vision-capable models, and
  context-aware history trimming.
- Three distinct status-bar indicators:
  - **Magicubes**: available balance from the ModelScope China API.
  - **Request quota**: request limits reported in chat response headers.
  - **Tokens**: usage from the latest completed chat request.
- Manual **ModelScope: Refresh Magicube Balance** command and five-minute
  background refresh.

Request quota and Magicube balance are different values. Request-quota
information may not appear until a model responds; Magicube balance is fetched
independently when the extension activates and can be refreshed manually.

## Quick start

1. Install VS Code 1.125 or newer and GitHub Copilot Chat.
2. Package and install this extension from a VSIX, or install it from the
   Marketplace after it is published.
3. Open Copilot Chat, open the model picker, and choose **Add Models…**.
4. Add **ModelScope China** or **ModelScope Global**.
5. Open **ModelScope China: Manage** or **ModelScope Global: Manage** and
   choose **Set/Update API Key**.
6. Select a ModelScope model and start a chat.

China and Global API keys are stored independently. The Magicube balance
endpoint uses only the China key, so the balance indicator can show an
authorization or availability error when that key is not accepted by the
endpoint. Global chat remains independent of Magicube balance.

## Commands

| Command                                  | Purpose                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **ModelScope China: Manage**             | Set/update or remove the China API key, test the connection, refresh models, or open diagnostics.  |
| **ModelScope Global: Manage**            | Set/update or remove the Global API key, test the connection, refresh models, or open diagnostics. |
| **ModelScope: Refresh Models**           | Refresh both provider model lists.                                                                 |
| **ModelScope: Show Diagnostics**         | Choose a provider and inspect its models and recent requests.                                      |
| **ModelScope: Diagnose Model Picker**    | Inspect models currently visible to VS Code.                                                       |
| **ModelScope: Set Thinking Effort**      | Set a default thinking effort for a supported model family.                                        |
| **ModelScope: Refresh Magicube Balance** | Immediately request a read-only balance refresh.                                                   |

## Settings

| Setting                               | Default | Purpose                                               |
| ------------------------------------- | ------- | ----------------------------------------------------- |
| `modelscope.enabled`                  | `true`  | Enable the ModelScope providers.                      |
| `modelscope.agentsWindow`             | `true`  | Register providers for the VS Code Agents window.     |
| `modelscope.showProviderPrefix`       | `false` | Prefix model names with the provider name.            |
| `modelscope.temperature`              | `0.2`   | Sampling temperature, clamped to the supported range. |
| `modelscope.maxTokens`                | `0`     | Override output token limit; `0` uses model metadata. |
| `modelscope.maxInputTokens`           | `0`     | Override input token limit; `0` uses model metadata.  |
| `modelscope.requestTimeoutSeconds`    | `600`   | Maximum chat-request duration.                        |
| `modelscope.streamIdleTimeoutSeconds` | `120`   | Maximum wait for the next streamed event.             |
| `modelscope.stripThinkTags`           | `auto`  | Control removal of reasoning tags from output.        |
| `modelscope.thinking.*`               | varies  | Default reasoning effort by model family.             |

## Magicube balance behavior

The balance display calls only
`GET https://modelscope.cn/openapi/v1/magicubes/balance` using the saved
ModelScope API key. It reads the available, total, and frozen balances. It
does not call check-in, inference wake-up, earnings, transaction-history, or
Global balance endpoints.

If a refresh fails, the status bar shows the error; a previously successful
balance remains visible as stale rather than being replaced with zero. Use
**ModelScope: Refresh Magicube Balance** or click the balance indicator to
retry.

## Development

```powershell
npm install
npm run compile
npm test
npm run lint
```

Press **F5** in VS Code to launch the Extension Development Host. To build a
VSIX, run `npm run package`.

## License and attribution

The extension source is MIT-licensed; see [LICENSE](./LICENSE). The bundled
ModelScope icon is from the ModelScope extension by Shihao Shen and is
distributed under the MIT License; its copyright notice is retained in
[LICENSE](./LICENSE).
