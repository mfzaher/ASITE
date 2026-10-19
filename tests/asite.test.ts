import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  AsiteError,
  downloadRegister,
  isE1FolderLabel,
  listFiles,
  listFolders,
  listProjects,
  loginSession,
} from "../src/lib/asite";
import type { AsiteFile } from "../src/lib/asite-types";

const token = "test-session+value=";
const projectId = "388$$projectHash";
const e1Id = "101$$e1Hash";
const e2Id = "102$$e2Hash";
const childId = "103$$childHash";
const json = (data: unknown, status = 200) => Response.json(data, { status });
const urlOf = (input: string | URL | Request) => new URL(input instanceof Request ? input.url : input);
const pathname = (url: URL) => url.pathname.split("/").map(decodeURIComponent).join("/");

afterEach(() => mock.restoreAll());

function foldersResponse() {
  return json({ asiteDataList: { folderVO: [
    { FolderID: e1Id, FolderName: "09.03.02 (EI) - Shop Drawing Sheet", ParentFolderID: "0$$root", folderVO: {
      FolderID: childId, FolderName: "Current", ParentFolderID: e1Id,
    } },
    { FolderID: e2Id, FolderName: "E2 Materials", ParentFolderID: "0$$root" },
  ] } });
}

function document(sequence: number, folderId = e1Id, name = `Shop Register ${sequence}.xlsx`) {
  const documentId = `${sequence}$$docHash`;
  const revisionId = `${sequence}$$revisionHash`;
  return {
    DocumentId: documentId,
    RevisionId: revisionId,
    FolderId: folderId,
    FileName: name,
    FolderPath: "project\\E1",
    RevNo: "P02",
    DocStatus: "Approved",
    URI: [`https://dmsuae.asite.com/api/workspace/${projectId}/folder/${folderId}/downloadDocument/${revisionId}`],
  };
}

test("documented REST session login sends form fields and reads UserProfile.Sessionid", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(urlOf(input).toString(), "https://dmsuae.asite.com/apilogin/");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(new Headers(init?.headers).get("cookie"), null);
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("emailId"), "person@example.com");
    assert.equal(form.get("password"), "test-pass&word");
    return json({ UserProfile: { Sessionid: token } });
  });
  assert.deepEqual(await loginSession("person@example.com", "test-pass&word", "uae"), { token });
});

test("session workspace list uses a scoped cookie and normalizes documented hashed IDs", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(urlOf(input).toString(), "https://dmsuae.asite.com/api/workspace/workspacelist");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), `ASessionID=${token}`);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(init?.redirect, "manual");
    return json({ asiteDataList: { workspaceVO: [{ Workspace_Id: projectId, Workspace_Name: "J388 Development" }] } });
  });
  assert.deepEqual(await listProjects(token, "uae"), [{ id: projectId, name: "J388 Development" }]);
});

test("OAuth workspace list preserves cloudUrl and never sends a session cookie", async () => {
  const cloudUrl = "https://integrationuae.asite.com/api?workspace=388";
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(urlOf(input).searchParams.get("getJsonResult"), "true");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    assert.equal(new Headers(init?.headers).get("cookie"), null);
    return json([{ projectName: "J388 Development", cloudUrl }]);
  });
  assert.deepEqual(await listProjects(token, "uae", "oauth"), [{ id: cloudUrl, name: "J388 Development" }]);
});

test("session XML folder tree handles singleton children and E1 descendants", async () => {
  mock.method(globalThis, "fetch", async () => new Response(`<?xml version="1.0"?><asiteDataList><folderVO><FolderName>E1 &amp; Shop Drawings</FolderName><FolderID>${e1Id}</FolderID><ParentFolderID>0$$root</ParentFolderID><folderVO><FolderName>Current</FolderName><FolderID>${childId}</FolderID><ParentFolderID>${e1Id}</ParentFolderID></folderVO></folderVO><folderVO><FolderName>E10 Schedule</FolderName><FolderID>${e2Id}</FolderID><ParentFolderID>0$$root</ParentFolderID></folderVO></asiteDataList>`, { headers: { "Content-Type": "application/xml" } }));
  const folders = await listFolders(token, "uae", projectId);
  assert.equal(folders.find((item) => item.id === e1Id)?.name, "E1 & Shop Drawings");
  assert.equal(folders.find((item) => item.id === childId)?.isE1, true);
  assert.equal(folders.find((item) => item.id === childId)?.path, "E1 & Shop Drawings/Current");
  assert.equal(folders.find((item) => item.id === e2Id)?.isE1, false);
});

