import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {McpAgent} from "agents/mcp";
import {Octokit} from "octokit";
import {z} from "zod";
import {GitHubHandler} from "./github-handler";

type Props = {
    login: string;
    name: string;
    email: string;
    accessToken: string;
};

// AES-256-GCM helpers
// Stored format: base64(12-byte IV || ciphertext)

async function importKey(hexKey: string): Promise<CryptoKey> {
    const raw = new Uint8Array(hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return crypto.subtle.importKey("raw", raw, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]);
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, encoded));
    const combined = new Uint8Array(iv.length + ciphertext.length);
    combined.set(iv);
    combined.set(ciphertext, iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decrypt(key: CryptoKey, stored: string): Promise<string> {
    const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, ciphertext);
    return new TextDecoder().decode(plaintext);
}

export class ExocortexMCP extends McpAgent<Env, Record<string, never>, Props> {
    server = new McpServer({
        name: "Exocortex",
        version: "1.0.0",
    });

    get octokit() {
        return new Octokit({auth: this.props!.accessToken});
    }

    get repo() {
        return {
            owner: this.env.DATA_REPO_OWNER || this.props!.login,
            repo: this.env.DATA_REPO,
        };
    }

    async init() {
        const allowedUsers = new Set(this.env.ALLOWED_USERNAMES.split(",").map((s) => s.trim()));
        if (!allowedUsers.has(this.props!.login)) {
            return;
        }

        const key = await importKey(this.env.STORAGE_ENCRYPTION_KEY);

        this.server.tool(
            "get_time",
            "Get the current date and time in the user's timezone and locale",
            {},
            async () => {
                if (!this.env.USER_TIMEZONE || !this.env.USER_LOCALE) {
                    throw new Error("USER_TIMEZONE and USER_LOCALE must be configured in wrangler.jsonc vars before using this tool");
                }
                const now = new Date();
                const formatted = now.toLocaleString(this.env.USER_LOCALE, {
                    timeZone: this.env.USER_TIMEZONE,
                    dateStyle: "full",
                    timeStyle: "long",
                });
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            iso: now.toISOString(),
                            formatted,
                            timezone: this.env.USER_TIMEZONE,
                            locale: this.env.USER_LOCALE,
                        }),
                    }],
                };
            },
        );

        this.server.tool(
            "list_dir",
            "List files and directories at a path in the exocortex data repo",
            {path: z.string().describe("Directory path, e.g. 'projects' or '' for root")},
            async ({path}) => {
                const response = await this.octokit.rest.repos.getContent({
                    ...this.repo,
                    path,
                });
                const items = Array.isArray(response.data) ? response.data : [response.data];
                const text = items
                    .map((item) => `${item.type === "dir" ? "[dir]" : "[file]"} ${item.name}${item.type === "file" ? ` (sha: ${item.sha})` : ""}`)
                    .join("\n");
                return {content: [{type: "text", text}]};
            },
        );

        this.server.tool(
            "read_file",
            "Read the content of a file in the exocortex data repo",
            {path: z.string().describe("File path, e.g. 'big-picture.md' or 'projects/001/README.md'")},
            async ({path}) => {
                const response = await this.octokit.rest.repos.getContent({
                    ...this.repo,
                    path,
                });
                const data = response.data as { content: string; sha: string; encoding: string };
                const stored = atob(data.content.replace(/\n/g, ""));
                const content = await decrypt(key, stored);
                return {content: [{type: "text", text: `sha: ${data.sha}\n\n${content}`}]};
            },
        );

        this.server.tool(
            "write_file",
            "Create or update a file in the exocortex data repo. Requires sha for updates.",
            {
                path: z.string().describe("File path"),
                content: z.string().describe("Full file content"),
                sha: z.string().optional().describe("Required when updating an existing file"),
                message: z.string().optional().describe("Commit message"),
            },
            async ({path, content, sha, message}) => {
                const encrypted = await encrypt(key, content);
                await this.octokit.rest.repos.createOrUpdateFileContents({
                    ...this.repo,
                    path,
                    message: message ?? `update ${path}`,
                    content: btoa(encrypted),
                    ...(sha ? {sha} : {}),
                });
                return {content: [{type: "text", text: `Written: ${path}`}]};
            },
        );

        this.server.tool(
            "get_sha",
            "Get the SHA of a file in the exocortex data repo without reading its content",
            {path: z.string().describe("File path, e.g. 'inbox.jsonl'")},
            async ({path}) => {
                const response = await this.octokit.rest.repos.getContent({
                    ...this.repo,
                    path,
                });
                const data = response.data as { sha: string };
                return {content: [{type: "text", text: data.sha}]};
            },
        );

        this.server.tool(
            "delete_file",
            "Delete a file from the exocortex data repo",
            {
                path: z.string().describe("File path to delete"),
                sha: z.string().describe("SHA of the file to delete"),
                message: z.string().optional().describe("Commit message"),
            },
            async ({path, sha, message}) => {
                await this.octokit.rest.repos.deleteFile({
                    ...this.repo,
                    path,
                    sha,
                    message: message ?? `delete ${path}`,
                });
                return {content: [{type: "text", text: `Deleted: ${path}`}]};
            },
        );

        this.server.tool(
            "append_file",
            "Append a line to a file in the exocortex data repo (e.g. inbox.jsonl)",
            {
                path: z.string().describe("File path"),
                line: z.string().describe("Content to append as a new line"),
                message: z.string().optional().describe("Commit message"),
            },
            async ({path, line, message}) => {
                let existingContent = "";
                let sha: string | undefined;

                try {
                    const response = await this.octokit.rest.repos.getContent({
                        ...this.repo,
                        path,
                    });
                    const data = response.data as { content: string; sha: string };
                    const stored = atob(data.content.replace(/\n/g, ""));
                    existingContent = await decrypt(key, stored);
                    sha = data.sha;
                } catch (e: any) {
                    if (e.status !== 404) throw e;
                    // File doesn't exist yet, will be created
                }

                const newContent = existingContent
                    ? existingContent.trimEnd() + "\n" + line + "\n"
                    : line + "\n";

                const encrypted = await encrypt(key, newContent);
                await this.octokit.rest.repos.createOrUpdateFileContents({
                    ...this.repo,
                    path,
                    message: message ?? `append to ${path}`,
                    content: btoa(encrypted),
                    ...(sha ? {sha} : {}),
                });
                return {content: [{type: "text", text: `Appended to: ${path}`}]};
            },
        );
    }
}

export default new OAuthProvider({
    apiHandler: ExocortexMCP.serve("/mcp"),
    apiRoute: "/mcp",
    authorizeEndpoint: "/authorize",
    clientRegistrationEndpoint: "/register",
    defaultHandler: GitHubHandler as any,
    tokenEndpoint: "/token",
});
