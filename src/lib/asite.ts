import { XMLParser, XMLValidator } from "fast-xml-parser";
import { isE1FolderName, isExplicitNonShopFile } from "./folder-rules";
import type { AsiteAuthType, AsiteFile, AsiteRegion, Folder, Project } from "./asite-types";

export type { AsiteAuthType, AsiteFile, AsiteRegion, Folder, Project } from "./asite-types";

/**
 * Asite's certified UAE connector, published by Asite Solutions Limited:
 * https://github.com/microsoft/PowerPlatformConnectors/tree/master/certified-connectors/Asite%20(UAE)
 * apiDefinition.swagger.json documents these read operations. apiProperties.json
 * identifies cloudUrl as the project-specific host used by folder operations.
 */
export const ASITE_UAE = {
  apiBaseUrl: "https://integrationuae.asite.com/api",
  sessionBaseUrl: "https://dmsuae.asite.com",
  authorizationUrl: "https://oauthuae.asite.com/oauth/authorize",
  tokenUrl: "https://oauthuae.asite.com/oauth/token",
} as const;

const API_HOST = "integrationuae.asite.com";
const SESSION_HOST = "dmsuae.asite.com";
const MAX_FOLDERS = 2_000;
const MAX_FOLDER_REQUESTS = 500;
const MAX_FOLDER_DEPTH = 40;
const MAX_REGISTER_BYTES = 25 * 1024 * 1024;

export type AsiteDiagnostic = {
  operation: "login" | "projects" | "folders" | "documents" | "download" | "api";
  format: "json" | "xml" | "html" | "text";
  httpStatus: number;
  contentType: string;
  rootKeys: Record<string, string>;
  dataKeys: Record<string, string>;
  envelopeState?: "empty" | "text";
};
const diagnostics = new WeakMap<object, AsiteDiagnostic>();

export class AsiteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly diagnostic?: AsiteDiagnostic,
  ) {
    super(message);
    this.name = "AsiteError";
  }
}