test("flat folders resolve E1 inheritance through documented parent IDs", async () => {
  mock.method(globalThis, "fetch", async () => json({ asiteDataList: { folderVO: [
    { FolderID: childId, FolderName: "Registers", ParentFolderID: e1Id },
    { FolderID: e1Id, FolderName: "E1 Schedule", ParentFolderID: "0$$root" },
  ] } }));
  const folders = await listFolders(token, "uae", projectId);
  assert.equal(folders[0].path, "E1 Schedule/Registers");
  assert.equal(folders[0].isE1, true);
});

test("folder cycles fail explicitly", async () => {
  mock.method(globalThis, "fetch", async () => json({ asiteDataList: { folderVO: [
    { FolderID: e1Id, FolderName: "E1", ParentFolderID: childId },
    { FolderID: childId, FolderName: "Registers", ParentFolderID: e1Id },
  ] } }));
  await assert.rejects(listFolders(token, "uae", projectId), { code: "INVALID_FOLDER_TREE" });
});

test("E1 labels exclude E10 and accept the exact user-provided EI alias", () => {
  assert.equal(isE1FolderLabel("E1_Schedule"), true);
  assert.equal(isE1FolderLabel("E10 Schedule"), false);
  assert.equal(isE1FolderLabel("E11 Schedule"), false);
  assert.equal(isE1FolderLabel("09.03.02 (EI) - Shop Drawing Sheet"), true);
  assert.equal(isE1FolderLabel("EI Materials"), false);
});

test("OAuth subfolder traversal handles a repeated parent without looping", async () => {
  let calls = 0;
  const cloudUrl = "https://integrationuae.asite.com/api?workspace=388";
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = urlOf(input);
    calls++;
    if (url.pathname.endsWith("folderAndFileList")) return json({ folderData: [{ folderId: e1Id, folder_title: "E1 Schedule" }] });
    assert.equal(url.searchParams.get("hasSubFolder"), "true");
    assert.equal(url.searchParams.get("workspace"), "388");
    return json([
      { folderId: e1Id, folder_title: "E1 Schedule", folderPath: "E1 Schedule", hasSubFolder: true },
      { folderId: childId, folder_title: "Registers", folderPath: "E1 Schedule/Registers", hasSubFolder: false },
    ]);
  });
  const folders = await listFolders(token, "uae", cloudUrl, "oauth");
  assert.equal(calls, 2);
  assert.equal(folders.length, 2);
  assert.equal(folders[1].isE1, true);
});

test("session file listing reads every returned page and excludes E2/material files", async () => {
  const paths: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = pathname(urlOf(input));
    paths.push(path);
    if (path.endsWith("/folders")) return foldersResponse();
    if (path.endsWith("/firstpage_doclist")) return json({ asiteDataList: {
      documentVO: [document(1), document(2, e1Id, "E2 Schedule.xlsx"), document(3, e1Id, "Material Submittals.xlsx")],
      URI: [`https://dmsuae.asite.com/api/workspace/${projectId}/folder/nextpage_doclist/12345/2`],
    } });
    assert.ok(path.endsWith("/nextpage_doclist/12345/2"));
    return json({ asiteDataList: { documentVO: document(4) } });
  });
  const files = await listFiles(token, "uae", projectId, [e1Id]);
  assert.equal(paths.length, 3);
  assert.equal(files.length, 2);
  assert.equal(files[0].id, "1$$docHash:1$$revisionHash");
  assert.equal(files[0].revision, "P02");
  assert.equal(files[0].status, "Approved");
  assert.equal(files[1].name, "Shop Register 4.xlsx");
});

test("listing outside E1 is rejected before requesting documents", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; return foldersResponse(); });
  await assert.rejects(listFiles(token, "uae", projectId, [e2Id]), { code: "E1_SCOPE_REQUIRED" });
  assert.equal(calls, 1);
});

