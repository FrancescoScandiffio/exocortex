# Exocortex

No more starting over each conversation. No more generic, inadequate suggestions.
<br>**Your life is the context, exocortex gives it to AI**. Then you will work on it together.

---
Exocortex is an MCP that gives your AI **persistent context** and a list of **engagement rules** to enrich all your
conversations.
The MCP itself is simple: a set of tools to manage a GitHub repository to store **encrypted data**, so that truly no one
but you and your AI has access to the content.
<br>You can write **any kind of file**, organized however you prefer.

## The idea

I originally conceived it as a **synchronized workspace** between AI sessions: a way to enable quick transfer of
relevant information without having to copy things manually or create a dedicated GitHub project
every time.

While I was working on it, I realized what I actually wanted from it: not just a place to sync sessions, but to **give
AI a
dynamic and persisted picture of who I am**, without having to explain myself every time. Not just the projects I work
on, but also stories from my past, future goals, daily relevant events, to-do list, mental patterns and more.
Everything to **help the AI understand** who I am,
how I think, what is going on. This way, it can **help me be the person I want to be**. Or at least, help me see when
things aren't going the way I'd like, understand why, and decide what to do about it.

The entry point is `SKILL.md`: a canvas you copy into your data repository and fill with a few lines about who you are
and what you want from the system. That's all the setup you need to do. From there, the file and the entire repository
**grow through use**.

---

## How it works