function validateSession(token: string, region: AsiteRegion, authType: AsiteAuthType = "session"): void {
  if (region !== "uae") {
    throw new AsiteError("This connection supports the Asite UAE region.", "UNSUPPORTED_REGION");
  }
  if (authType !== "session" && authType !== "oauth") {
    throw new AsiteError("Select an Asite session or OAuth connection.", "INVALID_AUTH_TYPE");
  }
  if (typeof token !== "string" || !token.trim() || token.length > 16_384 || /\s|[\x00-\x1f\x7f;,"\\]/.test(token)) {
    throw new AsiteError("A valid Asite session token is required.", "INVALID_SESSION");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const keyName = (name: string) => name.split(":").at(-1)!.replace(/_/g, "").toLowerCase();
function property(object: Record<string, unknown>, name: string): unknown {
  const matches = Object.keys(object).filter(key => keyName(key) === keyName(name));
  if (matches.length > 1) throw new AsiteError("Asite returned ambiguous response fields.", "INVALID_RESPONSE", 502, diagnostics.get(object));
  return matches.length ? object[matches[0]] : undefined;
}

/** Fixed schema names and types only: upstream values and unknown key names never leave the server. */
function shape(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const known = ["asiteDataList", "UserProfile", "AsiteAPIExceptionThrown", "workspaceVO", "folderVO", "documentVO", "URI", "errorCode", "errorMessage", "errorDescription", "ERROR_MESSAGE", "ERROR_DESCRIPTION", "Sessionid"];
  const result: Record<string, string> = {};
  for (const name of known) {
    const keys = Object.keys(value).filter(key => keyName(key) === keyName(name));
    if (!keys.length) continue;
    const item = value[keys[0]];
    result[name] = keys.length > 1 ? "ambiguous" : item === null ? "null" : Array.isArray(item) ? "array" : typeof item;
  }
  return result;
}

function operationFor(url: URL): AsiteDiagnostic["operation"] {
  if (url.pathname.includes("/apilogin")) return "login";
  if (url.pathname.endsWith("/folders")) return "folders";
  if (url.pathname.endsWith("/workspacelist") || url.pathname.endsWith("/workspaceList")) return "projects";
  if (url.pathname.includes("doclist")) return "documents";
  if (url.pathname.includes("download")) return "download";
  return "api";
}

function upstreamError(payload: Record<string, unknown>, diagnostic: AsiteDiagnostic): void {
  const exception = property(payload, "AsiteAPIExceptionThrown");
  const data = property(payload, "asiteDataList");
  const source = isObject(exception) ? exception : isObject(data) ? data : payload;
  const code = property(source, "errorCode");
  const message = property(source, "errorMessage") ?? property(source, "ERROR_MESSAGE");
  const description = property(source, "errorDescription") ?? property(source, "ERROR_DESCRIPTION");
  const hasFailure = exception !== undefined || (code !== undefined ? ![0, 200, "0", "200"].includes(code as string | number) : (typeof message === "string" && Boolean(message.trim())) || (typeof description === "string" && Boolean(description.trim())));
  if (!hasFailure) return;
  // Read text solely to classify a known condition. Do not return or log its contents.
  const classification = [code, message, description].filter(value => typeof value === "string").join(" ");
  if (/session|not\s+logged|login\s+required|unauthori[sz]ed/i.test(classification) && diagnostic.operation !== "login") {
    throw new AsiteError("Your Asite session is expired or unavailable. Reconnect with a current host-session key.", "SESSION_EXPIRED", 401, diagnostic);
  }
  if (diagnostic.operation === "login") {
    throw new AsiteError("Asite did not accept the API sign-in. Check your credentials and API access; if your account uses SSO or MFA, use a current host-session key.", "LOGIN_FAILED", 401, diagnostic);
  }
  if (/permission|access\s+denied|not\s+authori[sz]ed|forbidden/i.test(classification)) {
    throw new AsiteError("Asite denied access to this resource. Check the account's project and API permissions.", "ACCESS_DENIED", 403, diagnostic);
  }
  throw new AsiteError("Asite returned an API error. The extraction is incomplete; reconnect or check project API access.", "UPSTREAM_API_ERROR", 502, diagnostic);
}

function field(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 8_192 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new AsiteError(`Asite returned an invalid ${label}.`, "INVALID_RESPONSE");
  }
  return value;
}

function requireUaeUrl(value: string, label: string, authType: AsiteAuthType = "oauth"): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AsiteError(`${label} must be an Asite UAE HTTPS URL.`, "UNSAFE_URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== (authType === "session" ? SESSION_HOST : API_HOST) ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    /[\x00-\x20\x7f\\]/.test(value)
  ) {
    throw new AsiteError(`${label} must use the approved Asite UAE host.`, "UNSAFE_URL");
  }
  return url;
}

function projectApiBase(projectId: string): URL {
  const url = requireUaeUrl(field(projectId, "project URL"), "Project URL");
  // The connector's dynamic-host policy uses cloudUrl. Preserve its path and
  // query (which may identify the workspace), while keeping the token host fixed.
  const segments = url.pathname.split("/").filter(Boolean);
  if (!segments.includes("api")) {
    throw new AsiteError("Asite returned a project URL without its API path.", "UNVERIFIED_PROJECT_URL");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function endpoint(base: URL | string, path: string, query: Record<string, string>, authType: AsiteAuthType = "oauth"): URL {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path}`;
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  requireUaeUrl(url.toString(), "API request", authType);
  return url;
}

async function request(token: string, url: URL, authType: AsiteAuthType = "oauth", init?: RequestInit): Promise<Response> {
  requireUaeUrl(url.toString(), "API request", authType);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      ...init,
      headers: {
        Accept: "application/json",
        ...(token ? authType === "session" ? { Cookie: `ASessionID=${token}` } : { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AsiteError("Asite could not be reached. Try connecting again.", "UPSTREAM_UNAVAILABLE");
  }
  if (response.status >= 300 && response.status < 400) {
    if (operationFor(url) === "login") throw new AsiteError("Asite redirected the API sign-in instead of creating a session. Use a current host-session key or check the account's API sign-in method.", "LOGIN_METHOD_UNAVAILABLE", 502);
    throw new AsiteError("Asite returned a redirect that this connection cannot safely follow.", "UNSAFE_REDIRECT");
  }
  if (!response.ok) {
    if (response.status === 401) {
      if (operationFor(url) === "login") throw new AsiteError("Asite did not accept the API sign-in. Check your credentials or use a current host-session key.", "LOGIN_FAILED", 401);
      throw new AsiteError("Your Asite session has expired. Connect to Asite again.", "SESSION_EXPIRED", 401);
    }
    if (response.status === 403) {
      throw new AsiteError("Your Asite account does not have access to this resource.", "ACCESS_DENIED", 403);
    }
    throw new AsiteError("Asite could not complete this request.", "UPSTREAM_ERROR", response.status);
  }
  return response;
}

async function jsonRequest(token: string, url: URL, authType: AsiteAuthType = "oauth", init?: RequestInit): Promise<unknown> {
  const response = await request(token, url, authType, init);
  const operation = operationFor(url);
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "unknown";
  const diagnostic: AsiteDiagnostic = { operation, format: "text", httpStatus: response.status,
    contentType: ["application/json", "application/xml", "text/xml", "text/html"].includes(mime) ? mime : "other", rootKeys: {}, dataKeys: {} };
  let payload: unknown;
  try {
    const body = (await response.text()).replace(/^\uFEFF/, "").trim();
    if (body.length > 12 * 1024 * 1024) throw new Error("response limit");
    if (/^[{[]/.test(body)) {
      diagnostic.format = "json";
      payload = JSON.parse(body);
    } else if (/^(?:<!doctype\s+html|<html\b)/i.test(body) || mime === "text/html") {
      diagnostic.format = "html";
      if (operation === "login") throw new AsiteError("Asite returned a web sign-in page instead of an API session. Use an existing host-session key or check your organisation's API sign-in method.", "LOGIN_METHOD_UNAVAILABLE", 502, diagnostic);
      throw new AsiteError("Asite returned a web sign-in page. Reconnect with a current host-session key.", "SESSION_EXPIRED", 401, diagnostic);
    } else if (authType === "session" && body.startsWith("<")) {
      diagnostic.format = "xml";
      if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) throw new Error("invalid XML");
      payload = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(body);
    } else throw new Error("unexpected body");
  } catch (error) {
    if (error instanceof AsiteError) throw error;
    throw new AsiteError(operation === "login" ? "Asite's API sign-in response could not be read. Use a current host-session key or check the account's API sign-in method." : "Asite's API response could not be read. Extraction was stopped to avoid incomplete totals.", "INVALID_RESPONSE", 502, diagnostic);
  }
  if (isObject(payload)) {
    diagnostic.rootKeys = shape(payload);
    const data = property(payload, "asiteDataList");
    if (typeof data === "string") diagnostic.envelopeState = data.trim() ? "text" : "empty";
    diagnostic.dataKeys = shape(data);
    diagnostics.set(payload, diagnostic);
    if (isObject(data)) diagnostics.set(data, diagnostic);
    upstreamError(payload, diagnostic);
  }
  return payload;
}

async function listOauthProjects(token: string, region: AsiteRegion): Promise<Project[]> {
  validateSession(token, region, "oauth");
  const payload = await jsonRequest(token, endpoint(ASITE_UAE.apiBaseUrl, "workspaceList", { getJsonResult: "true" }));
  if (!Array.isArray(payload)) {
    throw new AsiteError("Asite did not return its documented workspace list.", "INVALID_RESPONSE");
  }
  return payload.map((item) => {
    if (!isObject(item)) throw new AsiteError("Asite returned an invalid workspace.", "INVALID_RESPONSE");
    const id = field(item.cloudUrl, "project URL");
    projectApiBase(id);
    return { id, name: field(item.projectName, "project name") };
  });
}

/** Matches E1 as a complete label, including E1-Schedules, but excludes E10. */
export function isE1FolderLabel(label: string): boolean {
  return isE1FolderName(label);
}

interface FolderNode {
  folder: Folder;
  hasSubFolder: boolean;
  depth: number;
}

function normalizeFolder(value: unknown, parent?: FolderNode): FolderNode {
  if (!isObject(value)) throw new AsiteError("Asite returned an invalid folder.", "INVALID_RESPONSE");
  const id = field(value.folderId, "folder ID");
  const name = field(value.folder_title, "folder name");
  const path = value.folderPath === undefined
    ? parent ? `${parent.folder.path.replace(/\/$/, "")}/${name}` : name
    : field(value.folderPath, "folder path");
  if (value.hasSubFolder !== undefined && typeof value.hasSubFolder !== "boolean") {
    throw new AsiteError("Asite returned an invalid subfolder flag.", "INVALID_RESPONSE");
  }
  return {
    folder: {
      id,
      name,
      path,
      ...(parent ? { parentId: parent.folder.id } : {}),
      isE1: Boolean(parent?.folder.isE1) || isE1FolderLabel(name) || isE1FolderLabel(path),
    },
    hasSubFolder: value.hasSubFolder !== false,
    depth: parent ? parent.depth + 1 : 0,
  };
}

/** Returns all accessible folders; E1 descendants retain their scope flag. */
async function listOauthFolders(token: string, region: AsiteRegion, projectId: string): Promise<Folder[]> {
  validateSession(token, region, "oauth");
  const base = projectApiBase(projectId);
  const payload = await jsonRequest(token, endpoint(base, "folderAndFileList", {
    projectId,
    isWorkspace: "1",
    isFolderDataReq: "true",
  }));
  if (!isObject(payload) || !Array.isArray(payload.folderData)) {
    throw new AsiteError("Asite did not return its documented folder list.", "INVALID_RESPONSE");
  }
  const queue: FolderNode[] = payload.folderData.map((item) => normalizeFolder(item));
  const visited = new Set<string>();
  const result: Folder[] = [];
  let requests = 0;
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (visited.has(node.folder.id)) continue;
    visited.add(node.folder.id);
    if (visited.size > MAX_FOLDERS || node.depth > MAX_FOLDER_DEPTH) {
      throw new AsiteError("This project exceeds the folder traversal limit. Select a smaller project scope.", "FOLDER_LIMIT");
    }
    result.push(node.folder);
    if (!node.hasSubFolder) continue;
    if (++requests > MAX_FOLDER_REQUESTS) {
      throw new AsiteError("This project exceeds the folder request limit. Select a smaller project scope.", "FOLDER_LIMIT");
    }
    const children = await jsonRequest(token, endpoint(base, "getSubFolderList", {
      projectId,
      folderId: node.folder.id,
      hasSubFolder: "true",
    }));
    if (!Array.isArray(children)) {
      throw new AsiteError("Asite did not return its documented subfolder list.", "INVALID_RESPONSE");
    }
    // Reject oversized payloads explicitly rather than silently losing folders.
    if (queue.length + children.length > MAX_FOLDERS * 2) {
      throw new AsiteError("This project exceeds the folder traversal limit. Select a smaller project scope.", "FOLDER_LIMIT");
    }
    queue.push(...children.map((item) => normalizeFolder(item, node)));
  }
  return result;
}

/**
 * Session REST contracts come from the public API guide linked by:
 * https://help.asite.com/en/articles/5700569-open-data-api
 * https://adoddleak.asite.com/lnk/pAAq4b4FG9LzAMHejqA6
 * Sections 6.1, 6.2, 6.4, 6.5 and 6.6. IDs include their hashed suffix.
 */
function sessionId(value: string): string {
  const id = field(value, "resource ID");
  if (/[\/\\?#\s]/.test(id) || id.length > 512) {
    throw new AsiteError("Asite returned an invalid resource ID.", "INVALID_RESPONSE");
  }
  return id;
}

function dataRoot(payload: unknown, allowEmptyDocumentPage = false): Record<string, unknown> {
  const root = isObject(payload) ? property(payload, "asiteDataList") : undefined;
  const diagnostic = isObject(payload) ? diagnostics.get(payload) : undefined;
  // The XML parser represents <asiteDataList/> as "". An empty direct-doc
  // parent must not prevent later selected E1 descendants from being read.
  if (allowEmptyDocumentPage && diagnostic?.operation === "documents" && diagnostic.format === "xml" && diagnostic.httpStatus === 200 && typeof root === "string" && !root.trim()) {
    const empty = { documentVO: [] };
    diagnostics.set(empty, diagnostic);
    return empty;
  }
  if (!isObject(root)) {
    throw new AsiteError("Asite did not return its documented data envelope.", "INVALID_RESPONSE", 502, diagnostic);
  }
  return root;
}

function records(value: unknown, label: string, diagnostic?: AsiteDiagnostic): Record<string, unknown>[] {
  if (value === null || value === "") return [];
  const list = Array.isArray(value) ? value : isObject(value) ? [value] : undefined;
  if (!list || list.some((item) => !isObject(item))) {
    throw new AsiteError(`Asite did not return a readable ${label}.`, "INVALID_RESPONSE", 502, diagnostic);
  }
  return list as Record<string, unknown>[];
}

function uriList(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  const normalized = list.map(item => isObject(item) ? item["#text"] : item);
  if (normalized.some((item) => typeof item !== "string")) {
    throw new AsiteError("Asite returned invalid API links.", "INVALID_RESPONSE");
  }
  return normalized as string[];
}

function sessionEndpoint(path: string, query: Record<string, string> = {}): URL {
  return endpoint(ASITE_UAE.sessionBaseUrl, path, query, "session");
}

export async function loginSession(email: string, password: string, region: AsiteRegion): Promise<{ token: string }> {
  if (region !== "uae") throw new AsiteError("This connection supports the Asite UAE region.", "UNSUPPORTED_REGION");
  if (typeof email !== "string" || !email.trim() || email.length > 320 || typeof password !== "string" || !password || password.length > 4_096) {
    throw new AsiteError("Enter your Asite email and password.", "INVALID_LOGIN");
  }
  const payload = await jsonRequest("", new URL(`${ASITE_UAE.sessionBaseUrl}/apilogin/`), "session", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ emailId: email.trim(), password }).toString(),
  });
  const profile = isObject(payload) ? property(payload, "UserProfile") : undefined;
  const session = isObject(profile) ? property(profile, "Sessionid") : undefined;
  if (typeof session !== "string") {
    throw new AsiteError("Asite did not establish a session. Check your sign-in details or use your organisation's supported sign-in method.", "LOGIN_FAILED");
  }
  const token = session;
  validateSession(token, region, "session");
  return { token };
}

export async function listProjects(token: string, region: AsiteRegion, authType: AsiteAuthType = "session"): Promise<Project[]> {
  validateSession(token, region, authType);
  if (authType === "oauth") return listOauthProjects(token, region);
  const payload = await jsonRequest(token, sessionEndpoint("api/workspace/workspacelist"), "session");
  const data = dataRoot(payload);
  return records(property(data, "workspaceVO"), "workspace list", diagnostics.get(data)).map((item) => ({
    id: sessionId(field(property(item, "Workspace_Id"), "workspace ID")),
    name: field(property(item, "Workspace_Name"), "workspace name"),
  }));
}

export async function listFolders(token: string, region: AsiteRegion, projectId: string, authType: AsiteAuthType = "session"): Promise<Folder[]> {
  validateSession(token, region, authType);
  if (authType === "oauth") return listOauthFolders(token, region, projectId);
  const project = sessionId(projectId);
  const payload = await jsonRequest(token, sessionEndpoint(`api/workspace/${encodeURIComponent(project)}/folders`, {
    includeDeactivatedFolders: "false",
  }), "session", { headers: { Accept: "application/xml" } });
  const data = dataRoot(payload);
  const roots = records(property(data, "folderVO"), "folder tree", diagnostics.get(data));
  const queue: { item: Record<string, unknown>; parent?: Folder; depth: number }[] = roots.map((item) => ({ item, depth: 0 }));
  const byId = new Map<string, Folder>();
  for (let index = 0; index < queue.length; index++) {
    const { item, parent, depth } = queue[index];
    if (depth > MAX_FOLDER_DEPTH || byId.size >= MAX_FOLDERS || queue.length > MAX_FOLDERS * 2) {
      throw new AsiteError("This project exceeds the folder traversal limit. Select a smaller project scope.", "FOLDER_LIMIT");
    }
    const id = sessionId(field(property(item, "FolderID"), "folder ID"));
    if (byId.has(id)) continue;
    const name = field(property(item, "FolderName"), "folder name");
    const parentValue = property(item, "ParentFolderID");
    const parentId = parentValue === undefined || parentValue === null || parentValue === "" ? parent?.id : sessionId(field(parentValue, "parent folder ID"));
    const path = parent ? `${parent.path}/${name}` : name;
    const folder: Folder = { id, name, path, ...(parentId ? { parentId } : {}), isE1: Boolean(parent?.isE1) || isE1FolderLabel(name) };
    byId.set(id, folder);
    const children = property(item, "folderVO");
    if (children !== undefined) {
      queue.push(...records(children, "subfolder tree", diagnostics.get(data)).map((child) => ({ item: child, parent: folder, depth: depth + 1 })));
    }
  }
  // Some accounts serialize the tree as a flat list with ParentFolderID. Resolve
  // paths and E1 inheritance from that documented parent relationship as well.
  const resolved = new Set<string>();
  function resolve(folder: Folder, trail: Set<string>): void {
    if (resolved.has(folder.id)) return;
    if (trail.has(folder.id) || trail.size > MAX_FOLDER_DEPTH) {
      throw new AsiteError("Asite returned a cyclic or excessively deep folder hierarchy.", "INVALID_FOLDER_TREE");
    }
    trail.add(folder.id);
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    if (parent) {
      resolve(parent, trail);
      folder.path = `${parent.path}/${folder.name}`;
      folder.isE1 ||= parent.isE1;
    }
    trail.delete(folder.id);
    resolved.add(folder.id);
  }
  for (const folder of byId.values()) resolve(folder, new Set());
  return [...byId.values()];
}

export async function listFiles(
  token: string,
  region: AsiteRegion,
  projectId: string,
  folderIds: string[],
  cursor?: string,
  authType: AsiteAuthType = "session",
): Promise<AsiteFile[]> {
  validateSession(token, region, authType);
  if (authType === "oauth") {
    projectApiBase(projectId);
    throw new AsiteError("Asite's OAuth connector does not document register discovery. Use an Asite API session or upload an Asite register.", "UNVERIFIED_FILE_LIST");
  }
  if (cursor) throw new AsiteError("This connection loads all returned document pages. An external pagination cursor is not supported.", "INVALID_CURSOR");
  const project = sessionId(projectId);
  const folders = new Map((await listFolders(token, region, project, "session")).map((folder) => [folder.id, folder]));
  if (!Array.isArray(folderIds) || folderIds.length > MAX_FOLDERS) {
    throw new AsiteError("Select valid E1 folders before loading registers.", "INVALID_FOLDER_SCOPE");
  }
  const selected = [...new Set(folderIds)];
  for (const id of selected) {
    if (!folders.get(id)?.isE1) throw new AsiteError("Registers can only be read from E1 folders and their descendants.", "E1_SCOPE_REQUIRED");
  }
  const files = new Map<string, AsiteFile>();
  let pageCount = 0;
  for (const folderId of selected) {
    const folder = folders.get(folderId)!;
    const queue = [sessionEndpoint(`api/workspace/${encodeURIComponent(project)}/folder/${encodeURIComponent(folderId)}/firstpage_doclist`)];
    const scheduled = new Set(queue.map((url) => url.toString()));
    for (let index = 0; index < queue.length; index++) {
      if (++pageCount > 100 || files.size > 25_000) {
        throw new AsiteError("The document list exceeds the complete-read limit. Select fewer E1 folders.", "DOCUMENT_LIMIT");
      }
      const url = queue[index];
      const data = dataRoot(await jsonRequest(token, url, "session", { headers: { Accept: "application/xml" } }), true);
      const documents = records(property(data, "documentVO"), "document list", diagnostics.get(data));
      for (const item of documents) {
        const itemFolderId = sessionId(field(property(item, "FolderId"), "document folder ID"));
        if (itemFolderId !== folderId) throw new AsiteError("Asite returned a document outside the requested E1 folder.", "E1_SCOPE_REQUIRED");
        const name = field(property(item, "FileName"), "file name");
        if (isExplicitNonShopFile(name)) continue;
        const documentId = sessionId(field(property(item, "DocumentId"), "document ID"));
        const revisionId = sessionId(field(property(item, "RevisionId"), "revision ID"));
        const id = `${documentId}:${revisionId}`;
        const downloads = uriList(property(item, "URI")).filter((value) => {
          try { return /\/downloadDocument\//.test(new URL(value).pathname); } catch { return false; }
        });
        let downloadUrl: string | undefined;
        if (downloads.length) {
          const link = requireUaeUrl(downloads[0], "Register link", "session");
          const segments = link.pathname.split("/").map(decodeURIComponent);
          if (segments[1] !== "api" || segments[2] !== "workspace" || segments[3] !== project || segments[4] !== "folder" || segments[5] !== folderId || segments[6] !== "downloadDocument" || segments[7] !== revisionId) {
            throw new AsiteError("Asite returned an unexpected document download link.", "UNSAFE_URL");
          }
          downloadUrl = link.toString();
        }
        files.set(id, {
          id,
          name,
          folderId,
          folderPath: folder.path,
          ...(typeof property(item, "RevNo") === "string" ? { revision: property(item, "RevNo") as string } : {}),
          ...(typeof property(item, "DocStatus") === "string" ? { status: property(item, "DocStatus") as string } : {}),
          downloadable: Boolean(downloadUrl),
          ...(downloadUrl ? { downloadUrl } : {}),
        });
        if (files.size > 25_000) throw new AsiteError("The document list exceeds the complete-read limit. Select fewer E1 folders.", "DOCUMENT_LIMIT");
      }
      for (const value of uriList(property(data, "URI"))) {
        let next: URL;
        try { next = new URL(value); } catch { throw new AsiteError("Asite returned an invalid pagination link.", "INVALID_PAGINATION"); }
        if (!next.pathname.includes("/nextpage_doclist/")) continue;
        requireUaeUrl(value, "Document page", "session");
        const segments = next.pathname.split("/").map(decodeURIComponent);
        if (segments.length !== 8 || segments[1] !== "api" || segments[2] !== "workspace" || segments[3] !== project || segments[4] !== "folder" || segments[5] !== "nextpage_doclist" || !/^\d+$/.test(segments[6]) || !/^\d+$/.test(segments[7])) {
          throw new AsiteError("Asite returned an unexpected pagination link. The document read is incomplete.", "INVALID_PAGINATION");
        }
        if (next.toString() === url.toString()) {
          throw new AsiteError("Asite returned a repeating document page. The document read is incomplete.", "INVALID_PAGINATION");
        }
        if (!scheduled.has(next.toString())) {
          scheduled.add(next.toString());
          queue.push(next);
        }
      }
    }
  }
  return [...files.values()];
}

/** Uses the documented downloadFileByUrl operation; never follows DirectLink itself. */
export async function downloadRegister(
  token: string,
  region: AsiteRegion,
  projectId: string,
  file: AsiteFile,
  authType: AsiteAuthType = "session",
): Promise<Uint8Array> {
  validateSession(token, region, authType);
  if (authType === "oauth") projectApiBase(projectId);
  else sessionId(projectId);
  if (!file.downloadable || !file.downloadUrl) {
    throw new AsiteError("This register does not have an Asite download link.", "REGISTER_NOT_DOWNLOADABLE");
  }
  if (isExplicitNonShopFile(file.name)) {
    throw new AsiteError("Only E1 shop drawing registers can be downloaded.", "E1_SCOPE_REQUIRED");
  }
  const link = requireUaeUrl(file.downloadUrl, "Register link", authType);
  if (authType === "session") {
    const folders = await listFolders(token, region, projectId, "session");
    if (!folders.some((folder) => folder.id === file.folderId && folder.isE1)) {
      throw new AsiteError("Registers can only be downloaded from E1 folders and their descendants.", "E1_SCOPE_REQUIRED");
    }
    const segments = link.pathname.split("/").map(decodeURIComponent);
    const revisionId = file.id.includes(":") ? file.id.slice(file.id.lastIndexOf(":") + 1) : undefined;
    if (segments[1] !== "api" || segments[2] !== "workspace" || segments[3] !== projectId || segments[4] !== "folder" || segments[5] !== file.folderId || segments[6] !== "downloadDocument" || !revisionId || segments[7] !== revisionId || (segments.length !== 8 && (segments.length !== 9 || !/^\d+$/.test(segments[8])))) {
      throw new AsiteError("The register link does not match its E1 workspace and folder.", "UNSAFE_URL");
    }
  }
  const response = await request(token, authType === "session" ? link : endpoint(ASITE_UAE.apiBaseUrl, "downloadFileByUrl", {
    downloadUrl: file.downloadUrl,
  }), authType);
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_REGISTER_BYTES) {
    throw new AsiteError("The register exceeds the 25 MB download limit.", "REGISTER_TOO_LARGE");
  }
  if (!response.body) {
    throw new AsiteError("Asite returned an empty register download.", "INVALID_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REGISTER_BYTES) {
        await reader.cancel();
        throw new AsiteError("The register exceeds the 25 MB download limit.", "REGISTER_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AsiteError) throw error;
    throw new AsiteError("Asite's register download was interrupted. Try again.", "UPSTREAM_UNAVAILABLE");
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new AsiteError("Asite returned an empty register download.", "INVALID_RESPONSE");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