test("missing document envelope cannot turn into a successful empty scan", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(urlOf(input)).endsWith("/folders")
    ? foldersResponse() : json({ asiteDataList: { message: "not available" } }));
  await assert.rejects(listFiles(token, "uae", projectId, [e1Id]), { code: "INVALID_RESPONSE" });
});

test("external pagination URLs are rejected without forwarding session credentials", async () => {
  const hosts: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = urlOf(input);
    hosts.push(url.hostname);
    return pathname(url).endsWith("/folders") ? foldersResponse() : json({ asiteDataList: {
      documentVO: [document(1)],
      URI: [`https://attacker.example/api/workspace/${projectId}/folder/nextpage_doclist/12345/2`],
    } });
  });
  await assert.rejects(listFiles(token, "uae", projectId, [e1Id]), { code: "UNSAFE_URL" });
  assert.deepEqual(hosts, ["dmsuae.asite.com", "dmsuae.asite.com"]);
});

test("repeating pagination fails as an incomplete read", async () => {
  const next = `https://dmsuae.asite.com/api/workspace/${projectId}/folder/nextpage_doclist/12345/2`;
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(urlOf(input)).endsWith("/folders")
    ? foldersResponse() : json({ asiteDataList: { documentVO: [document(1)], URI: [next] } }));
  await assert.rejects(listFiles(token, "uae", projectId, [e1Id]), { code: "INVALID_PAGINATION" });
});

test("session register download matches the exact revision and E1 folder", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(urlOf(input)).endsWith("/folders")
    ? foldersResponse() : new Response(new Uint8Array([80, 75, 3, 4])));
  const file: AsiteFile = {
    id: "1$$docHash:1$$revisionHash", name: "Shop Register.xlsx", folderId: e1Id,
    folderPath: "E1", downloadable: true,
    downloadUrl: document(1).URI[0],
  };
  assert.deepEqual(await downloadRegister(token, "uae", projectId, file), new Uint8Array([80, 75, 3, 4]));
  await assert.rejects(downloadRegister(token, "uae", projectId, { ...file, id: "1$$docHash:other$$revision" }), { code: "UNSAFE_URL" });
});

test("external register URLs and cookie injection are rejected before network calls", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; return json({}); });
  await assert.rejects(listProjects("test; anotherCookie=secret", "uae"), { code: "INVALID_SESSION" });
  await assert.rejects(downloadRegister(token, "uae", projectId, {
    id: "1:1", name: "Register.xlsx", folderId: e1Id, folderPath: "E1", downloadable: true,
    downloadUrl: "https://integrationuae.asite.com.attacker.example/register.xlsx",
  }), { code: "UNSAFE_URL" });
  assert.equal(calls, 0);
});

test("redirects cannot forward credentials and upstream bodies never appear in errors", async () => {
  mock.method(globalThis, "fetch", async () => new Response("sensitive upstream body", { status: 302, headers: { Location: "https://attacker.example" } }));
  await assert.rejects(listProjects(token, "uae"), (error: unknown) => error instanceof AsiteError && error.code === "UNSAFE_REDIRECT" && !error.message.includes("sensitive"));
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response("sensitive upstream body", { status: 401 }));
  await assert.rejects(listProjects(token, "uae"), (error: unknown) => error instanceof AsiteError && error.code === "SESSION_EXPIRED" && !error.message.includes("sensitive"));
});

test("OAuth register enumeration stays explicit where its connector lacks a contract", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; return json({}); });
  await assert.rejects(listFiles(token, "uae", "https://integrationuae.asite.com/api", [e1Id], undefined, "oauth"), { code: "UNVERIFIED_FILE_LIST" });
  assert.equal(calls, 0);
});

test("XML declarations with external entities are rejected", async () => {
  mock.method(globalThis, "fetch", async () => new Response('<?xml version="1.0"?><!DOCTYPE asiteDataList [<!ENTITY file SYSTEM "file:///etc/passwd">]><asiteDataList><workspaceVO><Workspace_Id>388</Workspace_Id><Workspace_Name>&file;</Workspace_Name></workspaceVO></asiteDataList>'));
  await assert.rejects(listProjects(token, "uae"), { code: "INVALID_RESPONSE" });
});