Exocortex is a [Cloudflare Worker](https://developers.cloudflare.com/workers/) (free to deploy) that exposes an MCP
server over HTTP with GitHub OAuth authentication. Your data lives in a private GitHub repository, encrypted with
AES-256-GCM before being written. The encryption key lives in Cloudflare secrets, separate from the data, so even if the
repository were exposed, the content would be unreadable. Assuming a malicious user doesn't know your encryption key,
they would need both your GitHub credentials and your Worker URL to read anything.

**MCP tools:**

- `list_dir` -- list files and directories in the data repo
- `read_file` -- read decrypted content from a file
- `write_file` -- encrypt content and write to file (create or update)
- `append_file` -- append a line to a file (useful for `.jsonl` logs)
- `delete_file` -- delete a file
- `get_sha` -- get a file's SHA without reading its content
- `get_time` -- get current date and time in your timezone

## Requirements

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [GitHub account](https://github.com)
- [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- AI with MCP support (e.g. [Claude](https://claude.ai), [ChatGPT](https://chatgpt.com))
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) to deploy the worker (included as a dev
  dependency — available via `npx` after `npm install`)

## Setup

### Prerequisites

You will need a [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works) and
a [GitHub account](https://github.com).

Two values appear throughout this guide:

- **`<worker-name>`** — the name you will give your Cloudflare Worker (recommended: `exocortex`). This becomes the
  prefix of your Worker URL and is set in `wrangler.jsonc` later.
- **`<your-subdomain>`** — your workers.dev account subdomain (e.g. `myusername`). Find it in the Cloudflare dashboard →
  Workers & Pages. For more information, see
  the [official guide](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

Your Worker URL will be: `https://<worker-name>.<your-subdomain>.workers.dev`

### 1. Create the data repository

Create a private GitHub repository. This is where your AI will read and write data through the MCP.

Note the repository name, because you will set it as the `DATA_REPO` variable in step 2 (default: `exocortex-data`).

### 2. Configure the Worker

Clone this repository and install dependencies:

```bash
npm install
```

Create the KV namespace for OAuth state:

```bash
wrangler kv namespace create "EXOCORTEX_OAUTH_KV"
```

Wrangler will ask a few questions:

- **Would you like Wrangler to add it on your behalf?** → Yes — it will update `wrangler.jsonc` automatically
- **What binding name would you like to use?** → `OAUTH_KV` — this must be exactly `OAUTH_KV`, as it is hardcoded in the
  OAuth provider package
- **For local dev, do you want to connect to the remote resource?** → No

Then set your vars in `wrangler.jsonc`:

```jsonc
"name": "exocortex", // will create a cloudflare worker with this name

...

"vars": {
  "DATA_REPO": "exocortex-data",   // name of your private data repo
  "DATA_REPO_OWNER": "",           // leave empty to use the authenticated user; set to an org name if the repo is under an org
  "USER_TIMEZONE": "Europe/Rome",  // your timezone (e.g. "Europe/Rome", "America/New_York")
  "USER_LOCALE": "en-US"          // your locale for date formatting
}
```

### 3. Deploy

```bash
wrangler deploy
```

The deploy output will confirm your Worker URL. The Worker is live but will return errors until secrets are set in steps
4 and 5.
<br>Your Worker URL should be something like  `https://<worker-name>.<your-subdomain>.workers.dev`

### 4. Create a GitHub OAuth App

Go to GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App.

- **Homepage URL**: `https://<worker-name>.<your-subdomain>.workers.dev`
- **Authorization callback URL**: `https://<worker-name>.<your-subdomain>.workers.dev/callback`

> Note the `/callback` suffix on the Authorization callback URL.

Note your **Client ID** and generate a **Client secret** — you will need them in the next step.

### 5. Set secrets

```bash
wrangler secret put GITHUB_CLIENT_ID        # from step 4 — retrievable anytime from GitHub
wrangler secret put GITHUB_CLIENT_SECRET    # from step 4 — save it; can be regenerated on GitHub but invalidates existing sessions
wrangler secret put COOKIE_ENCRYPTION_KEY   # a strong random string — save it; if lost, all users must re-authenticate
wrangler secret put STORAGE_ENCRYPTION_KEY  # a strong random string — save this somewhere safe; if lost, your data is permanently unreadable
wrangler secret put ALLOWED_USERNAMES       # comma-separated GitHub usernames (e.g. john,mike — no quotes, do not end with comma)
```

For `COOKIE_ENCRYPTION_KEY` and `STORAGE_ENCRYPTION_KEY`, use any strong random string generator. Some options:

```bash
# Unix/macOS
openssl rand -hex 32

# Any platform with Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 6. Connect to your AI

The first time you connect, you will go through a GitHub OAuth flow. After that, your AI will have access to all the
tools.

- **Claude.ai** -- go to Settings → Integrations → Add integration, and paste your Worker URL with the `/mcp` path:
  `https://<worker-name>.<your-subdomain>.workers.dev/mcp`

- **ChatGPT** -- go to Settings → Connected apps → Add app, and paste the same `/mcp` URL.

- **Claude Code** -- add the following to your local MCP config:

```json
{
  "mcpServers": {
    "exocortex": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<worker-name>.<your-subdomain>.workers.dev/mcp"
      ]
    }
  }
}
```

`mcp-remote` does not need to be installed globally — `npx` downloads it on demand the first time it runs.

## Getting started

Once your AI is connected, the first thing to do is create `SKILL.md` in your data repository. This file is how your AI
understands what Exocortex is, how to use it, and how to engage with you — it's the entry point for everything else, and
it grows through use.

Two ways to create it:

- Share the contents of `template/SKILL.md` with your AI and ask it to write the file to your repository via the MCP.
- Or just describe what you want the space to be, and build it together from scratch.

Either way, your AI writes the file directly through the MCP — it lives encrypted in your data repository, alongside
everything else. This means it can evolve without redeploying the Worker, and works the same regardless of which AI
provider you use.

## Key management

`STORAGE_ENCRYPTION_KEY` is the only thing that makes your data readable.

- If you lose it locally but it's still set in Cloudflare secrets, the Worker still functions. Use the MCP to export all
  your data while you can.
- If it's gone from Cloudflare secrets too, the data is permanently unreadable.

Key rotation is not currently automated. Two manual approaches:

- **Via the MCP**: read all files through the MCP (decrypted), delete the repo content, update `STORAGE_ENCRYPTION_KEY`
  in Cloudflare secrets, then rewrite everything via the MCP with the new key.
- **Manually**: clone the repo, decrypt all files locally using the old key, re-encrypt the data with the new key, push
  back.

## Local development

Create a GitHub OAuth App with `http://localhost:8788` as the homepage URL and `http://localhost:8788/callback` as the
callback URL, then:

```bash
cp .dev.vars.example .dev.vars  # fill in your development credentials
wrangler dev
```

Connect with `http://localhost:8788/mcp` in your MCP client.

## Security

See [SECURITY.md](SECURITY.md) for the full security breakdown.

## Roadmap

The current version handles the core use case. Things that are planned but not yet implemented:

- **Semantic journal tools** -- query `journal.jsonl` by tag, date range, or text without reading the whole file
- **In-place jsonl editing** -- update or delete single entries without rewriting the entire file
- **Database storage** -- D1/SQLite as an alternative to flat `.jsonl` files, enabling queries without loading entire
  files into memory
- **Multi-user support** -- currently one MCP instance maps to one data repo with one encryption key, making it a
  personal tool by design. Supporting multiple independent users (each with their own repo and key) requires a per-user
  configuration layer.
- **Key rotation** -- rotating `STORAGE_ENCRYPTION_KEY` currently requires downloading all data via the MCP,
  re-encrypting locally with the new key, and pushing everything back. Should be automated.
